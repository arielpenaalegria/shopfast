'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { C, connect, nextId, withTx, fmt, isDup } = require('./db');
const A = require('./auth');
const { provider, ProviderError, MODE, parseE4 } = require('./provider');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
// Precio al subrevendedor = costo (4 decimales, entero x10000) + margen, redondeado HACIA ARRIBA al centavo.
// Todo con enteros: nunca se usan decimales flotantes para dinero.
const priceCents = (costE4, markupPct) => Math.ceil(costE4 * (10000 + Math.round(markupPct * 100)) / 1e6);
const e4ToStr = n => (n / 10000).toFixed(4);
const now = () => new Date();
const kvSet = (k, v) => C.kv.updateOne({ _id: k }, { $set: { value: String(v), updated_at: now() } }, { upsert: true });
const kvGet = async k => { const r = await C.kv.findOne({ _id: k }); return r ? { value: r.value, updated_at: fmt(r.updated_at) } : null; };

// ---------- utilidades ----------
function send(res, code, obj, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 20000) { reject(new Error('Cuerpo demasiado grande')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('JSON inválido')); } });
  });
}
const toCents = v => { const n = Math.round(Number(v) * 100); return Number.isFinite(n) ? n : NaN; };
const httpErr = (http, msg) => Object.assign(new Error(msg), { http });
const ledger = async (s, uid, cents, type, ref, note) =>
  C.ledger.insertOne({ _id: await nextId('ledger', s), user_id: uid, amount_cents: cents, type, ref: ref ?? null, note: note ?? null, created_at: now() }, { session: s });
const addBalance = (s, uid, delta) => C.users.updateOne({ _id: uid }, { $inc: { balance_cents: delta } }, { session: s });
const upOrder = (id, set, filter = {}) => C.orders.updateOne({ _id: id, ...filter }, { $set: { ...set, updated_at: now() } });

// ---------- rutas API ----------
const routes = {};
const route = (m, p, role, fn) => (routes[m + ' ' + p] = { role, fn });

route('POST', '/api/login', null, async (req, res, _u, body) => {
  const username = String(body.username || '').trim();
  const key = A.clientIp(req) + '|' + username.toLowerCase();
  if (A.loginBlocked(key)) return send(res, 429, { error: 'Demasiados intentos. Espera 15 minutos.' });
  const u = await C.users.findOne({ username_lc: username.toLowerCase() });
  if (!u || !u.active || !A.verifyPassword(String(body.password || ''), u.password_hash)) {
    A.loginFail(key);
    return send(res, 401, { error: 'Usuario o contraseña incorrectos' });
  }
  A.loginOk(key);
  send(res, 200, { ok: true, role: u.role }, { 'Set-Cookie': A.cookieHeader(A.makeSession(u._id), 12 * 3600) });
});
route('POST', '/api/logout', null, (req, res) => send(res, 200, { ok: true }, { 'Set-Cookie': A.cookieHeader('', 0) }));

route('GET', '/api/me', 'any', (req, res, u) =>
  send(res, 200, { username: u.username, role: u.role, balance: u.balance_cents / 100, markup_pct: u.markup_pct, mode: MODE }));

// --- Subrevendedor ---
// Productos habilitados por el admin y disponibles ahora (con precio, en stock y que pidan datos de destino)
async function availableProducts(onlyId) {
  const ps = await C.products.find(onlyId ? { _id: onlyId, active: 1 } : { active: 1 }).toArray();
  if (!ps.length) return [];
  const cs = new Map((await C.catalog.find({ _id: { $in: ps.map(p => p.catalog_item_id) } }).toArray()).map(c => [c._id, c]));
  return ps.map(p => ({ p, c: cs.get(p.catalog_item_id) }))
    .filter(({ c }) => c && c.in_catalog === 1 && c.price_e4 != null && c.in_stock === 1 && c.requires_target === 1)
    .map(({ p, c }) => ({ id: p._id, name: p.name, product_id: c._id, price_e4: c.price_e4, target_schema: c.target_schema }));
}

route('GET', '/api/products', 'reseller', async (req, res, u) =>
  send(res, 200, (await availableProducts()).sort((a, b) => a.name.localeCompare(b.name)).map(p => ({
    id: p.id, name: p.name, price: priceCents(p.price_e4, u.markup_pct) / 100, fields: p.target_schema,
  }))));

route('POST', '/api/orders', 'reseller', async (req, res, u, body) => {
  const p = (await availableProducts(Number(body.product_id)))[0];
  if (!p) return send(res, 400, { error: 'Producto no disponible ahora' });

  // Los campos se validan contra el target_schema del producto (nunca fijos en el código)
  const schema = p.target_schema, given = body.target && typeof body.target === 'object' ? body.target : {};
  const payload = {};
  for (const f of schema) {
    let v = given[f.key];
    if (typeof v !== 'string' && typeof v !== 'number') return send(res, 400, { error: `Falta: ${f.label}` });
    v = String(v).trim();
    if (f.type === 'select') {
      if (!(f.options || []).some(o => o.value === v)) return send(res, 400, { error: `Opción inválida en: ${f.label}` });
    } else {
      if (/^[\d\s\-()+]+$/.test(v)) v = v.replace(/[\s\-()]/g, ''); // números de teléfono: sin espacios ni guiones
      if (!/^[^\x00-\x1f<>]{1,64}$/.test(v)) return send(res, 400, { error: `${f.label} inválido` });
    }
    payload[f.key] = v;
  }
  const price = priceCents(p.price_e4, u.markup_pct);
  const display = Object.values(payload).join(' · ');

  // 1) Cobrar y crear el pedido en una sola transacción (no hay doble gasto)
  let orderId;
  try {
    orderId = await withTx(async s => {
      const ch = await C.users.updateOne({ _id: u.id, balance_cents: { $gte: price } }, { $inc: { balance_cents: -price } }, { session: s });
      if (!ch.matchedCount) throw httpErr(402, 'Saldo insuficiente');
      const id = await nextId('orders', s), t = now();
      await C.orders.insertOne({
        _id: id, user_id: u.id, product_id: p.id, product_name: p.name, target: display, catalog_item_id: p.product_id,
        target_payload: payload, cost_e4: p.price_e4, price_cents: price, status: 'pending', idempotency_key: 'pedido-' + crypto.randomUUID(),
        provider_order_id: null, reference_code: null, detail: null, failure_code: null, refunded: 0, checked_at: null, created_at: t, updated_at: t,
      }, { session: s });
      await ledger(s, u.id, -price, 'order', String(id), `${p.name} → ${display}`);
      return id;
    });
  } catch (e) { return send(res, e.http || 500, { error: e.http ? e.message : 'Error interno' }); }

  // 2) Enviar al proveedor
  const r = await submitOrder(orderId);
  if (r.status === 'failed') return send(res, 422, { error: 'No se pudo procesar la recarga. Se devolvió tu saldo.', order_id: orderId, status: 'failed' });
  if (r.status === 'unknown') return send(res, 202, { ok: true, order_id: orderId, status: 'unknown', message: 'No pudimos confirmar el envío todavía. Se está verificando; no la repitas.' });
  return send(res, 202, { ok: true, order_id: orderId, status: r.status });
});

/** Cierra un pedido UNA sola vez (el estado se comprueba dentro de la transacción: no hay doble reembolso). */
function settle(orderId, outcome, detail, failureCode) {
  return withTx(async s => {
    const o = await C.orders.findOne({ _id: orderId, status: { $in: ['pending', 'processing', 'unknown'] } }, { session: s });
    if (!o) return false;
    const set = { status: outcome, updated_at: now() };
    if (outcome === 'completed') set.detail = null;
    else { if (detail != null) set.detail = detail; if (failureCode != null) set.failure_code = failureCode; }
    const refund = outcome === 'failed' && !o.refunded; // si ya se le devolvió antes, no se devuelve otra vez
    if (refund) set.refunded = 1;
    await C.orders.updateOne({ _id: orderId }, { $set: set }, { session: s });
    if (refund) {
      await addBalance(s, o.user_id, o.price_cents);
      await ledger(s, o.user_id, o.price_cents, 'refund', String(orderId), 'Reembolso');
    }
    return true;
  });
}

/** Cobra otra vez un pedido que ya se había reembolsado. Devuelve false si el subrevendedor no tiene saldo, null si no aplica. */
function chargeAgain(orderId, note) {
  return withTx(async s => {
    const o = await C.orders.findOne({ _id: orderId, refunded: 1, status: { $in: ['failed', 'unknown'] } }, { session: s });
    if (!o) return null;
    const ch = await C.users.updateOne({ _id: o.user_id, balance_cents: { $gte: o.price_cents } }, { $inc: { balance_cents: -o.price_cents } }, { session: s });
    if (!ch.matchedCount) return false;
    await ledger(s, o.user_id, -o.price_cents, 'order', String(orderId), note);
    await C.orders.updateOne({ _id: orderId }, { $set: { status: 'completed', refunded: 0, detail: note, updated_at: now() } }, { session: s });
    return true;
  });
}

/** Central One puede entregar DESPUÉS de haber marcado el pedido como fallido ("order.failed no siempre es definitivo").
 *  Si pasa, se le cobra de nuevo al subrevendedor; si no tiene saldo, queda "Verificando" para que lo resuelva el admin. */
async function lateDelivery(orderId) {
  const r = await chargeAgain(orderId, 'Central One entregó después de reembolsar: se cobró de nuevo');
  if (r === false)
    await upOrder(orderId, { status: 'unknown', detail: 'ENTREGADA por Central One después del reembolso, y el subrevendedor no tiene saldo para cobrarle de nuevo. Abónale/cóbrale y pulsa "Sí llegó".' }, { status: 'failed' });
}

/** Envía el pedido a Central One. Los reintentos usan SIEMPRE la misma Idempotency-Key y el mismo cuerpo. */
async function submitOrder(orderId) {
  const o = await C.orders.findOne({ _id: orderId, status: { $in: ['pending', 'unknown'] } });
  if (!o) return { status: 'unknown' };
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await provider.createOrder({
        catalogItemId: o.catalog_item_id, targetPayload: o.target_payload,
        idempotencyKey: o.idempotency_key, note: `panel-${o._id}`,
      });
      const set = { status: 'processing', provider_order_id: r.providerOrderId, reference_code: r.referenceCode, detail: null };
      if (r.totalE4 != null) set.cost_e4 = r.totalE4;
      await upOrder(o._id, set);
      if (r.status === 'completed') { await settle(o._id, 'completed', null); return { status: 'completed' }; }
      if (r.status === 'failed') { await settle(o._id, 'failed', r.failure || 'Falló en el proveedor', r.failureCode); return { status: 'failed' }; }
      return { status: 'processing' };
    } catch (e) {
      last = e;
      if (e instanceof ProviderError && e.definitive) break;
      const wait = Math.min(Math.max(1500 * (i + 1), ((e && e.retryAfterSec) || 0) * 1000), 20000); // respeta Retry-After (429)
      await new Promise(r => setTimeout(r, wait));
    }
  }
  if (last instanceof ProviderError && last.definitive) {
    if (last.code === 'insufficient_balance') await kvSet('balance_low', '1'); // el admin ve el aviso en su panel
    await settle(o._id, 'failed', last.message, last.code);
    return { status: 'failed' };
  }
  // Resultado incierto: NO reembolsar. Queda para reintento seguro / revisión del admin.
  await upOrder(o._id, { status: 'unknown', detail: String(last && last.message) });
  return { status: 'unknown' };
}

/** Consulta periódica del estado, siguiendo la guía de la documentación: cada 30 s los primeros 5 minutos y luego cada 5.
 *  Una entrega puede tardar desde minutos hasta un par de horas: NUNCA se repite un pedido mientras está en proceso.
 *  Además, los pedidos "fallidos" se siguen vigilando 48 h: Central One puede confirmar la entrega después de reembolsar. */
let polling = false;
async function pollOnce(force = false) {
  if (polling) return;
  polling = true;
  try {
    const t = Date.now();
    const cand = await C.orders.find({
      provider_order_id: { $ne: null },
      $or: [{ status: 'processing' }, { status: 'failed', refunded: 1, updated_at: { $gt: new Date(t - 48 * 3600e3) } }],
    }).toArray();
    const every = o => o.status === 'processing' ? (t - o.created_at.getTime() > 300e3 ? 300e3 : 30e3) : 15 * 60e3;
    const rows = cand.filter(o => force || !o.checked_at || t - o.checked_at.getTime() >= every(o))
      .sort((a, b) => (a.checked_at ? a.checked_at.getTime() : 0) - (b.checked_at ? b.checked_at.getTime() : 0)).slice(0, 20);
    for (const r of rows) {
      try {
        const s = await provider.getOrder(r.provider_order_id);
        const mark = { checked_at: now() }; if (s.totalE4 != null) mark.cost_e4 = s.totalE4;
        await C.orders.updateOne({ _id: r._id }, { $set: mark });
        if (r.status === 'failed') { // ya reembolsado: solo nos interesa si cambió a entregado
          if (s.status === 'completed') await lateDelivery(r._id);
          else if (s.status === 'review') await upOrder(r._id, { status: 'unknown', detail: 'estado proveedor: ' + s.rawStatus + ' tras el reembolso (revisar en el portal)' }, { status: 'failed' });
          continue;
        }
        if (s.status === 'completed') await settle(r._id, 'completed', null);
        else if (s.status === 'failed') await settle(r._id, 'failed', s.failure || 'Falló en el proveedor', s.failureCode);
        else if (s.status === 'review') await upOrder(r._id, { status: 'unknown', detail: 'estado proveedor: ' + s.rawStatus + ' (revisar en el portal)' }, { status: 'processing' });
        else await C.orders.updateOne({ _id: r._id, status: 'processing' }, { $set: { detail: 'estado proveedor: ' + s.rawStatus } });
      } catch (e) { console.error('poll pedido', r._id, e.message); }
    }
  } finally { polling = false; }
}

/** Pedidos cobrados que nunca llegaron a enviarse (el servidor se reinició o se durmió justo entonces; en Render gratis pasa).
 *  Se reenvían con la MISMA Idempotency-Key, así que nunca se duplican en Central One. */
let recovering = false;
async function recoverPending() {
  if (recovering) return;
  recovering = true;
  try {
    const old = await C.orders.find({ status: 'pending', updated_at: { $lt: new Date(Date.now() - 120e3) } }).sort({ _id: 1 }).limit(5).toArray();
    for (const o of old) { console.log('Reenviando pedido pendiente', o._id); await submitOrder(o._id); }
  } catch (e) { console.error('recoverPending', e.message); }
  finally { recovering = false; }
}

// Mensajes para el subrevendedor según failure.code (el detalle técnico lo ve solo el admin)
const REASONS = {
  invalid_player: 'El número o ID no es válido.',
  not_eligible: 'Ese número o cuenta no puede recibir este producto.',
  out_of_stock: 'Producto agotado por ahora. Intenta más tarde.',
  provider_unavailable: 'Servicio no disponible por ahora. Intenta más tarde.',
  quantity_not_supported: 'No se pudo procesar. Contacta al administrador.',
  price_changed: 'El precio cambió. Contacta al administrador.',
  cancelled: 'La recarga fue cancelada.',
  insufficient_balance: 'Servicio no disponible por ahora. Intenta más tarde.',
  insufficient_stock: 'Producto agotado por ahora. Intenta más tarde.',
  invalid_request: 'Datos inválidos para este producto. Revisa e intenta de nuevo.',
  insufficient_scope: 'Servicio no disponible por ahora. Contacta al administrador.',
  invalid_api_key: 'Servicio no disponible por ahora. Contacta al administrador.',
};
route('GET', '/api/orders', 'reseller', async (req, res, u) =>
  send(res, 200, (await C.orders.find({ user_id: u.id }).sort({ _id: -1 }).limit(100).toArray()).map(o => ({
    id: o._id, product_name: o.product_name, target: o.target, price: o.price_cents / 100, status: o.status, created_at: fmt(o.created_at),
    reason: o.status === 'failed' ? (REASONS[o.failure_code] || 'No se pudo entregar la recarga. Se devolvió tu saldo.') : null,
  }))));

route('GET', '/api/ledger', 'reseller', async (req, res, u) =>
  send(res, 200, (await C.ledger.find({ user_id: u.id }).sort({ _id: -1 }).limit(100).toArray())
    .map(l => ({ amount: l.amount_cents / 100, type: l.type, note: l.note, created_at: fmt(l.created_at) }))));

// --- Admin ---
route('GET', '/api/admin/users', 'admin', async (req, res) =>
  send(res, 200, (await C.users.find({ role: 'reseller' }).sort({ _id: -1 }).toArray())
    .map(u => ({ id: u._id, username: u.username, balance: u.balance_cents / 100, markup_pct: u.markup_pct, active: u.active, created_at: fmt(u.created_at) }))));

route('POST', '/api/admin/users', 'admin', async (req, res, _u, b) => {
  const username = String(b.username || '').trim(), pw = String(b.password || '');
  const markup = Number(b.markup_pct ?? 0);
  if (!/^[\w.-]{3,30}$/.test(username)) return send(res, 400, { error: 'Usuario: 3-30 letras, números, . _ -' });
  if (pw.length < 8) return send(res, 400, { error: 'La contraseña debe tener 8+ caracteres' });
  if (!(markup >= 0 && markup <= 100)) return send(res, 400, { error: 'Margen entre 0 y 100' });
  try { await createUser(username, A.hashPassword(pw), 'reseller', markup); }
  catch (e) { if (isDup(e)) return send(res, 409, { error: 'Ese usuario ya existe' }); throw e; }
  send(res, 201, { ok: true });
});

async function createUser(username, hash, role, markup = 0) {
  return C.users.insertOne({ _id: await nextId('users'), username, username_lc: username.toLowerCase(), password_hash: hash, role,
    balance_cents: 0, markup_pct: markup, active: 1, created_at: now() });
}

route('POST', '/api/admin/balance', 'admin', async (req, res, admin, b) => {
  const uid = Number(b.user_id), cents = toCents(b.amount);
  if (!Number.isInteger(uid) || !Number.isFinite(cents) || cents === 0 || Math.abs(cents) > 10000000) return send(res, 400, { error: 'Datos inválidos' });
  try {
    await withTx(async s => {
      const t = await C.users.findOne({ _id: uid, role: 'reseller' }, { session: s });
      if (!t) throw httpErr(404, 'Usuario no encontrado');
      const ch = await C.users.updateOne({ _id: uid, balance_cents: { $gte: -cents } }, { $inc: { balance_cents: cents } }, { session: s });
      if (!ch.matchedCount) throw httpErr(400, 'El saldo quedaría negativo');
      await ledger(s, uid, cents, cents > 0 ? 'topup' : 'adjust', null, String(b.note || '').slice(0, 200) || `Por ${admin.username}`);
    });
  } catch (e) { return send(res, e.http || 500, { error: e.http ? e.message : 'Error interno' }); }
  send(res, 200, { ok: true });
});

route('POST', '/api/admin/user-update', 'admin', async (req, res, _u, b) => {
  const uid = Number(b.user_id), f = { _id: uid, role: 'reseller' };
  const set = {};
  if (b.active !== undefined) set.active = b.active ? 1 : 0;
  if (b.markup_pct !== undefined) {
    const m = Number(b.markup_pct);
    if (!(m >= 0 && m <= 100)) return send(res, 400, { error: 'Margen entre 0 y 100' });
    set.markup_pct = m;
  }
  if (b.password) {
    if (String(b.password).length < 8) return send(res, 400, { error: 'Contraseña de 8+ caracteres' });
    set.password_hash = A.hashPassword(String(b.password));
  }
  if (Object.keys(set).length) await C.users.updateOne(f, { $set: set });
  send(res, 200, { ok: true });
});

route('GET', '/api/admin/orders', 'admin', async (req, res) => {
  const os = await C.orders.find({}).sort({ _id: -1 }).limit(200).toArray();
  const us = new Map((await C.users.find({ _id: { $in: [...new Set(os.map(o => o.user_id))] } }).toArray()).map(u => [u._id, u.username]));
  send(res, 200, os.map(o => {
    const price = o.price_cents / 100;
    return { id: o._id, username: us.get(o.user_id), product_name: o.product_name, target: o.target, price, status: o.status,
      reference_code: o.reference_code, detail: o.detail, created_at: fmt(o.created_at), cost: e4ToStr(o.cost_e4), margin: (price - o.cost_e4 / 10000).toFixed(4) };
  }));
});

// Estado general: saldo en Central One (GET /balance, con caché de 30 s) y catálogo
let balCache = { at: 0, v: null, err: null };
async function providerBalance() {
  if (Date.now() - balCache.at < 30000) return balCache;
  try { balCache = { at: Date.now(), v: await provider.getBalance(), err: null }; if (balCache.v.availableE4 !== null) await kvSet('provider_balance', e4ToStr(balCache.v.availableE4)); }
  catch (e) { balCache = { at: Date.now(), v: null, err: e.message }; }
  return balCache;
}
route('GET', '/api/admin/status', 'admin', async (req, res) => {
  const b = await providerBalance(), last = await kvGet('provider_balance'), low = await kvGet('balance_low'),
    sync = await kvGet('catalog_synced'), wt = await kvGet('webhook_test');
  send(res, 200, {
    provider_balance: b.v ? { available: e4ToStr(b.v.availableE4), held: e4ToStr(b.v.heldE4), live: true }
      : (last ? { available: last.value, held: null, live: false, at: last.updated_at } : null),
    balance_error: b.err,
    balance_low: !!(low && low.value === '1'),
    catalog_synced_at: sync ? sync.updated_at : null,
    webhooks: !!process.env.WEBHOOK_SECRET,
    webhook_test_at: wt ? wt.updated_at : null,
  });
});

// Catálogo de Central One (copia local) para que el admin elija qué vender
route('GET', '/api/admin/catalog', 'admin', async (req, res) => {
  const q = (new URL(req.url, 'http://x').searchParams.get('q') || '').trim().toLowerCase();
  const enabled = new Set((await C.products.find({}).toArray()).map(p => p.catalog_item_id));
  const rows = (await C.catalog.find({ in_catalog: 1 }).toArray())
    .filter(c => [c.name, c.sku, c.family_name].some(x => String(x || '').toLowerCase().includes(q)))
    .sort((a, b) => String(a.family_name || '').localeCompare(String(b.family_name || '')) || String(a.name).localeCompare(String(b.name)))
    .slice(0, 60);
  send(res, 200, rows.map(c => ({
    product_id: c._id, name: c.name, sku: c.sku, family_name: c.family_name, in_stock: c.in_stock, in_catalog: c.in_catalog,
    requires_target: c.requires_target, enabled: enabled.has(c._id) ? 1 : 0,
    price: c.price_e4 === null ? null : e4ToStr(c.price_e4), fields: c.target_schema.map(f => f.key).join(', '),
  })));
});

let lastTestReq = 0;
route('POST', '/api/admin/webhook-test', 'admin', async (req, res) => {
  if (Date.now() - lastTestReq < 30000) return send(res, 429, { error: 'Espera unos segundos (máximo 5 pruebas por hora)' });
  lastTestReq = Date.now();
  try { send(res, 200, { ok: true, ...(await provider.webhookTest()) }); }
  catch (e) { send(res, 502, { error: 'No se pudo enviar la prueba: ' + e.message }); }
});

let lastSyncReq = 0;
route('POST', '/api/admin/catalog-sync', 'admin', async (req, res) => {
  if (Date.now() - lastSyncReq < 20000) return send(res, 429, { error: 'Espera unos segundos antes de actualizar otra vez' });
  lastSyncReq = Date.now();
  try { send(res, 200, { ok: true, count: await syncCatalog() }); }
  catch (e) { send(res, 502, { error: 'No se pudo leer el catálogo: ' + e.message }); }
});

route('GET', '/api/admin/products', 'admin', async (req, res) => {
  const ps = await C.products.find({}).sort({ _id: -1 }).toArray();
  const cs = new Map((await C.catalog.find({ _id: { $in: ps.map(p => p.catalog_item_id) } }).toArray()).map(c => [c._id, c]));
  send(res, 200, ps.filter(p => cs.has(p.catalog_item_id)).map(p => {
    const c = cs.get(p.catalog_item_id);
    return { id: p._id, name: p.name, active: p.active, in_stock: c.in_stock, in_catalog: c.in_catalog, requires_target: c.requires_target,
      cost: c.price_e4 === null ? null : e4ToStr(c.price_e4) };
  }));
});

route('POST', '/api/admin/products', 'admin', async (req, res, _u, b) => {
  const c = await C.catalog.findOne({ _id: String(b.product_id || ''), in_catalog: 1 });
  if (!c) return send(res, 404, { error: 'Producto no encontrado en el catálogo' });
  if (!c.requires_target) return send(res, 400, { error: 'Los productos sin datos de destino (gift cards con código) aún no están soportados por este panel' });
  const ex = await C.products.updateOne({ catalog_item_id: c._id }, { $set: { active: 1 } });
  if (!ex.matchedCount) {
    try { await C.products.insertOne({ _id: await nextId('products'), catalog_item_id: c._id, name: c.name.slice(0, 80), active: 1 }); }
    catch (e) { if (!isDup(e)) throw e; }
  }
  send(res, 201, { ok: true });
});

route('POST', '/api/admin/product-update', 'admin', async (req, res, _u, b) => {
  const id = Number(b.id), set = {};
  if (b.active !== undefined) set.active = b.active ? 1 : 0;
  if (b.name !== undefined) {
    const n = String(b.name).trim();
    if (!n || n.length > 80) return send(res, 400, { error: 'Nombre inválido' });
    set.name = n;
  }
  if (Object.keys(set).length) await C.products.updateOne({ _id: id }, { $set: set });
  send(res, 200, { ok: true });
});

// El admin resuelve pedidos "unknown" tras comprobarlos en el portal del proveedor
route('POST', '/api/admin/resolve', 'admin', async (req, res, _u, b) => {
  const id = Number(b.order_id), outcome = b.outcome;
  if (!['completed', 'failed'].includes(outcome)) return send(res, 400, { error: 'Resultado inválido' });
  const o = await C.orders.findOne({ _id: id, status: 'unknown' });
  if (!o) return send(res, 404, { error: 'Pedido no encontrado o ya resuelto' });
  if (outcome === 'completed' && o.refunded) { // ya se le había devuelto el saldo: hay que cobrarle de nuevo
    const r = await chargeAgain(id, 'Entrega confirmada por el admin: se cobró de nuevo');
    if (r === false) return send(res, 409, { error: 'El subrevendedor no tiene saldo suficiente. Abónale saldo primero y vuelve a intentar.' });
    return send(res, 200, { ok: true });
  }
  await settle(id, outcome, 'Resuelto por el admin'); // si ya estaba reembolsado, "failed" no devuelve otra vez
  send(res, 200, { ok: true });
});

route('POST', '/api/admin/retry', 'admin', async (req, res, _u, b) => {
  const id = Number(b.order_id);
  const o = await C.orders.findOne({ _id: id, status: 'unknown' });
  if (!o) return send(res, 404, { error: 'Pedido no encontrado o ya resuelto' });
  send(res, 200, await submitOrder(id)); // misma Idempotency-Key y mismo cuerpo: seguro
});

route('GET', '/api/admin/provider-balance', 'admin', async (req, res) => {
  try { send(res, 200, await provider.getBalance()); }
  catch (e) { send(res, 502, { error: e.message }); }
});

// ---------- catálogo ----------
async function syncCatalog() {
  const items = await provider.getCatalog();
  const prev = await C.catalog.countDocuments({ in_catalog: 1 });
  if (items.length === 0 && prev > 0) throw new Error('El catálogo llegó vacío; se conserva la copia anterior');
  if (items.length) await C.catalog.bulkWrite(items.map(i => ({ updateOne: {
    filter: { _id: i.productId }, upsert: true,
    update: { $set: { sku: i.sku, name: i.name, category: i.category, product_type: i.productType, family_name: i.familyName, currency: i.currency,
      price_e4: i.priceE4, in_stock: i.inStock ? 1 : 0, available_stock: i.availableStock, in_catalog: i.inCatalog ? 1 : 0,
      requires_target: i.requiresTarget ? 1 : 0, target_schema: i.targetSchema || [], price_updated_at: i.priceUpdatedAt ?? null, synced_at: now() } },
  } })));
  // lo que ya no viene en el catálogo deja de poder comprarse
  await C.catalog.updateMany({ in_catalog: 1, _id: { $nin: items.map(i => i.productId) } }, { $set: { in_catalog: 0, price_e4: null, in_stock: 0 } });
  await kvSet('catalog_synced', 'ok');
  return items.length;
}
const syncSafe = () => syncCatalog().catch(e => console.error('Catálogo:', e.message));

// ---------- webhooks de Central One (opcional; si no hay WEBHOOK_SECRET se usa solo la consulta periódica) ----------
function readRaw(req, max = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > max) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

async function handleWebhook(req, res) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return send(res, 503, { error: 'Webhooks no configurados' });
  const raw = await readRaw(req); // se firma el cuerpo CRUDO, sin volver a serializar
  const ts = String(req.headers['x-centralone-timestamp'] || '');
  if (!/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return send(res, 400, { error: 'Timestamp inválido o viejo' });
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
  const sig = String(req.headers['x-centralone-signature'] || ''), prev = String(req.headers['x-centralone-signature-previous'] || '');
  if (!safeEq(expected, sig) && !(prev && safeEq(expected, prev))) return send(res, 401, { error: 'Firma inválida' });
  let ev; try { ev = JSON.parse(raw); } catch { return send(res, 400, { error: 'JSON inválido' }); }
  const id = String(ev.event_id || req.headers['x-centralone-event-id'] || '');
  if (!id) return send(res, 400, { error: 'Sin event_id' });
  // La entrega es "al menos una vez": el mismo event_id se procesa una sola vez
  try { await C.webhook_events.insertOne({ _id: id, at: now() }); }
  catch (e) { if (isDup(e)) return send(res, 200, { ok: true, duplicate: true }); throw e; }
  send(res, 200, { ok: true }); // responder rápido (<10 s) y trabajar después
  setImmediate(() => processEvent(ev).catch(e => console.error('webhook', e.message)));
}

// "sequence" crece en todos los avisos y el orden no está garantizado: se ignora lo más viejo que lo ya procesado.
async function staleEvent(family, ev) {
  const seq = Number(ev.sequence);
  if (!Number.isFinite(seq)) return false; // avisos con la forma original no traen sequence
  const prev = await kvGet('seq_' + family);
  if (prev && Number(prev.value) >= seq) return true;
  await kvSet('seq_' + family, seq);
  return false;
}

async function processEvent(ev) {
  const name = String(ev.event || '');
  if (name === 'webhook.test') return void await kvSet('webhook_test', 'ok'); // prueba de conexión: llegó y la firma es válida
  if (name.startsWith('order.')) return void await pollOnce(true); // el aviso solo dispara la consulta; GET /orders/{id} es la fuente de verdad
  if (name === 'product.price_changed' || name === 'product.stock_changed') {
    if (await staleEvent('catalog', ev)) return;
    for (const p of ev.products || []) {
      const inCat = p.in_catalog !== false;
      const set = { price_e4: inCat ? parseE4(p.reseller_price) : null, in_stock: p.in_stock ? 1 : 0,
        available_stock: Number.isInteger(p.available_stock) ? p.available_stock : null, in_catalog: inCat ? 1 : 0, synced_at: now() };
      if (p.price_updated_at != null) set.price_updated_at = p.price_updated_at;
      await C.catalog.updateOne({ _id: String(p.product_id) }, { $set: set });
    }
    return;
  }
  if (ev.balance && await staleEvent('balance', ev)) return;
  balCache.at = 0; // fuerza leer GET /balance (fuente de verdad) la próxima vez
  if (ev.balance && ev.balance.available !== undefined) await kvSet('provider_balance', ev.balance.available);
  if (name === 'balance.low') await kvSet('balance_low', '1');
  else if (name === 'deposit.approved' || name === 'balance.credited') await kvSet('balance_low', '0');
}

// ---------- admin inicial (para hosting sin terminal, ej. Render) ----------
// Si no existe ningún admin y están ADMIN_USERNAME / ADMIN_PASSWORD, se crea al arrancar.
// Después de entrar la primera vez, borra ADMIN_PASSWORD de las variables de entorno.
async function bootstrapAdmin() {
  if (await C.users.findOne({ role: 'admin' }) || !process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) return;
  if (process.env.ADMIN_PASSWORD.length < 10) return console.error('ADMIN_PASSWORD debe tener 10+ caracteres: no se creó el admin');
  try {
    await createUser(process.env.ADMIN_USERNAME, A.hashPassword(process.env.ADMIN_PASSWORD), 'admin');
    console.log('Admin inicial creado:', process.env.ADMIN_USERNAME);
  } catch (e) { if (!isDup(e)) throw e; }
}

// ---------- servidor ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (url.pathname === '/webhooks/central-one' && req.method === 'POST') return await handleWebhook(req, res);
    if (url.pathname.startsWith('/api/')) {
      const r = routes[req.method + ' ' + url.pathname];
      if (!r) return send(res, 404, { error: 'No encontrado' });
      let body = {};
      if (req.method === 'POST') {
        if (!(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'Content-Type debe ser JSON' });
        body = await readBody(req);
      }
      let user = null;
      if (r.role) {
        user = await A.readSession(req);
        if (!user) return send(res, 401, { error: 'Sesión expirada' });
        if (r.role !== 'any' && user.role !== r.role) return send(res, 403, { error: 'No permitido' });
      }
      return await r.fn(req, res, user, body);
    }
    // estáticos
    let f = url.pathname === '/' ? '/index.html' : url.pathname;
    const full = path.join(PUBLIC, path.normalize(f));
    if (!full.startsWith(PUBLIC + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', ...SEC });
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'Error interno' });
  }
});

(async () => {
  await connect();
  await bootstrapAdmin();
  server.listen(PORT, () => console.log(`Panel en http://localhost:${PORT}  (proveedor: ${MODE}, base: ${process.env.MONGODB_URI ? 'MongoDB' : 'MEMORIA'})`));
  setInterval(() => pollOnce().catch(e => console.error('poll', e.message)), Number(process.env.POLL_MS) || 15000);
  setInterval(() => recoverPending(), 60000);
  setTimeout(recoverPending, 5000);
  if (MODE === 'real') provider.ping().then(() => console.log('Llave de Central One: OK'), e => console.error('ATENCIÓN: la llave de Central One no funciona:', e.message));
  setTimeout(syncSafe, 500);
  setInterval(syncSafe, 15 * 60 * 1000); // el catálogo se actualiza cada 15 min (límite: 60 peticiones/min)
})().catch(e => { console.error('No se pudo iniciar:', e.message); process.exit(1); });
