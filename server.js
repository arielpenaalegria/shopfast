'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { C, connect, nextId, withTx, fmt, isDup } = require('./db');
const A = require('./auth');
const { provider, ProviderError, MODE, parseE4 } = require('./provider');
const TG = require('./telegram');
const BSC = require('./bsc');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
// Precio al subrevendedor = costo (4 decimales, entero x10000) + margen, redondeado HACIA ARRIBA al centavo.
// Todo con enteros: nunca se usan decimales flotantes para dinero.
const priceCents = (costE4, markupPct) => Math.ceil(costE4 * (10000 + Math.round(markupPct * 100)) / 1e6);
const e4ToStr = n => (n / 10000).toFixed(4);
/** Precio final para un revendedor, en centavos de USDT:
 *  1) Si el admin puso PRECIO FIJO al paquete y está por encima del costo, se usa ese.
 *  2) Si no: costo + margen % del revendedor, y nunca menos que costo + su ganancia mínima por recarga.
 *  Nunca se vende por debajo del costo. */
function priceFor(p, u) {
  const costC = Math.ceil(p.price_e4 / 100);
  if (p.fixed_price_cents && p.fixed_price_cents > costC) return p.fixed_price_cents;
  return Math.max(priceCents(p.price_e4, u.markup_pct || 0), costC + (u.min_margin_cents || 0));
}
const now = () => new Date();
const kvSet = (k, v) => C.kv.updateOne({ _id: k }, { $set: { value: String(v), updated_at: now() } }, { upsert: true });
const kvGet = async k => { const r = await C.kv.findOne({ _id: k }); return r ? { value: r.value, updated_at: fmt(r.updated_at) } : null; };

// ---------- utilidades ----------
function send(res, code, obj, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}
function readBody(req, max = 20000) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > max) { reject(new Error('Cuerpo demasiado grande')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('JSON inválido')); } });
  });
}
const toCents = v => { const n = Math.round(Number(v) * 100); return Number.isFinite(n) ? n : NaN; };
const httpErr = (http, msg) => Object.assign(new Error(msg), { http });
// ---------- 3 saldos separados por revendedor ----------
// usdt: centavos de USDT · transfer: centavos de CUP (transferencia) · mobile: centavos de CUP (saldo móvil).
// Cada depósito se abona en SU moneda y cada compra se paga en la moneda que elija el revendedor.
// Las tasas CUP/USDT solo sirven para calcular el precio en CUP de cada paquete; nunca se convierte saldo.
const CUR = { usdt: 'balance_cents', transfer: 'bal_transfer_cents', mobile: 'bal_mobile_cents' };
const CUR_L = { usdt: 'USDT', transfer: 'CUP transferencia', mobile: 'CUP saldo móvil' };
const curOf = c => (CUR[c] ? c : 'usdt');
const fmtCur = (cents, c) => curOf(c) === 'usdt' ? (cents / 100).toFixed(2) + ' USDT' : Math.round(cents / 100) + ' ' + CUR_L[c];
const balancesOf = u => ({ usdt: (u.balance_cents || 0) / 100, transfer: (u.bal_transfer_cents || 0) / 100, mobile: (u.bal_mobile_cents || 0) / 100 });
/** Precio de un paquete en una moneda. CUP = precio USDT × tasa, redondeado hacia arriba al CUP entero. null = esa moneda no está disponible (sin tasa). */
function priceIn(usdtCents, cur, st) {
  if (curOf(cur) === 'usdt') return usdtCents;
  const rate = Number(cur === 'transfer' ? st.rate_transfer : st.rate_mobile) || 0;
  if (!(rate > 0)) return null;
  return Math.ceil(Math.round(usdtCents * rate * 1000) / 100000) * 100;
}
// by = id del sub-admin que hizo el movimiento a mano (para el control de cupos del dueño)
const ledger = async (s, uid, cents, type, ref, note, cur = 'usdt', by = null) =>
  C.ledger.insertOne({ _id: await nextId('ledger', s), user_id: uid, amount_cents: cents, currency: curOf(cur), type, ref: ref ?? null, note: note ?? null, created_at: now(), ...(by ? { by_id: by } : {}) }, { session: s });
const addBalance = (s, uid, delta, cur = 'usdt') => C.users.updateOne({ _id: uid }, { $inc: { [CUR[curOf(cur)]]: delta } }, { session: s });
/** Descuenta saldo solo si alcanza. Devuelve true/false. */
const takeBalance = async (s, uid, cents, cur = 'usdt') => {
  const f = CUR[curOf(cur)];
  return (await C.users.updateOne({ _id: uid, [f]: { $gte: cents } }, { $inc: { [f]: -cents } }, { session: s })).matchedCount > 0;
};
/** Región/servidor de un producto (ID, BR, LATAM, EU, GLOBAL...), igual que en el portal de Central One.
 *  Usa el campo region del catálogo; si no viene, lo que va entre paréntesis en el nombre ("Free Fire (BR) · ..."). */
function variantOf(c) {
  const r = String(c.region || '').trim();
  if (r) return r.toUpperCase();
  const m = /\(([^)]+)\)\s*$/.exec(String(c.name || '').split(' · ')[0]);
  return m ? m[1].trim().toUpperCase() : 'GLOBAL';
}
const upOrder = (id, set, filter = {}) => C.orders.updateOne({ _id: id, ...filter }, { $set: { ...set, updated_at: now() } });

// ---------- ajustes del panel (los cambia el admin desde Resumen) ----------
const SETTINGS = {
  rate_transfer: { def: 0, check: v => Number(v) >= 0 && Number(v) <= 100000, cast: Number },   // CUP por 1 USDT (transferencia)
  rate_mobile: { def: 0, check: v => Number(v) >= 0 && Number(v) <= 100000, cast: Number },     // CUP por 1 USDT (saldo móvil)
  payment_transfer: { def: '', check: v => String(v).length <= 500, cast: v => String(v).trim() }, // datos de pago transferencia
  payment_mobile: { def: '', check: v => String(v).length <= 500, cast: v => String(v).trim() },   // datos de pago saldo móvil
  registration: { def: 'approval', check: v => ['off', 'approval', 'open'].includes(v), cast: String },
  default_markup: { def: 10, check: v => Number(v) >= 0 && Number(v) <= 100, cast: Number },
  trust_new_wallets: { def: 0, check: v => [0, 1, '0', '1', true, false].includes(v), cast: v => (v === 1 || v === '1' || v === true || v === 'true') ? 1 : 0 }, // las cuentas nuevas nacen con "confiar en sus billeteras"
  announcement: { def: '', check: v => String(v).length <= 500, cast: v => String(v).trim() },
  require_2fa: { def: 0, check: v => [0, 1, '0', '1', true, false].includes(v), cast: v => (v === 1 || v === '1' || v === true || v === 'true') ? 1 : 0 }, // exigir 2FA a sub-admins
  auto_backup: { def: 1, check: v => [0, 1, '0', '1', true, false].includes(v), cast: v => (v === 1 || v === '1' || v === true || v === 'true') ? 1 : 0 }, // respaldo semanal a Telegram
  maintenance: { def: 0, check: v => [0, 1, '0', '1', true, false].includes(v), cast: v => (v === 1 || v === '1' || v === true || v === 'true') ? 1 : 0 }, // modo mantenimiento: pausa las recargas
  maintenance_msg: { def: '', check: v => String(v).length <= 300, cast: v => String(v).trim() },
  rate_stale_days: { def: 3, check: v => Number(v) >= 0 && Number(v) <= 60, cast: Number }, // avisar si las tasas CUP llevan N días sin tocarse (0 = no avisar)
  usdt_autoscan: { def: 1, check: v => [0, 1, '0', '1', true, false].includes(v), cast: v => (v === 1 || v === '1' || v === true || v === 'true') ? 1 : 0 }, // abonar solos los USDT que lleguen de billeteras de confianza (sin hash)
  pay_off_usdt: { def: 0, check: v => [0, 1, '0', '1', true, false].includes(v), cast: v => (v === 1 || v === '1' || v === true || v === 'true') ? 1 : 0 }, pay_off_transfer: { def: 0, check: v => [0, 1, '0', '1', true, false].includes(v), cast: v => (v === 1 || v === '1' || v === true || v === 'true') ? 1 : 0 }, pay_off_mobile: { def: 0, check: v => [0, 1, '0', '1', true, false].includes(v), cast: v => (v === 1 || v === '1' || v === true || v === 'true') ? 1 : 0 }, // suspender pedidos de saldo por método
};
const maintMsg = st => st.maintenance_msg || 'Estamos en mantenimiento. Las recargas están en pausa, vuelve en un rato.';
async function getSettings() {
  const out = {};
  for (const [k, d] of Object.entries(SETTINGS)) { const r = await kvGet('set_' + k); out[k] = r ? d.cast(r.value) : d.def; }
  return out;
}


// ---------- permisos del sub-administrador y registro de actividad ----------
// El sub-admin solo entra a lo que el dueño le active. Nunca ve costos, ganancias, catálogo, ajustes, respaldo ni billeteras.
const STAFF_PERM = {
  'GET /api/admin/users': 'revendedores', 'POST /api/admin/users': 'revendedores', 'POST /api/admin/user-update': 'revendedores', 'POST /api/admin/user-delete': 'revendedores',
  'GET /api/admin/orders': 'pedidos', 'POST /api/admin/balance': 'ajustar', 'GET /api/admin/funds': 'saldos', 'POST /api/admin/resolve': 'pedidos', 'POST /api/admin/retry': 'pedidos',
  'GET /api/admin/topup-requests': 'saldo', 'GET /api/admin/topup-image': 'saldo', 'POST /api/admin/topup-recheck': 'saldo', 'POST /api/admin/topup-decide': 'saldo',
};
function normPerms(p = {}) {
  const n = (v, d, max) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? Math.min(x, max) : d; };
  const old = (k, legacy) => p[k] !== undefined && p[k] !== '' ? p[k] : p[legacy];
  return { revendedores: !!p.revendedores, saldo: !!p.saldo, pedidos: !!p.pedidos, ajustar: !!p.ajustar, saldos: p.saldos === undefined ? true : !!p.saldos,
    // Cada moneda tiene sus propios límites: USDT, CUP transferencia y CUP saldo móvil (independientes entre sí).
    // Cuentas viejas con un solo valor CUP: ese valor se copia a transferencia y a saldo móvil hasta que el dueño los cambie.
    max_usdt: n(p.max_usdt, 50, 100000), max_transfer: n(old('max_transfer', 'max_cup'), 20000, 10000000), max_mobile: n(old('max_mobile', 'max_cup'), 20000, 10000000),
    max_adj_usdt: n(p.max_adj_usdt, 20, 100000), max_adj_transfer: n(old('max_adj_transfer', 'max_adj_cup'), 10000, 10000000), max_adj_mobile: n(old('max_adj_mobile', 'max_adj_cup'), 10000, 10000000),
    // Cupo TOTAL de ajustes manuales (suma de lo que agrega + lo que quita) hasta que el dueño lo restablezca
    quota_usdt: n(p.quota_usdt, 100, 10000000), quota_transfer: n(old('quota_transfer', 'quota_cup'), 50000, 1000000000), quota_mobile: n(old('quota_mobile', 'quota_cup'), 50000, 1000000000) };
}
/** Cupo de ajustes manuales de un sub-admin: límite, usado y lo que le queda, por separado en USDT, transferencia y saldo móvil. */
const usedField = cur => `adj_used_${curOf(cur)}_c`;
function quotaOf(u) {
  const p = normPerms(u.perms || {}), out = { reset_at: u.quota_reset_at ? fmt(u.quota_reset_at) : null };
  for (const c of ['usdt', 'transfer', 'mobile']) { const used = (u[usedField(c)] || 0) / 100, limit = p['quota_' + c]; out[c] = { limit, used, left: Math.max(0, limit - used) }; }
  return out;
}
const AUDIT_LABEL = {
  '/api/login': 'Inicio de sesión', '/api/google': 'Inicio de sesión con Google', '/api/register': 'Registro de cuenta nueva', '/api/change-password': 'Cambio de contraseña propia',
  '/api/orders': 'Recarga enviada', '/api/topup-requests': 'Solicitud de saldo enviada', '/api/validate': 'ID verificado',
  '/api/admin/users': 'Revendedor creado', '/api/admin/balance': 'Ajuste manual de saldo', '/api/admin/funds': 'Fondos consultados', '/api/admin/user-delete': 'Cuenta borrada',
  '/api/admin/user-update': 'Cuenta modificada', '/api/admin/family': 'Juego/región activado o quitado', '/api/admin/products': 'Paquete activado',
  '/api/admin/product-update': 'Paquete modificado', '/api/admin/resolve': 'Pedido resuelto a mano', '/api/admin/retry': 'Pedido reintentado',
  '/api/admin/topup-recheck': 'Pago verificado otra vez', '/api/admin/topup-decide': 'Solicitud de saldo decidida', '/api/admin/wallet-remove': 'Billetera de confianza quitada', '/api/admin/wallet-add': 'Billetera de confianza agregada',
  '/api/admin/settings': 'Ajustes cambiados', '/api/admin/catalog-sync': 'Catálogo actualizado', '/api/admin/webhook-test': 'Aviso de prueba enviado',
  '/api/2fa/start': 'Activación de 2FA iniciada', '/api/2fa/confirm': '2FA activada', '/api/2fa/disable': '2FA desactivada', '/api/logout-all': 'Sesiones cerradas en todos los dispositivos',
  '/api/admin/backup-send': 'Respaldo enviado a Telegram', '/api/admin/restore': 'Respaldo restaurado', '/api/admin/rates-confirm': 'Tasas CUP confirmadas como vigentes',
  '/api/forgot': 'Pidió recuperar su contraseña', '/api/reset-password': 'Contraseña restablecida con código',
  '/api/admin/markup-all': 'Margen general aplicado a las cuentas', '/api/admin/staff': 'Sub-admin creado', '/api/admin/staff-update': 'Sub-admin modificado', '/api/admin/backup': 'Respaldo descargado', '/api/admin/audit.csv': 'Registro descargado (CSV)',
};
const AUDIT_SKIP = new Set(['/api/logout', '/api/validate', '/api/telegram-link', '/api/telegram-unlink']);
const AUDIT_GET = new Set(['/api/admin/backup', '/api/admin/audit.csv']);
const AUDIT_KEYS = ['amount', 'currency', 'markup_pct', 'min_margin', 'active', 'approve', 'trust_wallet', 'note', 'outcome', 'family', 'variant', 'method', 'amount_cup', 'product_id', 'username', 'address', 'reset_2fa', 'revoke', 'mode', 'maintenance', 'dry_run', 'markup_auto', 'trust_wallets', 'trust_new_wallets', 'reset_quota'];
const PWD_PATHS = new Set(['/api/change-password', '/api/admin/users', '/api/admin/user-update', '/api/admin/staff', '/api/admin/staff-update', '/api/reset-password']);
const GATE_OK = new Set(['/api/me', '/api/me-extra', '/api/2fa/start', '/api/2fa/confirm', '/api/logout', '/api/logout-all', '/api/change-password']);
function dateRange(from, to) {
  const ok = x => /^\d{4}-\d{2}-\d{2}$/.test(x || ''), r = {};
  if (ok(from)) r.$gte = new Date(from + 'T00:00:00Z');
  if (ok(to)) r.$lte = new Date(to + 'T23:59:59.999Z');
  return Object.keys(r).length ? r : null;
}
/** Nombre legible de sobre quién/qué se hizo la acción. Se calcula ANTES de ejecutarla (si borra la cuenta, luego ya no existe). */
async function auditTarget(path, b) {
  try {
    if (b.user_id) { const t = await C.users.findOne({ _id: Number(b.user_id) }); return t ? t.username : '#' + b.user_id; }
    if (path.endsWith('/topup-decide') || path.endsWith('/topup-recheck')) { const r = await C.topup_requests.findOne({ _id: Number(b.id) }); const t = r && await C.users.findOne({ _id: r.user_id }); return `Solicitud #${b.id}` + (t ? ' de ' + t.username : ''); }
    if (b.order_id) { const o = await C.orders.findOne({ _id: Number(b.order_id) }); const t = o && await C.users.findOne({ _id: o.user_id }); return `Pedido #${b.order_id}` + (t ? ' de ' + t.username : ''); }
  } catch {}
  return null;
}
async function audit(req, user, path, body, status, target, res) {
  try {
    const b = body || {}, d = {};
    if (path === '/api/admin/settings') { for (const [k, v] of Object.entries(b)) d[k] = String(v).slice(0, 80); }
    else for (const k of AUDIT_KEYS) if (b[k] !== undefined && b[k] !== null && b[k] !== '') d[k] = String(b[k]).slice(0, 120);
    if ((b.password || b.new_password) && PWD_PATHS.has(path)) d.contraseña = '(definida)';
    if (b.perms) d.permisos = JSON.stringify(b.perms).slice(0, 200);
    if (b.tx_hash) d.hash = String(b.tx_hash).slice(0, 14) + '…';
    const a = (res && res.audit) || {};
    const loginName = ['/api/login', '/api/register', '/api/forgot', '/api/reset-password'].includes(path) ? String(b.username || b.email || '').slice(0, 80) : '';
    await C.audit.insertOne({ _id: await nextId('audit'), at: now(), actor: a.actor || (user && user.username) || loginName || '?', actor_id: user ? user.id : null,
      role: a.role || (user && user.role) || 'visitante', action: path.replace(/^\/api\//, ''), label: a.label || AUDIT_LABEL[path] || (status === 403 ? 'Intento no permitido (' + path.replace(/^\/api\//, '') + ')' : path.replace(/^\/api\//, '')),
      target: target || null, detail: d, ok: status < 400, status, ip: A.clientIp(req) });
  } catch (e) { console.error('audit', e.message); }
}
const isTeamMoney = r => r.role === 'subadmin' && r.ok && (r.action === 'admin/balance' || (r.action === 'admin/topup-decide' && String((r.detail || {}).approve) === 'true'));
const auditCat = r => r.action === 'login' ? 'login' : (r.role === 'admin' || r.role === 'subadmin') ? 'staff' : 'reseller';
const auditOut = r => ({ id: r._id, at: fmt(r.at), actor: r.actor, role: r.role, label: r.label, action: r.action, target: r.target, detail: r.detail || {}, ok: r.ok, status: r.status, ip: r.ip, cat: auditCat(r) });
async function auditRows(sp, max) {
  const cat = sp.get('cat') || 'all', q = (sp.get('q') || '').trim().toLowerCase();
  const rows = (await C.audit.find({}).sort({ _id: -1 }).limit(5000).toArray()).map(auditOut)
    .filter(r => (cat === 'all' || r.cat === cat || (cat === 'fail' && !r.ok) || (cat === 'money' && isTeamMoney(r)))
      && (!q || [r.actor, r.label, r.target, r.ip, JSON.stringify(r.detail)].join(' ').toLowerCase().includes(q)));
  return rows.slice(0, max);
}


/** Aviso al dueño cuando alguien falla varias veces al entrar a una cuenta de dueño o sub-admin. */
function alertLoginFail(u, req, n) {
  if (!(u.role === 'admin' || u.role === 'subadmin') || !(n === 3 || n === 5)) return;
  TG.notifyAdmins(`🚨 ${n} intentos fallidos al entrar a la cuenta ${u.username} (${u.role === 'admin' ? 'dueño' : 'sub-admin'}) desde ${A.clientIp(req)}.` + (n >= 5 ? '\nQuedó bloqueada 15 minutos para esa conexión.' : '')).catch(() => {});
}
const csvCell = v => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
function sendCsv(res, name, header, rows) {
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' });
  res.end('\ufeff' + header + '\n' + rows.map(r => r.map(csvCell).join(',')).join('\n'));
}

// ---------- rutas API ----------
const routes = {};
const route = (m, p, role, fn) => (routes[m + ' ' + p] = { role, fn });

route('POST', '/api/login', null, async (req, res, _u, body) => {
  const username = String(body.username || '').trim();
  const key = A.clientIp(req) + '|' + username.toLowerCase();
  if (A.loginBlocked(key)) return send(res, 429, { error: 'Demasiados intentos. Espera 15 minutos.' });
  const u = await C.users.findOne({ username_lc: username.toLowerCase() });
  if (!u || !A.verifyPassword(String(body.password || ''), u.password_hash)) {
    { const n = A.loginFail(key); if (u) alertLoginFail(u, req, n); }
    return send(res, 401, { error: 'Usuario o contraseña incorrectos' });
  }
  if (!u.active) return send(res, 403, { error: u.pending_approval ? 'Tu cuenta está pendiente de aprobación por el administrador. Intenta más tarde o escríbele.' : 'Tu cuenta está desactivada. Contacta al administrador.' });
  let how = '';
  if (u.totp_on) {
    const code = String(body.code || '').trim();
    if (!code) { res.audit = { actor: u.username, role: u.role, label: 'Contraseña correcta · falta el código 2FA' }; return send(res, 200, { need_2fa: true }); }
    how = await secondFactor(u, code);
    if (!how) { alertLoginFail(u, req, A.loginFail(key)); res.audit = { actor: u.username, role: u.role, label: 'Código 2FA incorrecto' }; return send(res, 401, { error: 'Código incorrecto o vencido' }); }
  }
  A.loginOk(key); // solo se borra el contador de fallos cuando TODO salió bien (si no, se podrían adivinar códigos sin límite)
  res.audit = { actor: u.username, role: u.role, ...(how === 'recovery' ? { label: 'Inicio de sesión con código de recuperación' } : how ? { label: 'Inicio de sesión (con 2FA)' } : {}) };
  if (how === 'recovery') TG.notifyUser(u._id, `⚠️ Entraste al panel con un código de recuperación (te quedan ${Math.max(0, (u.totp_recovery || []).length - 1)}). Si no fuiste tú, cambia tu contraseña ya.`).catch(() => {});
  if ((u.role === 'admin' || u.role === 'subadmin') && u.last_ip && u.last_ip !== A.clientIp(req)) TG.notifyAdmins(`🔐 ${u.username} (${u.role === 'admin' ? 'dueño' : 'sub-admin'}) entró desde una IP nueva: ${A.clientIp(req)} (la anterior era ${u.last_ip}). Si no fue él, desactívalo en Equipo.`).catch(() => {});
  C.users.updateOne({ _id: u._id }, { $set: { last_login: now(), last_ip: A.clientIp(req) } }).catch(() => {});
  send(res, 200, { ok: true, role: u.role }, { 'Set-Cookie': A.cookieHeader(A.makeSession(u._id, u.sv || 0), 12 * 3600) });
});
// ---------- Inicio de sesión con Google (solo revendedores) ----------
// Requiere GOOGLE_CLIENT_ID (ID de cliente OAuth "Aplicación web"). El token lo valida Google; aquí se comprueba audiencia, emisor, vencimiento y correo verificado.
const GOOGLE_ID = String(process.env.GOOGLE_CLIENT_ID || '').trim();
const GOOGLE_TOKENINFO = process.env.GOOGLE_TOKENINFO_URL || 'https://oauth2.googleapis.com/tokeninfo';
const googleHits = new Map();
route('POST', '/api/google', null, async (req, res, _u, b) => {
  if (!GOOGLE_ID) return send(res, 404, { error: 'El inicio con Google no está activado.' });
  if (hitLimit(googleHits, A.clientIp(req), 30)) return send(res, 429, { error: 'Demasiados intentos. Intenta más tarde.' });
  const cred = String(b.credential || '');
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(cred) || cred.length > 4000) return send(res, 400, { error: 'Credencial inválida' });
  let t;
  try {
    const r = await fetch(GOOGLE_TOKENINFO + '?id_token=' + encodeURIComponent(cred), { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return send(res, 401, { error: 'Google no aceptó el inicio de sesión. Intenta otra vez.' });
    t = await r.json();
  } catch { return send(res, 502, { error: 'No se pudo hablar con Google. Intenta otra vez.' }); }
  const email = String(t.email || '').trim().toLowerCase();
  if (t.aud !== GOOGLE_ID || !['accounts.google.com', 'https://accounts.google.com'].includes(t.iss) || String(t.email_verified) !== 'true' || !(Number(t.exp) * 1000 > Date.now()) || !email || email.length > 120)
    return send(res, 401, { error: 'Google no aceptó el inicio de sesión. Intenta otra vez.' });
  const st = await getSettings();
  let u = await C.users.findOne({ $or: [{ username_lc: email }, { email }] });
  if (u && u.role !== 'reseller') return send(res, 403, { error: 'Las cuentas del equipo entran con usuario y contraseña.' });
  if (!u) {
    if (st.registration === 'off') return send(res, 403, { error: 'No hay una cuenta con ese correo. Pide una al administrador.' });
    const open = st.registration === 'open';
    try {
      await C.users.insertOne({ _id: await nextId('users'), username: email, username_lc: email, email, password_hash: A.hashPassword(crypto.randomBytes(24).toString('hex')), role: 'reseller', google: 1,
        balance_cents: 0, bal_transfer_cents: 0, bal_mobile_cents: 0, markup_pct: st.default_markup, markup_manual: 0, trust_wallets: 0, active: open ? 1 : 0, pending_approval: open ? 0 : 1, self_registered: 1, created_at: now() });
    } catch (e) { if (!isDup(e)) throw e; }
    TG.notifyAdmins(`🆕 Nuevo revendedor (Google): ${email}${open ? '' : '\nEstá pendiente de tu aprobación (pestaña Revendedores).'}`).catch(() => {});
    u = await C.users.findOne({ username_lc: email });
  }
  if (!u.active) return send(res, 403, { error: u.pending_approval ? 'Tu cuenta está pendiente de aprobación por el administrador. Intenta más tarde o escríbele.' : 'Tu cuenta está desactivada. Contacta al administrador.' });
  if (u.totp_on) return send(res, 403, { error: 'Tu cuenta tiene verificación en dos pasos: entra con tu contraseña y el código.' });
  res.audit = { actor: u.username, role: u.role, label: 'Inicio de sesión con Google' };
  C.users.updateOne({ _id: u._id }, { $set: { last_login: now(), last_ip: A.clientIp(req), email: u.email || email } }).catch(() => {});
  send(res, 200, { ok: true, role: u.role }, { 'Set-Cookie': A.cookieHeader(A.makeSession(u._id, u.sv || 0), 12 * 3600) });
});
route('POST', '/api/logout', null, (req, res) => send(res, 200, { ok: true }, { 'Set-Cookie': A.cookieHeader('', 0) }));


// Olvidé mi contraseña (solo revendedores): código de 6 dígitos por Telegram. Sin Telegram, se avisa al dueño para que la cambie.
const forgotHits = new Map(), resetHits = new Map();
const hitLimit = (map, ip, max) => { const t = Date.now(), h = (map.get(ip) || []).filter(x => t - x < 3600e3); if (h.length >= max) return true; h.push(t); map.set(ip, h); return false; };
route('POST', '/api/forgot', null, async (req, res, _u, b) => {
  if (hitLimit(forgotHits, A.clientIp(req), 5)) return send(res, 429, { error: 'Demasiadas solicitudes. Intenta en una hora.' });
  const generic = { ok: true, message: 'Si la cuenta existe y tiene Telegram conectado, te enviamos un código. Si no, avisamos al administrador para que te cambie la contraseña.' };
  const name = String(b.username || '').trim().toLowerCase();
  const u = name ? await C.users.findOne({ username_lc: name }) : null;
  if (!u || u.role !== 'reseller' || !u.active) return send(res, 200, generic);
  const prev = await kvGet('pr_' + u._id); let pr = null; try { pr = prev && prev.value ? JSON.parse(prev.value) : null; } catch {}
  if (pr && Date.now() - pr.at < 60000) return send(res, 200, generic); // 1 por minuto
  if (u.telegram_chat_id && TG.enabled()) {
    const code = String(crypto.randomInt(100000, 1000000));
    await kvSet('pr_' + u._id, JSON.stringify({ h: A.hashRecovery(code), exp: Date.now() + 10 * 60e3, tries: 0, at: Date.now() }));
    TG.notifyUser(u._id, `🔑 Tu código para cambiar la contraseña del panel: ${code}\nVence en 10 minutos. Si no lo pediste tú, ignora este mensaje.`).catch(() => {});
  } else {
    await kvSet('pr_' + u._id, JSON.stringify({ at: Date.now() }));
    TG.notifyAdmins(`🔑 ${u.username} olvidó su contraseña y no tiene Telegram conectado. Cámbiasela en Revendedores → Clave.`).catch(() => {});
  }
  send(res, 200, generic);
});
route('POST', '/api/reset-password', null, async (req, res, _u, b) => {
  if (hitLimit(resetHits, A.clientIp(req), 12)) return send(res, 429, { error: 'Demasiados intentos. Intenta en una hora.' });
  const bad = () => send(res, 400, { error: 'Código incorrecto o vencido. Pide uno nuevo.' });
  const u = await C.users.findOne({ username_lc: String(b.username || '').trim().toLowerCase() });
  if (!u || u.role !== 'reseller' || !u.active) return bad();
  const r = await kvGet('pr_' + u._id); let pr = null; try { pr = r && r.value ? JSON.parse(r.value) : null; } catch {}
  if (!pr || !pr.h || Date.now() > pr.exp || pr.tries >= 5) return bad();
  const a = Buffer.from(A.hashRecovery(String(b.code || ''))), c = Buffer.from(pr.h);
  if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) { pr.tries++; await kvSet('pr_' + u._id, JSON.stringify(pr)); return bad(); }
  const pw = String(b.password || '');
  if (pw.length < 8 || pw.length > 200) return send(res, 400, { error: 'La nueva contraseña debe tener 8 o más caracteres' });
  await C.users.updateOne({ _id: u._id }, { $set: { password_hash: A.hashPassword(pw), needs_password: 0 }, $inc: { sv: 1 } });
  await kvSet('pr_' + u._id, '');
  res.audit = { actor: u.username, role: 'reseller' };
  TG.notifyUser(u._id, '✅ La contraseña de tu cuenta se cambió. Si no fuiste tú, avisa al administrador ya.').catch(() => {});
  send(res, 200, { ok: true });
});

route('GET', '/api/me', 'any', async (req, res, u) => {
  const st = await getSettings();
  send(res, 200, { username: u.username, role: u.role, perms: u.role === 'subadmin' ? normPerms(u.perms || {}) : (u.perms || null), totp: !!u.totp_on, must_2fa: u.role === 'subadmin' && !u.totp_on && !!st.require_2fa, balance: (u.balance_cents || 0) / 100, balances: balancesOf(u), markup_pct: u.markup_pct, mode: MODE,
    quota: u.role === 'subadmin' ? quotaOf(u) : null,
    rates: { transfer: st.rate_transfer, mobile: st.rate_mobile },
    payment: { transfer: st.payment_transfer, mobile: st.payment_mobile },
    announcement: st.announcement, maintenance: st.maintenance ? { msg: maintMsg(st) } : null });
});

// Registro público de revendedores (correo + contraseña). Según el ajuste: cerrado, con aprobación del admin o abierto.
route('GET', '/api/public-config', null, async (req, res) => send(res, 200, { registration: (await getSettings()).registration, google_client_id: GOOGLE_ID || null }));
const regHits = new Map();
route('POST', '/api/register', null, async (req, res, _u, b) => {
  const st = await getSettings();
  if (st.registration === 'off') return send(res, 403, { error: 'El registro está cerrado. Pide una cuenta al administrador.' });
  const ip = A.clientIp(req), t = Date.now(), hits = (regHits.get(ip) || []).filter(x => t - x < 3600e3);
  if (hits.length >= 5) return send(res, 429, { error: 'Demasiados registros desde tu conexión. Intenta más tarde.' });
  const email = String(b.email || '').trim().toLowerCase(), pw = String(b.password || '');
  if (!/^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[a-z]{2,}$/i.test(email) || email.length > 120) return send(res, 400, { error: 'Correo inválido' });
  if (pw.length < 8) return send(res, 400, { error: 'La contraseña debe tener 8 o más caracteres' });
  if (pw.length > 200) return send(res, 400, { error: 'Contraseña demasiado larga' });
  hits.push(t); regHits.set(ip, hits);
  const open = st.registration === 'open';
  try {
    await C.users.insertOne({ _id: await nextId('users'), username: email, username_lc: email, email, password_hash: A.hashPassword(pw), role: 'reseller',
      balance_cents: 0, bal_transfer_cents: 0, bal_mobile_cents: 0, markup_pct: st.default_markup, markup_manual: 0, trust_wallets: 0, active: open ? 1 : 0, pending_approval: open ? 0 : 1, self_registered: 1, created_at: now() });
  } catch (e) { if (isDup(e)) return send(res, 409, { error: 'Ya existe una cuenta con ese correo' }); throw e; }
  TG.notifyAdmins(`🆕 Nuevo revendedor registrado: ${email}${open ? '' : '\nEstá pendiente de tu aprobación (pestaña Revendedores).'}`).catch(() => {});
  send(res, 201, { ok: true, active: open, message: open ? 'Cuenta creada. Ya puedes entrar.' : 'Cuenta creada. El administrador debe aprobarla antes de que puedas entrar.' });
});

// --- Subrevendedor ---
// Productos habilitados por el admin y disponibles ahora (con precio, en stock y que pidan datos de destino)
async function availableProducts(onlyId) {
  const ps = await C.products.find(onlyId ? { _id: onlyId, active: 1 } : { active: 1 }).toArray();
  if (!ps.length) return [];
  const cs = new Map((await C.catalog.find({ _id: { $in: ps.map(p => p.catalog_item_id) } }).toArray()).map(c => [c._id, c]));
  return ps.map(p => ({ p, c: cs.get(p.catalog_item_id) }))
    .filter(({ c }) => c && c.in_catalog === 1 && c.price_e4 != null && c.in_stock === 1 && c.requires_target === 1)
    .map(({ p, c }) => ({ id: p._id, name: p.name, fixed_price_cents: p.fixed_price_cents || null, family: c.family_name || 'Otros', variant: variantOf(c), product_id: c._id, price_e4: c.price_e4, target_schema: c.target_schema, ptype: p.ptype || null }));
}

route('GET', '/api/products', 'reseller', async (req, res, u) => {
  const st = await getSettings();
  send(res, 200, (await availableProducts()).sort((a, b) => a.name.localeCompare(b.name)).map(p => {
    const usd = priceFor(p, u), t = priceIn(usd, 'transfer', st), m = priceIn(usd, 'mobile', st);
    return { id: p.id, name: p.name, family: p.family, variant: p.variant, ptype: p.ptype || null, price: usd / 100,
      prices: { usdt: usd / 100, transfer: t == null ? null : t / 100, mobile: m == null ? null : m / 100 }, fields: p.target_schema };
  }));
});

/** Valida los datos del destino contra el target_schema del producto (nunca fijos en el código).
 *  Devuelve { payload } o { error }. */
function buildPayload(p, body) {
  const given = body.target && typeof body.target === 'object' ? body.target : {};
  const payload = {};
  for (const f of p.target_schema) {
    let v = given[f.key];
    if (typeof v !== 'string' && typeof v !== 'number') return { error: `Falta: ${f.label}` };
    v = String(v).trim();
    if (f.type === 'select') {
      if (!(f.options || []).some(o => o.value === v)) return { error: `Opción inválida en: ${f.label}` };
    } else {
      if (/^[\d\s\-()+]+$/.test(v)) v = v.replace(/[\s\-()]/g, ''); // números de teléfono: sin espacios ni guiones
      if (!/^[^\x00-\x1f<>]{1,64}$/.test(v)) return { error: `${f.label} inválido` };
    }
    payload[f.key] = v;
  }
  return { payload };
}

// Verificar el ID antes de comprar (POST /player/validate). Límite de Central One: 30/min para TODA la cuenta,
// así que aquí se limita a 25/min en total y 1 cada 2 s por usuario. No cobra nada y no es obligatorio.
const valHits = []; const valLast = new Map();
// Nombre de la cuenta del jugador (para el comprobante): se recuerda 30 min lo que ya verificó el revendedor y, si no lo verificó,
// se consulta solo en segundo plano al hacer el pedido (sin retrasarlo y respetando el límite de 30/min de Central One).
const nameCache = new Map();
const nameKey = (uid, catId, payload) => uid + '|' + catId + '|' + JSON.stringify(Object.keys(payload).sort().map(k => [k, String(payload[k])]));
const cleanName = n => String(n || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 40) || null;
function rememberName(k, name) {
  const n = cleanName(name); if (!n) return;
  if (nameCache.size > 2000) for (const key of [...nameCache.keys()].slice(0, 500)) nameCache.delete(key);
  nameCache.set(k, { n, at: Date.now() });
}
async function attachPlayerName(orderId, uid, p, payload) {
  const k = nameKey(uid, p.product_id, payload), hit = nameCache.get(k);
  let name = hit && Date.now() - hit.at < 30 * 60e3 ? hit.n : null;
  if (!name) {
    const t = Date.now(); while (valHits.length && t - valHits[0] > 60000) valHits.shift();
    if (valHits.length >= 20) return; // se deja margen para los botones "Verificar ID" de los revendedores
    valHits.push(t);
    try { const r = await provider.validatePlayer({ catalogItemId: p.product_id, targetPayload: payload }); if (String(r.status || '').toLowerCase() === 'valid') name = cleanName(r.name); } catch {}
  }
  if (name) await C.orders.updateOne({ _id: orderId }, { $set: { player_name: name } });
}
route('POST', '/api/validate', 'reseller', async (req, res, u, body) => {
  { const st0 = await getSettings(); if (st0.maintenance) return send(res, 503, { error: maintMsg(st0) }); }
  const p = (await availableProducts(Number(body.product_id)))[0];
  if (!p) return send(res, 400, { error: 'Producto no disponible ahora' });
  const b = buildPayload(p, body);
  if (b.error) return send(res, 400, { error: b.error });
  const t = Date.now();
  while (valHits.length && t - valHits[0] > 60000) valHits.shift();
  if (t - (valLast.get(u.id) || 0) < 2000 || valHits.length >= 25) return send(res, 429, { error: 'Espera unos segundos e intenta verificar otra vez' });
  valLast.set(u.id, t); valHits.push(t);
  try {
    const r = await provider.validatePlayer({ catalogItemId: p.product_id, targetPayload: b.payload });
    const st = String(r.status || '').toLowerCase();
    if (st === 'valid') { rememberName(nameKey(u.id, p.product_id, b.payload), r.name); return send(res, 200, { result: 'valid', name: r.name || null }); }
    if (st === 'invalid') return send(res, 200, { result: 'invalid' });
    return send(res, 200, { result: 'unverified' }); // este juego no permite verificar: se puede enviar igual
  } catch (e) {
    if (e instanceof ProviderError && e.definitive && e.code !== 'insufficient_scope' && e.code !== 'invalid_api_key') return send(res, 200, { result: 'invalid' });
    return send(res, 200, { result: 'unverified' });
  }
});

route('POST', '/api/orders', 'reseller', async (req, res, u, body) => {
  { const st0 = await getSettings(); if (st0.maintenance) return send(res, 503, { error: maintMsg(st0) }); }
  const p = (await availableProducts(Number(body.product_id)))[0];
  if (!p) return send(res, 400, { error: 'Producto no disponible ahora' });
  const b = buildPayload(p, body);
  if (b.error) return send(res, 400, { error: b.error });
  const payload = b.payload;
  const cur = curOf(body.currency);
  const priceUsd = priceFor(p, u);
  const price = priceIn(priceUsd, cur, await getSettings());
  if (price == null) return send(res, 400, { error: `El pago en ${CUR_L[cur]} no está disponible ahora.` });
  const display = Object.values(payload).join(' · ');

  // 1) Cobrar y crear el pedido en una sola transacción (no hay doble gasto)
  let orderId;
  try {
    orderId = await withTx(async s => {
      if (!await takeBalance(s, u.id, price, cur)) throw httpErr(402, `Saldo insuficiente en ${CUR_L[cur]}. Te faltan ${fmtCur(price - (u[CUR[cur]] || 0), cur)}.`);
      const id = await nextId('orders', s), t = now();
      await C.orders.insertOne({
        _id: id, user_id: u.id, product_id: p.id, product_name: p.name, target: display, catalog_item_id: p.product_id,
        target_payload: payload, cost_e4: p.price_e4, price_cents: price, currency: cur, price_usdt_cents: priceUsd, status: 'pending', idempotency_key: 'pedido-' + crypto.randomUUID(),
        provider_order_id: null, reference_code: null, detail: null, failure_code: null, refunded: 0, checked_at: null, created_at: t, updated_at: t,
      }, { session: s });
      await ledger(s, u.id, -price, 'order', String(id), `${p.name} → ${display}`, cur);
      return id;
    });
  } catch (e) { return send(res, e.http || 500, { error: e.http ? e.message : 'Error interno' }); }

  attachPlayerName(orderId, u.id, p, payload).catch(() => {}); // nombre de la cuenta para el comprobante (en segundo plano)
  // 2) Enviar al proveedor
  const r = await submitOrder(orderId);
  if (r.status === 'failed') return send(res, 422, { error: 'No se pudo procesar la recarga. Se devolvió tu saldo.', order_id: orderId, status: 'failed' });
  if (r.status === 'unknown') return send(res, 202, { ok: true, order_id: orderId, status: 'unknown', message: 'No pudimos confirmar el envío todavía. Se está verificando; no la repitas.' });
  return send(res, 202, { ok: true, order_id: orderId, status: r.status });
});

/** Cierra un pedido UNA sola vez (el estado se comprueba dentro de la transacción: no hay doble reembolso). */
async function settle(orderId, outcome, detail, failureCode) {
  const done = await withTx(async s => {
    const o = await C.orders.findOne({ _id: orderId, status: { $in: ['pending', 'processing', 'unknown'] } }, { session: s });
    if (!o) return false;
    const set = { status: outcome, updated_at: now() };
    if (outcome === 'completed') { set.detail = null; set.completed_at = set.updated_at; }
    else { if (detail != null) set.detail = detail; if (failureCode != null) set.failure_code = failureCode; }
    const refund = outcome === 'failed' && !o.refunded; // si ya se le devolvió antes, no se devuelve otra vez
    if (refund) set.refunded = 1;
    await C.orders.updateOne({ _id: orderId }, { $set: set }, { session: s });
    if (refund) {
      await addBalance(s, o.user_id, o.price_cents, o.currency);
      await ledger(s, o.user_id, o.price_cents, 'refund', String(orderId), 'Reembolso', o.currency);
    }
    return true;
  });
  if (done) notifyOrder(orderId).catch(e => console.error('aviso', e.message));
  return done;
}

/** Aviso por Telegram al revendedor (y al admin si queda para revisar). */
async function notifyOrder(orderId) {
  const o = await C.orders.findOne({ _id: orderId }); if (!o) return;
  const line = `${o.product_name} → ${o.target}`;
  if (o.status === 'completed') {
    const secs = Math.max(0, Math.round((new Date(o.completed_at || o.updated_at) - new Date(o.created_at)) / 1000));
    await TG.notifyUser(o.user_id, `✅ Recarga #${o._id} completada\n${line}${o.player_name ? '\n👤 ' + o.player_name : ''}\n⏱ ${secs < 60 ? secs + ' s' : Math.floor(secs / 60) + ' min ' + (secs % 60) + ' s'}\n${fmtCur(o.price_cents, o.currency)}`);
  }
  else if (o.status === 'failed') await TG.notifyUser(o.user_id, `❌ Recarga #${o._id} fallida\n${line}\nSe devolvió el saldo.`);
  else if (o.status === 'unknown') await TG.notifyAdmins(`⚠️ Pedido #${o._id} para revisar\n${line}\n${o.detail || ''}`);
}

/** Cobra otra vez un pedido que ya se había reembolsado. Devuelve false si el subrevendedor no tiene saldo, null si no aplica. */
function chargeAgain(orderId, note) {
  return withTx(async s => {
    const o = await C.orders.findOne({ _id: orderId, refunded: 1, status: { $in: ['failed', 'unknown'] } }, { session: s });
    if (!o) return null;
    if (!await takeBalance(s, o.user_id, o.price_cents, o.currency)) return false;
    await ledger(s, o.user_id, -o.price_cents, 'order', String(orderId), note, o.currency);
    await C.orders.updateOne({ _id: orderId }, { $set: { status: 'completed', refunded: 0, detail: note, updated_at: now(), completed_at: now() } }, { session: s });
    return true;
  }).then(r => { if (r) notifyOrder(orderId).catch(() => {}); return r; });
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
    if (last.code === 'insufficient_balance') { await kvSet('balance_low', '1'); lowBalanceAlert('Un pedido se rechazó por saldo insuficiente en Central One.'); } // el admin ve el aviso en su panel
    await settle(o._id, 'failed', last.message, last.code);
    return { status: 'failed' };
  }
  // Resultado incierto: NO reembolsar. Queda para reintento seguro / revisión del admin.
  await upOrder(o._id, { status: 'unknown', detail: String(last && last.message) });
  notifyOrder(o._id).catch(() => {});
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
const OSTAT = { unknown: ['unknown'], active: ['pending', 'processing'], completed: ['completed'], failed: ['failed'] };
const OSTAT_ES = { completed: 'Completada', failed: 'Fallida', pending: 'En proceso', processing: 'En proceso', unknown: 'Verificando' };
const LTYPE_ES = { topup: 'Recarga de saldo', adjust: 'Ajuste', order: 'Compra', refund: 'Reembolso' };
async function myOrders(u, sp, cap) {
  const q = (sp.get('q') || '').trim().toLowerCase(), f = { user_id: u.id }, lim = Math.min(Number(sp.get('limit')) || 100, cap);
  if (OSTAT[sp.get('status')]) f.status = { $in: OSTAT[sp.get('status')] };
  const dr = dateRange(sp.get('from'), sp.get('to')); if (dr) f.created_at = dr;
  let os = await C.orders.find(f).sort({ _id: -1 }).limit(q ? 3000 : lim).toArray();
  if (q) os = os.filter(o => [o._id, '#' + o._id, o.product_name, o.target].map(x => x ?? '').join(' ').toLowerCase().includes(q)).slice(0, lim);
  return os.map(o => ({
    id: o._id, product_id: o.product_id, target_payload: o.target_payload, product_name: o.product_name, target: o.target, price: o.price_cents / 100, currency: curOf(o.currency), status: o.status, created_at: fmt(o.created_at),
    reason: o.status === 'failed' ? (REASONS[o.failure_code] || 'No se pudo entregar la recarga. Se devolvió tu saldo.') : null,
    // Para el comprobante en imagen (sin precio): nombre de la cuenta y cuánto tardó
    player_name: o.player_name || null, created_ts: o.created_at ? new Date(o.created_at).getTime() : null,
    done_ts: o.status === 'completed' ? new Date(o.completed_at || o.updated_at).getTime() : null }));
}
async function myLedger(u, sp, cap) {
  const q = (sp.get('q') || '').trim().toLowerCase(), f = { user_id: u.id }, lim = Math.min(Number(sp.get('limit')) || 100, cap), cur = ['usdt', 'transfer', 'mobile'].includes(sp.get('method')) ? sp.get('method') : '';
  if (LTYPE_ES[sp.get('status')]) f.type = sp.get('status');
  const dr = dateRange(sp.get('from'), sp.get('to')); if (dr) f.created_at = dr;
  let ls = await C.ledger.find(f).sort({ _id: -1 }).limit(q || cur ? 3000 : lim).toArray();
  if (cur) ls = ls.filter(l => curOf(l.currency) === cur);
  if (q) ls = ls.filter(l => [LTYPE_ES[l.type], l.type, l.note].map(x => x ?? '').join(' ').toLowerCase().includes(q));
  return ls.slice(0, lim).map(l => ({ amount: l.amount_cents / 100, currency: curOf(l.currency), type: l.type, note: l.note, created_at: fmt(l.created_at) }));
}
route('GET', '/api/orders', 'reseller', async (req, res, u) => send(res, 200, await myOrders(u, new URL(req.url, 'http://x').searchParams, 300)));
route('GET', '/api/ledger', 'reseller', async (req, res, u) => send(res, 200, await myLedger(u, new URL(req.url, 'http://x').searchParams, 300)));
route('GET', '/api/orders.csv', 'reseller', async (req, res, u) => sendCsv(res, 'mis-recargas', 'Fecha (UTC),Número,Producto,Destino,Monto,Moneda,Estado',
  (await myOrders(u, new URL(req.url, 'http://x').searchParams, 5000)).map(o => [o.created_at, o.id, o.product_name, o.target, o.price, o.currency === 'usdt' ? 'USDT' : o.currency === 'transfer' ? 'CUP transferencia' : 'CUP saldo móvil', OSTAT_ES[o.status] || o.status])));
route('GET', '/api/ledger.csv', 'reseller', async (req, res, u) => sendCsv(res, 'mis-movimientos', 'Fecha (UTC),Tipo,Monto,Moneda,Nota',
  (await myLedger(u, new URL(req.url, 'http://x').searchParams, 5000)).map(l => [l.created_at, LTYPE_ES[l.type] || l.type, l.amount, l.currency === 'usdt' ? 'USDT' : l.currency === 'transfer' ? 'CUP transferencia' : 'CUP saldo móvil', l.note])));

// --- Admin ---
route('GET', '/api/admin/users', 'staff', async (req, res) =>
  send(res, 200, (await C.users.find({ role: 'reseller' }).sort({ _id: -1 }).toArray())
    .map(u => ({ id: u._id, username: u.username, balance: (u.balance_cents || 0) / 100, balances: balancesOf(u), markup_pct: u.markup_pct, markup_manual: !!u.markup_manual, trust_wallets: !!u.trust_wallets, min_margin: (u.min_margin_cents || 0) / 100, telegram: !!u.telegram_chat_id, active: u.active, pending: !!u.pending_approval, self_registered: !!u.self_registered, created_at: fmt(u.created_at) }))));

route('POST', '/api/admin/users', 'staff', async (req, res, _u, b) => {
  const username = String(b.username || '').trim(), pw = String(b.password || '');
  const st = await getSettings(), def = Number(st.default_markup || 0);
  const markup = _u.role === 'subadmin' ? def : Number(b.markup_pct ?? def);
  if (!/^[\w.-]{3,30}$/.test(username)) return send(res, 400, { error: 'Usuario: 3-30 letras, números, . _ -' });
  if (pw.length < 8) return send(res, 400, { error: 'La contraseña debe tener 8+ caracteres' });
  if (!(markup >= 0 && markup <= 100)) return send(res, 400, { error: 'Margen entre 0 y 100' });
  // Si el dueño escribe un margen distinto al general, queda como MANUAL (el cambio general no lo toca). Igual al general = automático.
  const extra = { markup_manual: markup !== def ? 1 : 0, trust_wallets: 0 };
  try { await createUser(username, A.hashPassword(pw), 'reseller', markup, extra); }
  catch (e) { if (isDup(e)) return send(res, 409, { error: 'Ese usuario ya existe' }); throw e; }
  send(res, 201, { ok: true });
});

async function createUser(username, hash, role, markup = 0, extra = {}) {
  return C.users.insertOne({ _id: await nextId('users'), username, username_lc: username.toLowerCase(), password_hash: hash, role,
    balance_cents: 0, bal_transfer_cents: 0, bal_mobile_cents: 0, markup_pct: markup, active: 1, created_at: now(), ...extra });
}

route('POST', '/api/admin/balance', 'staff', async (req, res, admin, b) => {
  const uid = Number(b.user_id), cents = toCents(b.amount), cur = curOf(b.currency);
  if (!Number.isInteger(uid) || !Number.isFinite(cents) || cents === 0 || Math.abs(cents) > (cur === 'usdt' ? 10000000 : 1000000000)) return send(res, 400, { error: 'Datos inválidos' });
  if (admin.role === 'subadmin') {
    const lim = Number(normPerms(admin.perms || {})['max_adj_' + cur]) * 100;
    if (Math.abs(cents) > lim) return send(res, 403, { error: `Supera tu límite por ajuste (${fmtCur(lim, cur)}). Pídele al dueño que lo haga.` });
    if (String(b.note || '').trim().length < 3) return send(res, 400, { error: 'Escribe el motivo del ajuste (mínimo 3 letras): queda en el registro.' });
    if (cur !== 'usdt' && cents % 100) return send(res, 400, { error: 'El monto en CUP debe ser entero' });
  }
  const sub = admin.role === 'subadmin', qf = usedField(cur);
  let quota = null;
  try {
    await withTx(async s => {
      const t = await C.users.findOne({ _id: uid, role: 'reseller' }, { session: s });
      if (!t) throw httpErr(404, 'Usuario no encontrado');
      const f = CUR[cur];
      // Cupo acumulado del sub-admin: lo que agrega y lo que quita se va sumando hasta que el dueño lo restablezca.
      if (sub) {
        const me = await C.users.findOne({ _id: admin.id }, { session: s }), qt = quotaOf(me || {}), q = qt[cur];
        if (Math.abs(cents) > Math.round(q.left * 100))
          throw httpErr(403, q.left <= 0 ? `Llegaste al límite de ajustes manuales (${fmtCur(q.limit * 100, cur)}). El dueño debe restablecerlo para que sigas.`
            : `Te quedan ${fmtCur(Math.round(q.left * 100), cur)} de tu límite de ajustes manuales y este movimiento es de ${fmtCur(Math.abs(cents), cur)}. Pide al dueño que lo restablezca.`);
        await C.users.updateOne({ _id: admin.id }, { $inc: { [qf]: Math.abs(cents) } }, { session: s });
        quota = quotaOf({ ...me, [qf]: (me[qf] || 0) + Math.abs(cents) });
      }
      const ch = await C.users.updateOne(cents > 0 ? { _id: uid } : { _id: uid, [f]: { $gte: -cents } }, { $inc: { [f]: cents } }, { session: s }); // abonar siempre funciona aunque el campo aún no exista
      if (!ch.matchedCount) throw httpErr(400, `El saldo en ${CUR_L[cur]} quedaría negativo`);
      await ledger(s, uid, cents, cents > 0 ? 'topup' : 'adjust', null, String(b.note || '').slice(0, 200) || `Por ${admin.username}`, cur, sub ? admin.id : null);
    });
  } catch (e) { return send(res, e.http || 500, { error: e.http ? e.message : 'Error interno' }); }
  if (sub) {
    const t = await C.users.findOne({ _id: uid }), q = quota && quota[cur];
    TG.notifyAdmins(`👤 ${admin.username} (sub-admin) ${cents > 0 ? 'AGREGÓ' : 'QUITÓ'} ${fmtCur(Math.abs(cents), cur)} ${cents > 0 ? 'a' : 'de'} ${t ? t.username : '#' + uid}\nMotivo: ${String(b.note || '').slice(0, 120)}`
      + (q ? `\nLe quedan ${fmtCur(Math.round(q.left * 100), cur)} de su límite${q.left <= 0 ? ' (LLEGÓ AL LÍMITE: restablécelo en Equipo para que siga)' : ''}.` : '')).catch(() => {});
  }
  send(res, 200, { ok: true, quota });
});

// Borrar una cuenta (solo si nunca compró ni tiene saldo: p. ej. registros falsos o rechazados)
route('POST', '/api/admin/user-delete', 'staff', async (req, res, _u, b) => {
  const id = Number(b.user_id), u = await C.users.findOne({ _id: id, role: 'reseller' });
  if (!u) return send(res, 404, { error: 'Usuario no encontrado' });
  if (u.balance_cents || u.bal_transfer_cents || u.bal_mobile_cents || await C.orders.countDocuments({ user_id: id }) || await C.ledger.countDocuments({ user_id: id }))
    return send(res, 409, { error: 'Esta cuenta tiene saldo o movimientos: desactívala en vez de borrarla.' });
  await C.users.deleteOne({ _id: id });
  send(res, 200, { ok: true });
});

route('POST', '/api/admin/user-update', 'staff', async (req, res, _u, b) => {
  if (_u.role === 'subadmin' && (b.markup_pct !== undefined || b.markup_auto !== undefined || b.trust_wallets !== undefined || b.min_margin !== undefined || b.password)) return send(res, 403, { error: 'Solo el dueño puede cambiar margen, billeteras de confianza, ganancia mínima o contraseñas.' });
  const uid = Number(b.user_id), f = { _id: uid, role: 'reseller' };
  const set = {};
  if (b.active !== undefined) { set.active = b.active ? 1 : 0; if (b.active) set.pending_approval = 0; }
  if (b.markup_pct !== undefined) {
    const m = Number(b.markup_pct);
    if (!(m >= 0 && m <= 100)) return send(res, 400, { error: 'Margen entre 0 y 100' });
    set.markup_pct = m; set.markup_manual = 1; // margen puesto a mano: el cambio general ya no lo toca
  }
  if (b.markup_auto) { set.markup_pct = Number((await getSettings()).default_markup || 0); set.markup_manual = 0; } // vuelve a seguir el margen general
  if (b.min_margin !== undefined) {
    const c = toCents(b.min_margin);
    if (!(c >= 0 && c <= 100000)) return send(res, 400, { error: 'Ganancia mínima inválida' });
    set.min_margin_cents = c;
  }
  if (b.password) {
    if (String(b.password).length < 8) return send(res, 400, { error: 'Contraseña de 8+ caracteres' });
    set.password_hash = A.hashPassword(String(b.password));
  }
  const upd = {}; if (Object.keys(set).length) upd.$set = set; if (b.password) upd.$inc = { sv: 1 }; // cambiar la clave cierra sus sesiones abiertas
  if (Object.keys(upd).length) await C.users.updateOne(f, upd);
  send(res, 200, { ok: true });
});

route('GET', '/api/admin/orders', 'staff', async (req, res, _u) => {
  const sp = new URL(req.url, 'http://x').searchParams, q = (sp.get('q') || '').trim().toLowerCase();
  const limit = Math.min(Number(sp.get('limit')) || 200, 600), f = {};
  const ST = { unknown: ['unknown'], active: ['pending', 'processing'], completed: ['completed'], failed: ['failed'] };
  if (ST[sp.get('status')]) f.status = { $in: ST[sp.get('status')] };
  const dr = dateRange(sp.get('from'), sp.get('to')); if (dr) f.created_at = dr;
  let os = await C.orders.find(f).sort({ _id: -1 }).limit(q ? 3000 : limit).toArray();
  const us = new Map((await C.users.find({ _id: { $in: [...new Set(os.map(o => o.user_id))] } }).toArray()).map(u => [u._id, u.username]));
  if (q) os = os.filter(o => [o._id, '#' + o._id, us.get(o.user_id), o.product_name, o.target, o.reference_code].map(x => x ?? '').join(' ').toLowerCase().includes(q)).slice(0, limit);
  send(res, 200, os.map(o => {
    const price = (o.price_usdt_cents ?? o.price_cents) / 100; // equivalente USDT (para la ganancia)
    return { id: o._id, username: us.get(o.user_id), product_name: o.product_name, target: o.target, price, paid: o.price_cents / 100, currency: curOf(o.currency), status: o.status,
      reference_code: o.reference_code, detail: o.detail, created_at: fmt(o.created_at), ...(_u.role === 'admin' ? { cost: e4ToStr(o.cost_e4), margin: (price - o.cost_e4 / 10000).toFixed(4) } : {}) };
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
route('GET', '/api/admin/status', 'admin', async (req, res, _u) => {
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
    telegram: TG.enabled(), telegram_linked: !!(await C.users.findOne({ _id: _u.id })).telegram_chat_id,
    low_balance_threshold: Number(((await kvGet('low_balance_threshold')) || {}).value || 0),
    settings: await getSettings(),
    rates_updated: ((await kvGet('rates_updated')) || {}).value || null, provider_down: ((await kvGet('provider_down')) || {}).value === '1', db_mode: process.env.MONGODB_URI ? 'mongodb' : 'memory',
    backup_last: ((await kvGet('backup_last')) || {}).value || null, backup_err: ((await kvGet('backup_last_err')) || {}).value || '',
  });
});

// Catálogo de Central One (copia local) para que el admin elija qué vender
// Catálogo de Central One (copia local) para que el admin elija qué vender. Se devuelve COMPLETO (antes se cortaba en 60).
route('GET', '/api/admin/catalog', 'admin', async (req, res) => {
  const q = (new URL(req.url, 'http://x').searchParams.get('q') || '').trim().toLowerCase();
  const enabled = new Map((await C.products.find({}).toArray()).map(p => [p.catalog_item_id, p]));
  const rows = (await C.catalog.find({ in_catalog: 1 }).toArray())
    .filter(c => !q || [c.name, c.sku, c.family_name].some(x => String(x || '').toLowerCase().includes(q)))
    .sort((a, b) => String(a.family_name || '').localeCompare(String(b.family_name || '')) || (a.price_e4 ?? 0) - (b.price_e4 ?? 0));
  send(res, 200, rows.map(c => {
    const pr = enabled.get(c._id);
    return { product_id: c._id, name: c.name, sku: c.sku, family: c.family_name || 'Otros', variant: variantOf(c), in_stock: c.in_stock,
      requires_target: c.requires_target, enabled: pr && pr.active ? 1 : 0, local_id: pr ? pr._id : null,
      price: c.price_e4 === null ? null : e4ToStr(c.price_e4), fields: (c.target_schema || []).map(f => f.label || f.key).join(', ') };
  }));
});

// Vender / dejar de vender todos los paquetes por ID de un juego de una vez
route('POST', '/api/admin/family', 'admin', async (req, res, _u, b) => {
  const fam = String(b.family || ''), on = !!b.active, variant = b.variant ? String(b.variant) : null;
  const items = (await C.catalog.find({ in_catalog: 1, requires_target: 1 }).toArray())
    .filter(c => (c.family_name || 'Otros') === fam && (!variant || variantOf(c) === variant));
  if (!items.length) return send(res, 404, { error: 'Ese juego no tiene paquetes por ID' });
  for (const c of items) {
    const ex = await C.products.updateOne({ catalog_item_id: c._id }, { $set: { active: on ? 1 : 0 } });
    if (!ex.matchedCount && on) {
      try { await C.products.insertOne({ _id: await nextId('products'), catalog_item_id: c._id, name: c.name.slice(0, 80), active: 1 }); }
      catch (e) { if (!isDup(e)) throw e; }
    }
  }
  send(res, 200, { ok: true, count: items.length });
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
    return { id: p._id, ptype: p.ptype || null, name: p.name, fixed_price: p.fixed_price_cents ? p.fixed_price_cents / 100 : null, family: c.family_name || 'Otros', variant: variantOf(c), active: p.active, in_stock: c.in_stock, in_catalog: c.in_catalog, requires_target: c.requires_target,
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
  if (b.fixed_price !== undefined) {
    if (b.fixed_price === null || b.fixed_price === '') set.fixed_price_cents = null;
    else { const c = toCents(b.fixed_price); if (!(c > 0 && c <= 10000000)) return send(res, 400, { error: 'Precio inválido' }); set.fixed_price_cents = c; }
  }
  if (b.ptype !== undefined) {
    if (!['', 'diamantes', 'pases', 'membresias', 'otros'].includes(b.ptype)) return send(res, 400, { error: 'Tipo inválido' });
    set.ptype = b.ptype || null;
  }
  if (b.name !== undefined) {
    const n = String(b.name).trim();
    if (!n || n.length > 80) return send(res, 400, { error: 'Nombre inválido' });
    set.name = n;
  }
  if (Object.keys(set).length) await C.products.updateOne({ _id: id }, { $set: set });
  send(res, 200, { ok: true });
});

// El admin resuelve pedidos "unknown" tras comprobarlos en el portal del proveedor
route('POST', '/api/admin/resolve', 'staff', async (req, res, _u, b) => {
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

route('POST', '/api/admin/retry', 'staff', async (req, res, _u, b) => {
  const id = Number(b.order_id);
  const o = await C.orders.findOne({ _id: id, status: 'unknown' });
  if (!o) return send(res, 404, { error: 'Pedido no encontrado o ya resuelto' });
  send(res, 200, await submitOrder(id)); // misma Idempotency-Key y mismo cuerpo: seguro
});

route('GET', '/api/admin/provider-balance', 'admin', async (req, res) => {
  try { send(res, 200, await provider.getBalance()); }
  catch (e) { send(res, 502, { error: e.message }); }
});


// ---------- Telegram ----------
route('POST', '/api/telegram-link', 'any', async (req, res, u) => {
  const url = await TG.linkFor(u.id);
  if (!url) return send(res, 400, { error: 'Telegram no está configurado en el servidor (falta TELEGRAM_BOT_TOKEN)' });
  send(res, 200, { url });
});
route('POST', '/api/telegram-unlink', 'any', async (req, res, u) => {
  await C.users.updateOne({ _id: u.id }, { $set: { telegram_chat_id: null } }); send(res, 200, { ok: true });
});
route('GET', '/api/me-extra', 'any', async (req, res, u) => {
  const d = await C.users.findOne({ _id: u.id });
  send(res, 200, { telegram: TG.enabled(), telegram_linked: !!d.telegram_chat_id, store_name: d.store_name || '', store_logo: d.store_logo || '' });
});
// Tienda del revendedor: nombre e icono que salen en sus comprobantes
route('POST', '/api/store', 'reseller', async (req, res, u, b) => {
  const name = String(b.name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 40);
  const logo = b.logo ? String(b.logo) : '';
  if (logo && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(logo) || logo.length > 150000)) return send(res, 400, { error: 'Imagen no válida' });
  const set = { store_name: name };
  if (b.logo !== undefined) set.store_logo = logo;
  await C.users.updateOne({ _id: u.id }, { $set: set });
  send(res, 200, { ok: true });
});

// ---------- Solicitudes de saldo: USDT BEP20 ----------
// Con hash: el panel verifica el pago en BSC. Si es válido y viene de una billetera que ya aprobaste para ese revendedor,
// se abona solo. Si la billetera es nueva o algo no cuadra, queda para que lo apruebes tú (como siempre).
const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';

route('GET', '/api/deposit-info', 'any', async (req, res, u) => {
  const st = await getSettings();
  send(res, 200, { wallet: BSC.wallet(), auto: BSC.enabled(), network: 'BSC (BEP20)', token: 'USDT', min_confirmations: BSC.minConf,
    payment_transfer: st.payment_transfer, payment_mobile: st.payment_mobile,
    rates: { transfer: st.rate_transfer, mobile: st.rate_mobile },
    suspended: { usdt: !!st.pay_off_usdt, transfer: !!st.pay_off_transfer, mobile: !!st.pay_off_mobile } });
});

route('POST', '/api/topup-requests', 'reseller', async (req, res, u, b) => {
  const method = ['usdt', 'transfer', 'mobile'].includes(b.method) ? b.method : 'usdt';
  { const st0 = await getSettings(); if (st0['pay_off_' + method]) return send(res, 400, { error: 'Los pagos por ' + { usdt: 'USDT', transfer: 'transferencia', mobile: 'saldo móvil' }[method] + ' están suspendidos por ahora. Usa otro método o inténtalo más tarde.' }); }
  const hash = (BSC.enabled() && (b.method || 'usdt') === 'usdt') ? '' : String(b.tx_hash || '').trim().toLowerCase(); // con verificación automática ya no se usa hash
  if (hash && !BSC.isHash(hash)) return send(res, 400, { error: 'El hash no es válido. Debe empezar por 0x y tener 66 caracteres.' });
  const cents = b.amount === undefined || b.amount === '' ? null : toCents(b.amount);
  if (method === 'usdt') {
    if (cents !== null && !(cents >= 1 && cents <= 10000000)) return send(res, 400, { error: 'Monto inválido: escribe un monto desde 0.01 USDT.' });
    if (!hash && cents === null) return send(res, 400, { error: 'Pega el hash de la transacción (o indica el monto si pagaste de otra forma).' });
  } else {
    // Transferencia / saldo móvil: monto en CUP obligatorio
    const cupCents = b.amount_cup === undefined || b.amount_cup === '' ? null : Math.round(Number(String(b.amount_cup).replace(',', '.')) * 100);
    if (!(cupCents > 0 && cupCents <= 100000000)) return send(res, 400, { error: 'Indica el monto que enviaste en CUP.' });
    if (cupCents % 100) return send(res, 400, { error: 'El monto en CUP debe ser un número entero.' });
    b._cup_cents = cupCents; // se abona en CUP a su saldo de transferencia o de saldo móvil (sin convertir)
  }
  const img = b.image ? String(b.image) : null;
  if (img && (img.length > 2400000 || !IMG_RE.test(img))) return send(res, 400, { error: 'La imagen no es válida o es muy grande' });
  if (method === 'usdt' && BSC.enabled()) {
    // Pago con MONTO EXACTO (sin hash): se le asigna un monto único (ej. 5.0037) y el pago se reconoce solo cuando llega ESE monto exacto.
    if (cents === null || !(cents >= 1)) return send(res, 400, { error: 'Escribe cuánto USDT vas a enviar (desde 0.01).' });
    if (await C.topup_requests.countDocuments({ user_id: u.id, status: 'pending', method: 'usdt', expect_e4: { $exists: true } }) >= 2) return send(res, 429, { error: 'Ya tienes 2 pagos esperando. Envía alguno de esos montos o espera a que venzan (24 h).' });
    let start = null; try { start = await BSC.blockNumber(); } catch {}
    const taken = new Set((await C.topup_requests.find({ method: 'usdt', status: 'pending', expect_e4: { $exists: true } }).toArray()).map(x => x.expect_e4));
    // Se le suma al monto una pequeña cantidad única en centavos (ej. 5 → 5.08). Se abona TODO lo que envía (5.08).
    const free = Array.from({ length: 99 }, (_, i) => i + 1).filter(t => !taken.has((cents + t) * 100));
    const near = free.filter(t => t <= 20), pool = near.length ? near : free;
    if (!pool.length) return send(res, 409, { error: 'Ese monto está muy pedido ahora mismo. Cambia el monto por unos centavos.' });
    const tag = pool[crypto.randomInt(0, pool.length)], total = cents + tag, e4 = total * 100;
    if (total > 10000000) return send(res, 400, { error: 'Monto demasiado grande.' });
    const id = await nextId('topup_requests');
    await C.topup_requests.insertOne({ _id: id, user_id: u.id, method: 'usdt', amount_cents: total, amount_cup: null, note: '', image: null, status: 'pending', admin_note: null,
      approved_cents: null, created_at: now(), decided_at: null, chain: null, verify: 'wait', verify_msg: 'Esperando tu pago', expect_e4: e4, start_block: start, expires_at: new Date(Date.now() + 24 * 3600e3) });
    return send(res, 201, { ok: true, id, auto: 'wait', pay_amount: (e4 / 1e4).toFixed(2), message: `Envía EXACTAMENTE ${(e4 / 1e4).toFixed(2)} USDT (BEP20). Se abona solo al llegar.` });
  }
  if (await C.topup_requests.countDocuments({ user_id: u.id, status: 'pending' }) >= 3) return send(res, 429, { error: 'Ya tienes 3 solicitudes pendientes. Espera a que se revisen.' });
  const id = await nextId('topup_requests');
  const doc = { _id: id, user_id: u.id, method,
    amount_cents: method === 'usdt' ? cents : b._cup_cents,
    amount_cup: method !== 'usdt' ? b._cup_cents : null,
    note: String(b.note || '').slice(0, 300), image: img, status: 'pending', admin_note: null,
    approved_cents: null, created_at: now(), decided_at: null, chain: null,
    verify: method !== 'usdt' ? 'manual' : (hash ? (BSC.enabled() ? 'wait' : 'manual') : 'manual'),
    verify_msg: method !== 'usdt' ? null : (hash && !BSC.enabled() ? 'Verificación automática no configurada' : null) };
  if (hash) doc.tx_hash = hash;
  try { await C.topup_requests.insertOne(doc); }
  catch (e) { if (isDup(e)) return send(res, 409, { error: 'Ese hash ya se usó en otra solicitud.' }); throw e; }
  if (method === 'usdt' && hash && BSC.enabled()) {
    const r = await verifyDeposit(id);
    if (r === 'approved') return send(res, 201, { ok: true, id, auto: 'approved', message: 'Pago verificado en la blockchain. Saldo abonado.' });
    if (r === 'wait') return send(res, 201, { ok: true, id, auto: 'wait', message: 'Pago recibido. Esperando confirmaciones en BSC; se abona solo en unos minutos.' });
    return send(res, 201, { ok: true, id, auto: 'manual', message: 'Solicitud enviada. El administrador la revisará.' });
  }
  const METHOD_L = { usdt: 'USDT BEP20', transfer: 'Transferencia', mobile: 'Saldo móvil' };
  const amt = method === 'usdt' ? (cents !== null ? fmtCur(cents, 'usdt') : '') : fmtCur(b._cup_cents, method);
  TG.notifyAdmins(`💰 Solicitud de saldo #${id} (${METHOD_L[method]})\n${u.username}: ${amt}${hash ? '\nHash: ' + hash : ''}\nRevísala en el panel → Saldo.`).catch(() => {});
  send(res, 201, { ok: true, id, auto: 'manual', message: 'Solicitud enviada. El administrador la revisará.' });
});

/** Revisa en BSC una solicitud con hash y actúa. Devuelve 'approved' | 'wait' | 'manual'. Nunca abona dos veces. */
let verifying = new Set();
async function verifyDeposit(id) {
  if (verifying.has(id)) return 'wait';
  verifying.add(id);
  try {
    const t = await C.topup_requests.findOne({ _id: id, status: 'pending' });
    if (!t || !t.tx_hash) return 'manual';
    const r = await BSC.check(t.tx_hash);
    const u = await C.users.findOne({ _id: t.user_id });
    if (r.state === 'wait' || r.state === 'error') {
      const old = Date.now() - t.created_at.getTime() > 2 * 3600e3;
      await C.topup_requests.updateOne({ _id: id, status: 'pending' }, { $set: { verify: old ? 'manual' : 'wait', verify_msg: old ? 'Pasaron 2 horas sin confirmar: ' + r.msg : r.msg } });
      if (old) TG.notifyAdmins(`⚠️ Solicitud #${id} de ${u.username}: no se pudo confirmar en 2 h. Revísala.\n${r.msg}`).catch(() => {});
      return old ? 'manual' : 'wait';
    }
    if (r.state === 'bad') {
      await C.topup_requests.updateOne({ _id: id, status: 'pending' }, { $set: { verify: 'bad', verify_msg: r.msg } });
      TG.notifyAdmins(`⚠️ Solicitud #${id} de ${u.username}: el hash no cuadra. ${r.msg}`).catch(() => {});
      return 'manual';
    }
    // Pago válido en la blockchain
    const chain = { from: r.from, cents: r.cents, block: r.block };
    const w = null; // las billeteras ya no autorizan abonos automáticos: un hash válido siempre lo confirma el admin
    // Una billetera NUEVA nunca se registra sola: el hash de una transacción es público y cualquiera podría reclamar el pago de otro.
    // El administrador debe aprobar la primera vez (y comprobar con quién habló) o registrar la billetera él mismo.
    if (w && w.user_id === t.user_id) {
      const done = await withTx(async s => {
        const ch = await C.topup_requests.updateOne({ _id: id, status: 'pending' }, { $set: { status: 'approved', approved_cents: r.cents, chain, verify: 'ok',
          verify_msg: 'Verificado en BSC', admin_note: 'Aprobado automáticamente (blockchain)', decided_at: now() } }, { session: s });
        if (!ch.modifiedCount) return false;
        await addBalance(s, t.user_id, r.cents);
        await ledger(s, t.user_id, r.cents, 'topup', 'req-' + id, `USDT BEP20 · solicitud #${id}`);
        return true;
      });
      if (done) {
        TG.notifyUser(t.user_id, `✅ Pago verificado: se te abonaron ${(r.cents / 100).toFixed(2)} USDT (solicitud #${id}).`).catch(() => {});
        TG.notifyAdmins(`✅ Depósito automático #${id}: ${u.username} +${(r.cents / 100).toFixed(2)} USDT desde ${short(r.from)}`).catch(() => {});
      }
      return 'approved';
    }
    const why = w ? `Pago válido de ${(r.cents / 100).toFixed(2)} USDT, pero la billetera ${short(r.from)} está asociada a OTRO revendedor.`
      : `Pago válido de ${(r.cents / 100).toFixed(2)} USDT desde una billetera nueva (${short(r.from)}). Compruébalo con el cliente antes de aprobar: el hash es público y otra persona pudo copiarlo.`;
    await C.topup_requests.updateOne({ _id: id, status: 'pending' }, { $set: { chain, verify: 'verified', verify_msg: why } });
    TG.notifyAdmins(`💰 Solicitud #${id} de ${u.username}\n${why}`).catch(() => {});
    return 'manual';
  } finally { verifying.delete(id); }
}
/** Detecta en la blockchain los USDT enviados a tu billetera desde billeteras de confianza y los abona solos, sin que el revendedor
 *  mande hash ni comprobante. Solo mira bloques NUEVOS desde que se encendió (nunca recorre el pasado), con las mismas confirmaciones
 *  que la verificación por hash. Cada transacción se abona una sola vez (índice único por hash). */
let scanning = false, scanErrAt = 0;
async function scanDeposits() {
  if (!BSC.enabled() || scanning) return;
  scanning = true;
  try {
    const st = await getSettings(), head = await BSC.blockNumber(), safe = head - BSC.minConf + 1;
    const cur = await kvGet('bsc_scan_block');
    for (const x of await C.topup_requests.find({ status: 'pending', expect_e4: { $exists: true } }).toArray()) // pagos con monto exacto que vencieron
      if (x.expires_at && x.expires_at < new Date()) await C.topup_requests.updateOne({ _id: x._id, status: 'pending' }, { $set: { status: 'rejected', admin_note: 'Venció: no llegó el pago en 24 h', decided_at: now() } });
    if (!cur) { await kvSet('bsc_scan_block', safe); return; } // primera vez: se parte desde ahora
    let from = Number(cur.value) + 1;
    if (!(from <= safe)) return;
    if (safe - from > 20000) from = safe - 20000; // tras una caída muy larga solo se retoman los últimos ~16 h
    for (let n = 0; n < 12 && from <= safe; n++) {
      const to = Math.min(from + 999, safe);
      const found = await BSC.transfersTo(from, to);
      const byTx = new Map();
      for (const t of found) { const k = t.tx + '|' + t.from, x = byTx.get(k) || { tx: t.tx, from: t.from, cents: 0, e4: 0, block: t.block }; x.cents += t.cents; x.e4 += t.e4; byTx.set(k, x); }
      for (const t of byTx.values()) await creditScanned(t).catch(e => console.error('escáner', t.tx.slice(0, 12), e.message));
      await kvSet('bsc_scan_block', to); from = to + 1;
    }
  } catch (e) {
    if (Date.now() - scanErrAt > 3600e3) { scanErrAt = Date.now(); console.error('Detección de depósitos USDT:', e.message); }
  } finally { scanning = false; }
}
/** Guarda (últimos 40) los pagos que llegaron a tu billetera y no se pudieron asignar a nadie, para que los resuelvas a mano. */
async function noteUnmatched(t, why) {
  const r = await kvGet('usdt_unmatched'); let l = []; try { l = r && r.value ? JSON.parse(r.value) : []; } catch {}
  if (l.some(x => x.tx === t.tx && x.from === t.from)) return;
  l.unshift({ tx: t.tx, from: t.from, usdt: t.e4 / 1e4, at: new Date().toISOString(), why }); await kvSet('usdt_unmatched', JSON.stringify(l.slice(0, 40)));
  TG.notifyAdmins(`❔ Llegaron ${(t.e4 / 1e4).toFixed(4)} USDT desde ${short(t.from)} que no coinciden con ningún pago pedido.\n${why}\nSi es de un cliente, abónale el saldo a mano (Revendedores → Saldo).`).catch(() => {});
}
/** Pago con monto exacto: si lo recibido coincide con el monto único de una solicitud pendiente, se abona a ESE revendedor. */
async function creditTagged(t) {
  const req = await C.topup_requests.findOne({ method: 'usdt', status: 'pending', expect_e4: t.e4 });
  if (!req) return false;
  if (req.start_block && t.block < req.start_block) return false; // el pago es anterior a la solicitud
  const u = await C.users.findOne({ _id: req.user_id, role: 'reseller' });
  if (!u || !u.active) return false;
  const cents = req.amount_cents, chain = { from: t.from, cents: t.cents, block: t.block };
  const done = await withTx(async s => {
    const ch = await C.topup_requests.updateOne({ _id: req._id, status: 'pending' }, { $set: { status: 'approved', approved_cents: cents, chain, verify: 'ok', verify_msg: 'Pago exacto detectado en BSC', tx_hash: t.tx, admin_note: 'Abonado automáticamente (monto exacto)', decided_at: now() } }, { session: s });
    if (!ch.modifiedCount) return false;
    await addBalance(s, u._id, cents);
    await ledger(s, u._id, cents, 'topup', 'req-' + req._id, `USDT BEP20 · monto exacto (#${req._id})`);
    return true;
  }).catch(e => { if (isDup(e)) return null; throw e; });
  if (!done) return !!(done === null);
  TG.notifyUser(u._id, `✅ Recibimos tu pago: se te abonaron ${(cents / 100).toFixed(2)} USDT.`).catch(() => {});
  TG.notifyAdmins(`✅ Depósito automático #${req._id}: ${u.username} +${(cents / 100).toFixed(2)} USDT (monto exacto) desde ${short(t.from)}`).catch(() => {});
  return true;
}
async function creditScanned(t) {
  if (t.cents < 1) return;
  if (await C.topup_requests.findOne({ tx_hash: t.tx })) return; // ya se abonó o tiene solicitud
  if (await creditTagged(t)) return;
  return noteUnmatched(t, 'El monto no es exacto o no hay un pedido que coincida.'); // no se abona a nadie: puede ser un envío ajeno
}
async function recheckDeposits() {
  if (!BSC.enabled()) return;
  for (const t of await C.topup_requests.find({ status: 'pending', verify: 'wait' }).sort({ _id: 1 }).limit(10).toArray()) await verifyDeposit(t._id);
}

const trOut = (r, admin) => ({ id: r._id, method: r.method || 'usdt', currency: curOf(r.method), // montos en la moneda del método (USDT o CUP)
  amount: r.method && r.method !== 'usdt' ? (r.amount_cup == null ? null : r.amount_cup / 100) : (r.amount_cents == null ? null : r.amount_cents / 100),
  approved: r.approved_cents == null ? null : r.approved_cents / 100,
  amount_cup: r.amount_cup == null ? null : r.amount_cup / 100,
  note: r.note, status: r.status, admin_note: r.admin_note, has_image: !!r.image, created_at: fmt(r.created_at), decided_at: fmt(r.decided_at),
  pay_amount: r.expect_e4 && r.status === 'pending' ? (r.expect_e4 / 1e4).toFixed(2) : null, expires_at: r.expect_e4 && r.status === 'pending' && r.expires_at ? fmt(r.expires_at) : null,
  tx_hash: r.tx_hash || null, verify: r.verify || 'manual', verify_msg: r.verify_msg || null,
  chain_amount: r.chain ? r.chain.cents / 100 : null, chain_from: admin && r.chain ? r.chain.from : undefined });
route('GET', '/api/admin/usdt-unmatched', 'staff', async (req, res) => {
  const r = await kvGet('usdt_unmatched'); let l = []; try { l = r && r.value ? JSON.parse(r.value) : []; } catch {}
  send(res, 200, l);
});
route('GET', '/api/topup-requests', 'reseller', async (req, res, u) =>
  send(res, 200, (await C.topup_requests.find({ user_id: u.id }).sort({ _id: -1 }).limit(20).toArray()).map(r => trOut(r, false))));

route('GET', '/api/admin/topup-requests', 'staff', async (req, res) => {
  const sp = new URL(req.url, 'http://x').searchParams, q = (sp.get('q') || '').trim().toLowerCase();
  const limit = Math.min(Number(sp.get('limit')) || 100, 400), f = {}, method = ['usdt', 'transfer', 'mobile'].includes(sp.get('method')) ? sp.get('method') : '';
  if (['pending', 'approved', 'rejected'].includes(sp.get('status'))) f.status = sp.get('status');
  const dr = dateRange(sp.get('from'), sp.get('to')); if (dr) f.created_at = dr;
  const us = new Map((await C.users.find({}).toArray()).map(x => [x._id, x.username]));
  let rs = await C.topup_requests.find(f).sort({ _id: -1 }).limit(q || method ? 3000 : limit).toArray();
  if (method) rs = rs.filter(r => (r.method || 'usdt') === method);
  if (q) rs = rs.filter(r => [r._id, '#' + r._id, us.get(r.user_id), r.note, r.tx_hash, r.admin_note].map(x => x ?? '').join(' ').toLowerCase().includes(q));
  rs = rs.slice(0, limit);
  send(res, 200, rs.map(r => ({ ...trOut(r, true), username: us.get(r.user_id),
    wallet_owner: null })));
});
route('GET', '/api/admin/topup-image', 'staff', async (req, res) => {
  const r = await C.topup_requests.findOne({ _id: Number(new URL(req.url, 'http://x').searchParams.get('id')) });
  send(res, 200, { image: r ? r.image : null });
});
route('POST', '/api/admin/topup-recheck', 'staff', async (req, res, _u, b) => {
  const id = Number(b.id);
  await C.topup_requests.updateOne({ _id: id, status: 'pending', tx_hash: { $exists: true } }, { $set: { verify: 'wait' } });
  send(res, 200, { ok: true, result: BSC.enabled() ? await verifyDeposit(id) : 'manual' });
});
route('POST', '/api/admin/topup-decide', 'staff', async (req, res, admin, b) => {
  const id = Number(b.id), approve = !!b.approve;
  try {
    const r = await withTx(async s => {
      const t = await C.topup_requests.findOne({ _id: id, status: 'pending' }, { session: s });
      if (!t) throw httpErr(404, 'Solicitud no encontrada o ya revisada');
      const cur = curOf(t.method);
      const def = t.chain ? t.chain.cents : (cur === 'usdt' ? t.amount_cents : t.amount_cup);
      const cents = approve ? (b.amount !== undefined && b.amount !== '' ? toCents(b.amount) : def) : null;
      if (approve && !(cents > 0 && cents <= (cur === 'usdt' ? 10000000 : 1000000000))) throw httpErr(400, 'Monto inválido');
      if (approve && cur !== 'usdt' && cents % 100) throw httpErr(400, 'El monto en CUP debe ser entero');
      if (approve && admin.role === 'subadmin') {
        const lim = Number(normPerms(admin.perms || {})['max_' + cur]) * 100;
        if (cents > lim) throw httpErr(403, `Supera tu límite de aprobación (${fmtCur(lim, cur)}). Pídele al dueño que lo apruebe.`);
      }
      await C.topup_requests.updateOne({ _id: id }, { $set: { status: approve ? 'approved' : 'rejected', approved_cents: cents, admin_note: String(b.note || '').slice(0, 200) || null, decided_at: now() } }, { session: s });
      if (approve) {
        await addBalance(s, t.user_id, cents, cur);
        await ledger(s, t.user_id, cents, 'topup', 'req-' + id, `Solicitud #${id} aprobada por ${admin.username}`, cur, admin.role === 'subadmin' ? admin.id : null);
      }
      return { user_id: t.user_id, cents, cur, from: t.chain ? t.chain.from : null };
    });
    if (admin.role === 'subadmin') { const tu = await C.users.findOne({ _id: r.user_id }); TG.notifyAdmins(`👤 ${admin.username} (sub-admin) ${approve ? 'APROBÓ' : 'rechazó'} la solicitud #${id} de ${tu ? tu.username : '?'}${approve ? ': +' + fmtCur(r.cents, r.cur) : ''}`).catch(() => {}); }
    TG.notifyUser(r.user_id, approve ? `✅ Se te abonaron ${fmtCur(r.cents, r.cur)} (solicitud #${id}).` : `❌ Tu solicitud de saldo #${id} fue rechazada.${b.note ? '\n' + b.note : ''}`).catch(() => {});
  } catch (e) { return send(res, e.http || 500, { error: e.http ? e.message : 'Error interno' }); }
  send(res, 200, { ok: true });
});

// ---------- Reportes de ganancia ----------
route('GET', '/api/admin/report', 'admin', async (req, res) => {
  const period = new URL(req.url, 'http://x').searchParams.get('period') || 'day';
  const d = new Date(); d.setUTCHours(0, 0, 0, 0);
  if (period === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // lunes
  if (period === 'month') d.setUTCDate(1);
  if (period === 'all') d.setTime(0);
  const rows = await C.orders.find({ status: 'completed', created_at: { $gte: d } }).toArray();
  const users = new Map((await C.users.find({ role: 'reseller' }).toArray()).map(u => [u._id, u.username]));
  const by = new Map(), prod = new Map();
  let sold = 0, cost = 0;
  for (const o of rows) {
    const c = Math.round(o.cost_e4 / 100), pu = o.price_usdt_cents ?? o.price_cents; sold += pu; cost += c;
    const x = by.get(o.user_id) || { username: users.get(o.user_id) || '#' + o.user_id, count: 0, sold: 0, profit: 0 };
    x.count++; x.sold += pu; x.profit += pu - c; by.set(o.user_id, x);
    const y = prod.get(o.product_name) || { name: o.product_name, count: 0, profit: 0 }; y.count++; y.profit += pu - c; prod.set(o.product_name, y);
  }
  // últimos 14 días, para la gráfica de barras
  const since = new Date(Date.now() - 13 * 864e5); since.setUTCHours(0, 0, 0, 0);
  const days = new Map(); for (let i = 0; i < 14; i++) days.set(new Date(since.getTime() + i * 864e5).toISOString().slice(0, 10), 0);
  for (const o of await C.orders.find({ status: 'completed', created_at: { $gte: since } }).toArray()) {
    const k = o.created_at.toISOString().slice(0, 10); if (days.has(k)) days.set(k, days.get(k) + (o.price_usdt_cents ?? o.price_cents) - Math.round(o.cost_e4 / 100));
  }
  const c2 = v => v / 100;
  send(res, 200, { from: fmt(d), count: rows.length, sold: c2(sold), cost: c2(cost), profit: c2(sold - cost),
    resellers: [...by.values()].sort((a, b) => b.profit - a.profit).map(x => ({ ...x, sold: c2(x.sold), profit: c2(x.profit) })),
    // Ranking: quién vende más recargas (por cantidad; si empatan, por monto vendido)
    ranking: [...by.values()].sort((a, b) => b.count - a.count || b.sold - a.sold).map(x => ({ username: x.username, count: x.count, sold: c2(x.sold), share: rows.length ? Math.round(x.count / rows.length * 1000) / 10 : 0 })),
    products: [...prod.values()].sort((a, b) => b.profit - a.profit).slice(0, 10).map(x => ({ ...x, profit: c2(x.profit) })),
    daily: [...days].map(([day, p]) => ({ day, profit: c2(p) })) });
});

// ---------- Ajustes y respaldo ----------
route('POST', '/api/admin/settings', 'admin', async (req, res, _u, b) => {
  if (b.low_balance_threshold !== undefined) {
    const n = Number(b.low_balance_threshold);
    if (!(n >= 0 && n <= 100000)) return send(res, 400, { error: 'Valor inválido' });
    await kvSet('low_balance_threshold', n);
  }
  for (const [k, d] of Object.entries(SETTINGS)) {
    if (b[k] === undefined) continue;
    const v = typeof b[k] === 'string' && d.cast === Number ? b[k].replace(',', '.') : b[k];
    if (!d.check(v)) return send(res, 400, { error: 'Valor inválido: ' + k });
    await kvSet('set_' + k, d.cast(v));
  }
  if (b.rate_transfer !== undefined || b.rate_mobile !== undefined) await kvSet('rates_updated', new Date().toISOString());
  send(res, 200, { ok: true });
});
// Margen general: se guarda como margen de las cuentas nuevas y se aplica a TODAS las cuentas "automáticas".
// Las cuentas con margen puesto a mano (markup_manual) no se tocan: solo el dueño las cambia, una por una.
route('POST', '/api/admin/markup-all', 'admin', async (req, res, _u, b) => {
  const m = Number(String(b.markup_pct ?? '').replace(',', '.'));
  if (!(m >= 0 && m <= 100) || b.markup_pct === '' || b.markup_pct == null) return send(res, 400, { error: 'Margen entre 0 y 100' });
  await kvSet('set_default_markup', m);
  const r = await C.users.updateMany({ role: 'reseller', markup_manual: { $ne: 1 } }, { $set: { markup_pct: m, markup_manual: 0 } });
  const skipped = await C.users.countDocuments({ role: 'reseller', markup_manual: 1 });
  send(res, 200, { ok: true, markup_pct: m, applied: r.matchedCount, skipped });
});
route('POST', '/api/admin/rates-confirm', 'admin', async (req, res) => { await kvSet('rates_updated', new Date().toISOString()); await kvSet('rates_alert_at', 0); send(res, 200, { ok: true }); });


// ---------- 2FA, respaldo automático y sesiones ----------
/** Comprueba el segundo factor: código de la app (sin reutilizar) o código de recuperación (se gasta). Devuelve 'totp' | 'recovery' | false. */
async function secondFactor(u, code) {
  const secret = A.unseal(u.totp_secret || '');
  if (secret) {
    const step = A.totpCheck(secret, code, u.totp_last || 0);
    if (step) { await C.users.updateOne({ _id: u._id }, { $set: { totp_last: step } }); return 'totp'; }
  }
  const h = A.hashRecovery(code);
  if ((u.totp_recovery || []).includes(h)) { await C.users.updateOne({ _id: u._id }, { $set: { totp_recovery: u.totp_recovery.filter(x => x !== h) } }); return 'recovery'; }
  return false;
}
async function envReset2fa() { // salida de emergencia si pierdes el teléfono y los códigos: variable RESET_2FA_FOR=tu_usuario en Render, y la borras después
  const n = String(process.env.RESET_2FA_FOR || '').trim().toLowerCase(); if (!n) return;
  const r = await C.users.updateOne({ username_lc: n }, { $set: { totp_on: 0, totp_secret: null, totp_recovery: [], totp_pending: null }, $inc: { sv: 1 } });
  if (!r.matchedCount) return console.error('RESET_2FA_FOR: no existe el usuario ' + n);
  console.warn(`⚠ 2FA desactivada para "${n}" por RESET_2FA_FOR. Borra esa variable ahora.`);
  try { await C.audit.insertOne({ _id: await nextId('audit'), at: now(), actor: 'sistema', actor_id: null, role: 'sistema', action: 'reset-2fa', label: '2FA desactivada por RESET_2FA_FOR', target: n, detail: {}, ok: true, status: 200, ip: '-' }); } catch {}
}
async function backupObject(strip) {
  const out = { exported_at: new Date().toISOString(), version: 1 };
  for (const n of ['users', 'ledger', 'products', 'orders', 'topup_requests', 'wallets', 'counters', 'kv', 'audit']) out[n] = await C[n].find({}).toArray();
  for (const r of out.topup_requests) r.image = r.image ? '(imagen omitida)' : null; // las fotos harían el archivo enorme
  // El respaldo que sale por Telegram NO lleva contraseñas ni secretos 2FA (Telegram guarda los archivos en su nube)
  if (strip) for (const u of out.users) for (const k of ['password_hash', 'totp_secret', 'totp_recovery', 'totp_pending', 'tg_link_token']) delete u[k];
  return out;
}
async function sendBackup(manual) {
  if (!TG.enabled()) throw new Error('Telegram no está activado (falta TELEGRAM_BOT_TOKEN en Render).');
  const admins = await C.users.find({ role: 'admin', telegram_chat_id: { $ne: null } }).toArray();
  if (!admins.length) throw new Error('Conecta tu Telegram primero (Resumen → Avisos por Telegram).');
  const gz = require('node:zlib').gzipSync(Buffer.from(JSON.stringify(await backupObject(true))));
  if (gz.length > 45e6) throw new Error('El respaldo pesa demasiado para Telegram (más de 45 MB). Descárgalo desde el panel.');
  const name = 'respaldo-panel-' + new Date().toISOString().slice(0, 10) + '.json.gz';
  for (const a of admins) await TG.sendDocument(a.telegram_chat_id, name, gz, `💾 Respaldo ${manual ? 'manual' : 'automático'} del panel (${Math.round(gz.length / 1024)} KB)\nRevendedores, saldos y pedidos. Sin contraseñas ni fotos. Guárdalo.`);
  await kvSet('backup_last', new Date().toISOString()); await kvSet('backup_last_err', '');
}
async function autoBackup() {
  if (!(await getSettings()).auto_backup || !TG.enabled()) return;
  const last = await kvGet('backup_last'), tried = await kvGet('backup_try'), t = Date.now();
  if (last && t - new Date(last.value).getTime() < 7 * 864e5) return;
  if (tried && t - Number(tried.value) < 6 * 3600e3) return; // si falla, reintenta cada 6 h
  await kvSet('backup_try', t);
  try { await sendBackup(false); }
  catch (e) { console.error('respaldo automático:', e.message); await kvSet('backup_last_err', e.message.slice(0, 200)); }
}


// Fondos: lo que hay en Central One y lo que tienen TODOS los revendedores (dueño y sub-admins con permiso "saldos")
route('GET', '/api/admin/funds', 'staff', async (req, res) => {
  const b = await providerBalance(), last = await kvGet('provider_balance');
  const us = (await C.users.find({ role: 'reseller' }).toArray()).map(u => ({ id: u._id, username: u.username, active: !!u.active, pending: !!u.pending_approval, balances: balancesOf(u) }));
  const tot = { usdt: 0, transfer: 0, mobile: 0 }, withBal = { usdt: 0, transfer: 0, mobile: 0 };
  for (const u of us) for (const c of ['usdt', 'transfer', 'mobile']) { tot[c] += Math.round(u.balances[c] * 100); if (u.balances[c] > 0) withBal[c]++; }
  send(res, 200, {
    provider: b.v ? { available: e4ToStr(b.v.availableE4), held: e4ToStr(b.v.heldE4), live: true } : (last ? { available: last.value, held: null, live: false, at: last.updated_at } : null),
    provider_error: b.err || null,
    totals: { usdt: tot.usdt / 100, transfer: tot.transfer / 100, mobile: tot.mobile / 100 }, with_balance: withBal, count: us.length,
    resellers: us.sort((a, c) => (c.balances.usdt - a.balances.usdt) || a.username.localeCompare(c.username)),
  });
});

// --- Equipo (sub-administradores) y registro de actividad: solo el dueño ---
route('GET', '/api/admin/staff', 'admin', async (req, res) =>
  send(res, 200, (await C.users.find({ role: 'subadmin' }).sort({ _id: -1 }).toArray()).map(u => ({ id: u._id, username: u.username, active: !!u.active,
    totp: !!u.totp_on, perms: normPerms(u.perms || {}), quota: quotaOf(u), last_login: fmt(u.last_login), last_ip: u.last_ip || null, created_at: fmt(u.created_at) }))));

// Control del dueño sobre lo que mueven los sub-admins: cupo usado/restante y desglose por revendedor desde el último restablecimiento.
route('GET', '/api/admin/team-activity', 'admin', async (req, res) => {
  const staff = await C.users.find({ role: 'subadmin' }).sort({ _id: -1 }).toArray();
  const us = new Map((await C.users.find({}).toArray()).map(u => [u._id, u.username]));
  const out = [];
  for (const m of staff) {
    const since = m.quota_reset_at || m.created_at || new Date(0);
    const rows = await C.ledger.find({ by_id: m._id, created_at: { $gte: since } }).sort({ _id: -1 }).toArray();
    const by = new Map(), appr = { usdt: 0, transfer: 0, mobile: 0 };
    for (const r of rows) {
      const cur = curOf(r.currency);
      if (r.ref) { if (r.amount_cents > 0) appr[cur] += r.amount_cents; continue; } // aprobación de solicitud (ref req-N)
      const x = by.get(r.user_id) || { username: us.get(r.user_id) || '#' + r.user_id, usdt: { add: 0, rem: 0 }, transfer: { add: 0, rem: 0 }, mobile: { add: 0, rem: 0 }, last: null };
      x[cur][r.amount_cents > 0 ? 'add' : 'rem'] += Math.abs(r.amount_cents); if (!x.last) x.last = fmt(r.created_at);
      by.set(r.user_id, x);
    }
    const c2 = o => ({ add: o.add / 100, rem: o.rem / 100 });
    out.push({ id: m._id, username: m.username, active: !!m.active, perms: normPerms(m.perms || {}), quota: quotaOf(m), since: fmt(since),
      resellers: [...by.values()].map(x => ({ username: x.username, usdt: c2(x.usdt), transfer: c2(x.transfer), mobile: c2(x.mobile), last: x.last })),
      approved: { usdt: appr.usdt / 100, transfer: appr.transfer / 100, mobile: appr.mobile / 100 } });
  }
  const recent = (await C.ledger.find({ by_id: { $ne: null } }).sort({ _id: -1 }).limit(40).toArray()).map(r => ({
    at: fmt(r.created_at), by: us.get(r.by_id) || '#' + r.by_id, reseller: us.get(r.user_id) || '#' + r.user_id, amount: r.amount_cents / 100, currency: curOf(r.currency), kind: r.ref ? 'approval' : 'manual', note: r.note }));
  send(res, 200, { staff: out, recent });
});
route('POST', '/api/admin/staff', 'admin', async (req, res, _u, b) => {
  const username = String(b.username || '').trim(), pw = String(b.password || '');
  if (!/^[\w.-]{3,30}$/.test(username)) return send(res, 400, { error: 'Usuario: 3-30 letras, números, . _ -' });
  if (pw.length < 10 || pw.length > 200) return send(res, 400, { error: 'La contraseña del sub-admin debe tener 10+ caracteres' });
  try { const u = await createUser(username, A.hashPassword(pw), 'subadmin', 0); await C.users.updateOne({ username_lc: username.toLowerCase() }, { $set: { perms: normPerms(b.perms || { revendedores: 1, saldo: 1, pedidos: 1, saldos: 1 }) } }); }
  catch (e) { if (isDup(e)) return send(res, 409, { error: 'Ese usuario ya existe' }); throw e; }
  send(res, 201, { ok: true });
});
route('POST', '/api/admin/staff-update', 'admin', async (req, res, _u, b) => {
  const f = { _id: Number(b.user_id), role: 'subadmin' }, set = {};
  if (!(await C.users.findOne(f))) return send(res, 404, { error: 'Sub-admin no encontrado' });
  if (b.active !== undefined) set.active = b.active ? 1 : 0;
  if (b.perms) set.perms = normPerms(b.perms);
  if (b.reset_quota) Object.assign(set, { adj_used_usdt_c: 0, adj_used_transfer_c: 0, adj_used_mobile_c: 0, adj_used_cup_c: 0, quota_reset_at: now() }); // el dueño restablece el cupo de ajustes manuales
  if (b.password) { if (String(b.password).length < 10) return send(res, 400, { error: 'Contraseña de 10+ caracteres' }); set.password_hash = A.hashPassword(String(b.password)); }
  if (b.reset_2fa) Object.assign(set, { totp_on: 0, totp_secret: null, totp_recovery: [], totp_pending: null });
  const upd = {}; if (Object.keys(set).length) upd.$set = set; if (b.password || b.revoke || b.reset_2fa) upd.$inc = { sv: 1 }; // sube la versión: sus sesiones abiertas dejan de valer
  if (Object.keys(upd).length) await C.users.updateOne(f, upd);
  send(res, 200, { ok: true });
});
route('GET', '/api/admin/audit', 'admin', async (req, res) => send(res, 200, await auditRows(new URL(req.url, 'http://x').searchParams, Math.min(Number(new URL(req.url, 'http://x').searchParams.get('limit')) || 200, 1000))));
route('GET', '/api/admin/audit.csv', 'admin', async (req, res) => {
  const rows = await auditRows(new URL(req.url, 'http://x').searchParams, 5000);
  const cell = v => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
  const csv = '\ufeffFecha (UTC),Quién,Rol,Acción,Sobre,Detalle,Resultado,IP\n' + rows.map(r => [r.at, r.actor, r.role, r.label, r.target, Object.entries(r.detail).map(([k, v]) => k + '=' + v).join(' · '), r.ok ? 'OK' : 'FALLÓ/NEGADO', r.ip].map(cell).join(',')).join('\n');
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="registro-panel-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' });
  res.end(csv);
});
// Cambiar la contraseña propia (revendedor, sub-admin o dueño)
route('POST', '/api/change-password', 'any', async (req, res, u, b) => {
  const d = await C.users.findOne({ _id: u.id }), pw = String(b.password || '');
  if (!d || !A.verifyPassword(String(b.current || ''), d.password_hash)) return send(res, 403, { error: 'La contraseña actual no es correcta' });
  if (pw.length < 8 || pw.length > 200) return send(res, 400, { error: 'La nueva contraseña debe tener 8 o más caracteres' });
  await C.users.updateOne({ _id: u.id }, { $set: { password_hash: A.hashPassword(pw) }, $inc: { sv: 1 } });
  send(res, 200, { ok: true }, { 'Set-Cookie': A.cookieHeader(A.makeSession(u.id, (d.sv || 0) + 1), 12 * 3600) }); // las demás sesiones se cierran; esta sigue
});

// Cerrar sesión en todos los dispositivos (sube la versión: todas las cookies anteriores dejan de valer)
route('POST', '/api/logout-all', 'any', async (req, res, u) => {
  await C.users.updateOne({ _id: u.id }, { $inc: { sv: 1 } });
  send(res, 200, { ok: true }, { 'Set-Cookie': A.cookieHeader('', 0) });
});
// Verificación en dos pasos (solo dueño y sub-admins)
const isStaffRole = u => u.role === 'admin' || u.role === 'subadmin';
route('POST', '/api/2fa/start', 'any', async (req, res, u) => {
  if (!isStaffRole(u)) return send(res, 403, { error: 'No permitido' });
  if ((await C.users.findOne({ _id: u.id })).totp_on) return send(res, 409, { error: 'Ya está activada' });
  const secret = A.newSecret();
  await C.users.updateOne({ _id: u.id }, { $set: { totp_pending: A.seal(secret) } });
  send(res, 200, { secret, uri: `otpauth://totp/${encodeURIComponent('Shop Fast:' + u.username)}?secret=${secret}&issuer=${encodeURIComponent('Shop Fast')}&algorithm=SHA1&digits=6&period=30` });
});
route('POST', '/api/2fa/confirm', 'any', async (req, res, u, b) => {
  if (!isStaffRole(u)) return send(res, 403, { error: 'No permitido' });
  const d = await C.users.findOne({ _id: u.id }), pending = A.unseal(d.totp_pending || '');
  if (!pending) return send(res, 400, { error: 'Empieza de nuevo: pulsa "Activar".' });
  const step = A.totpCheck(pending, b.code, 0);
  if (!step) return send(res, 400, { error: 'Ese código no coincide. Revisa la hora de tu teléfono e intenta con el siguiente código.' });
  const rec = A.newRecovery();
  await C.users.updateOne({ _id: u.id }, { $set: { totp_secret: d.totp_pending, totp_on: 1, totp_last: step, totp_recovery: rec.hashes, totp_pending: null } });
  send(res, 200, { ok: true, recovery: rec.plain });
});
route('POST', '/api/2fa/disable', 'any', async (req, res, u, b) => {
  const d = await C.users.findOne({ _id: u.id });
  if (!d || !d.totp_on) return send(res, 400, { error: 'No está activada' });
  if (u.role === 'subadmin' && (await getSettings()).require_2fa) return send(res, 403, { error: 'El dueño exige verificación en dos pasos a los sub-administradores.' });
  if (!A.verifyPassword(String(b.password || ''), d.password_hash)) return send(res, 403, { error: 'Contraseña incorrecta' });
  if (!(await secondFactor(d, String(b.code || '').trim()))) return send(res, 403, { error: 'Código incorrecto' });
  await C.users.updateOne({ _id: u.id }, { $set: { totp_on: 0, totp_secret: null, totp_recovery: [], totp_pending: null } });
  send(res, 200, { ok: true });
});

// ---------- restaurar un respaldo (solo dueño) ----------
const RESTORE_COLS = ['users', 'products', 'wallets', 'orders', 'ledger', 'topup_requests', 'kv', 'audit'];
const COUNTER_COLS = ['users', 'ledger', 'products', 'orders', 'topup_requests', 'audit'];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const revive = v => typeof v === 'string' ? (ISO.test(v) ? new Date(v) : v) : Array.isArray(v) ? v.map(revive) : (v && typeof v === 'object') ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)])) : v;
/** Nunca borra nada. mode "missing": repone solo lo que falta. mode "overwrite": además sobrescribe lo que exista con lo del respaldo. */
async function restoreBackup(data, mode, adminId) {
  const report = {};
  for (const n of RESTORE_COLS) {
    const docs = Array.isArray(data[n]) ? data[n] : [];
    if (!docs.length) continue;
    const before = await C[n].countDocuments({}), ops = [];
    let skipped = 0;
    for (const raw of docs) {
      if (!raw || raw._id === undefined || raw._id === null) { skipped++; continue; }
      const { _id, ...rest } = revive(raw);
      if (n === 'users') {
        if (_id === adminId) { skipped++; continue; } // tu propia cuenta no se toca
        rest.username_lc = String(rest.username_lc || rest.username || '').toLowerCase();
      }
      if (n === 'kv' && (/^pr_/.test(String(_id)) || _id === 'backup_try')) { skipped++; continue; }
      if (n === 'topup_requests' && rest.image === '(imagen omitida)') rest.image = null;
      let upd;
      if (n === 'users' && !rest.password_hash) { // respaldo de Telegram: sin contraseñas. Las cuentas nuevas quedan con clave bloqueada hasta que se la cambies.
        const lock = { password_hash: A.hashPassword(crypto.randomBytes(18).toString('hex')), needs_password: 1 };
        upd = mode === 'overwrite' ? { $set: rest, $setOnInsert: lock } : { $setOnInsert: { ...rest, ...lock } };
      } else upd = mode === 'overwrite' ? { $set: rest } : { $setOnInsert: rest };
      if (!Object.keys(rest).length) { skipped++; continue; }
      ops.push({ updateOne: { filter: { _id }, update: upd, upsert: true } });
    }
    let errors = 0;
    for (let i = 0; i < ops.length; i += 500) {
      try { await C[n].bulkWrite(ops.slice(i, i + 500), { ordered: false }); }
      catch (e) { errors += (e.writeErrors && e.writeErrors.length) || 1; console.error('restaurar', n, e.message); }
    }
    report[n] = { in_backup: docs.length, added: (await C[n].countDocuments({})) - before, skipped, errors };
  }
  for (const n of COUNTER_COLS) { // que los próximos números (#pedido, etc.) no choquen con los restaurados
    const top = (await C[n].find({}).sort({ _id: -1 }).limit(1).toArray())[0], mx = top ? Number(top._id) || 0 : 0;
    const c = await C.counters.findOne({ _id: n });
    if (!c || (c.seq || 0) < mx) await C.counters.updateOne({ _id: n }, { $set: { seq: mx } }, { upsert: true });
  }
  return report;
}
route('POST', '/api/admin/restore', 'admin', async (req, res, admin, b) => {
  const data = b.data;
  if (!data || typeof data !== 'object' || data.version !== 1 || !Array.isArray(data.users)) return send(res, 400, { error: 'Ese archivo no parece un respaldo de este panel.' });
  const mode = b.mode === 'overwrite' ? 'overwrite' : 'missing';
  const counts = {}; for (const n of RESTORE_COLS) if (Array.isArray(data[n])) counts[n] = data[n].length;
  if (b.dry_run) return send(res, 200, { ok: true, exported_at: data.exported_at || null, counts, stripped: data.users.some(x => !x.password_hash) });
  const me = await C.users.findOne({ _id: admin.id });
  if (!me || !A.verifyPassword(String(b.password || ''), me.password_hash)) return send(res, 403, { error: 'Contraseña incorrecta' });
  if (me.totp_on && !(await secondFactor(me, String(b.code || '').trim()))) return send(res, 403, { error: 'Código de verificación incorrecto' });
  if (String(b.confirm || '').trim().toUpperCase() !== 'RESTAURAR') return send(res, 400, { error: 'Escribe RESTAURAR para confirmar.' });
  if (!b.force) { try { await sendBackup(true); } catch (e) { return send(res, 409, { need_force: true, error: 'No pude mandarte primero una copia de seguridad del estado actual a Telegram (' + e.message + '). ¿Continuar sin ella?' }); } }
  const report = await restoreBackup(data, mode, admin.id);
  const added = Object.entries(report).filter(([, r]) => r.added).map(([k, r]) => `${k}: +${r.added}`).join(', ') || 'nada nuevo';
  TG.notifyAdmins(`♻️ ${admin.username} restauró un respaldo (${mode === 'overwrite' ? 'sobrescribiendo' : 'solo lo que faltaba'}). ${added}.`).catch(() => {});
  send(res, 200, { ok: true, report });
});

route('POST', '/api/admin/backup-send', 'admin', async (req, res) => {
  try { await sendBackup(true); send(res, 200, { ok: true }); }
  catch (e) { send(res, 502, { error: e.message }); }
});

route('GET', '/api/admin/backup', 'admin', async (req, res) => {
  const out = await backupObject(false);
  const name = 'respaldo-panel-' + new Date().toISOString().slice(0, 10) + '.json';
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(out, null, 1));
});

// ---------- Alerta de saldo bajo en Central One ----------
let lastLowAlert = 0;
async function lowBalanceAlert(reason) {
  if (Date.now() - lastLowAlert < 3 * 3600e3) return; // máximo una alerta cada 3 horas
  lastLowAlert = Date.now();
  await TG.notifyAdmins(`🔴 Saldo bajo en Central One\n${reason}\nRecarga para no rechazar pedidos.`).catch(() => {});
}
async function checkLowBalance() {
  const th = Number(((await kvGet('low_balance_threshold')) || {}).value || 0);
  if (!th) return;
  balCache.at = 0;
  const b = await providerBalance();
  if (b.v && b.v.availableE4 !== null && b.v.availableE4 < th * 10000) {
    await kvSet('balance_low', '1');
    await lowBalanceAlert(`Disponible: ${e4ToStr(b.v.availableE4)} USDT (tu alerta: ${th}).`);
  } else if (b.v && b.v.availableE4 !== null) await kvSet('balance_low', '0');
}


// ---------- vigilancia: Central One caído y tasas CUP viejas ----------
let provFails = 0;
async function checkProvider() {
  balCache.at = 0;
  const b = await providerBalance();
  if (b.err) {
    provFails++;
    if (provFails === 3) { await kvSet('provider_down', '1'); TG.notifyAdmins(`⚠️ Central One no responde (${String(b.err).slice(0, 120)}). Tus revendedores no podrán recargar hasta que vuelva. Puedes activar el Modo mantenimiento en Resumen.`).catch(() => {}); }
  } else {
    if (provFails >= 3) TG.notifyAdmins('✅ Central One volvió a responder.').catch(() => {});
    provFails = 0; if ((await kvGet('provider_down') || {}).value === '1') await kvSet('provider_down', '0');
  }
}
async function checkRates() {
  const st = await getSettings(), days = Number(st.rate_stale_days) || 0;
  if (!days || !(Number(st.rate_transfer) > 0 || Number(st.rate_mobile) > 0)) return;
  const stamp = await kvGet('rates_updated');
  if (!stamp) return kvSet('rates_updated', new Date().toISOString()); // instalaciones viejas: empieza a contar desde hoy
  const age = Date.now() - new Date(stamp.value).getTime(), last = Number(((await kvGet('rates_alert_at')) || {}).value || 0);
  if (age > days * 864e5 && Date.now() - last > 24 * 3600e3) {
    await kvSet('rates_alert_at', Date.now());
    TG.notifyAdmins(`⏰ Tus tasas CUP llevan ${Math.floor(age / 864e5)} días sin actualizarse (transferencia ${st.rate_transfer || '—'} · saldo móvil ${st.rate_mobile || '—'}). Si siguen vigentes pulsa "Siguen vigentes" en Resumen; si no, cámbialas para no vender con precio desfasado.`).catch(() => {});
  }
}

// ---------- catálogo ----------
async function syncCatalog() {
  const items = await provider.getCatalog();
  const prev = await C.catalog.countDocuments({ in_catalog: 1 });
  if (items.length === 0 && prev > 0) throw new Error('El catálogo llegó vacío; se conserva la copia anterior');
  if (items.length) await C.catalog.bulkWrite(items.map(i => ({ updateOne: {
    filter: { _id: i.productId }, upsert: true,
    update: { $set: { sku: i.sku, name: i.name, category: i.category, product_type: i.productType, family_name: i.familyName, region: i.region ?? null, currency: i.currency,
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
  if (name === 'balance.low') { await kvSet('balance_low', '1'); lowBalanceAlert('Central One avisa que tu saldo está bajo.'); }
  else if (name === 'deposit.approved' || name === 'balance.credited') await kvSet('balance_low', '0');
}

// ---------- admin inicial (para hosting sin terminal, ej. Render) ----------
// Si no existe ningún admin y están ADMIN_USERNAME / ADMIN_PASSWORD, se crea al arrancar.
// Después de entrar la primera vez, borra ADMIN_PASSWORD de las variables de entorno.
async function bootstrapAdmin() {
  if (await C.users.findOne({ role: 'admin' })) { if (process.env.ADMIN_PASSWORD) console.log('Ya existe un admin: ADMIN_PASSWORD se ignora (solo sirve en el primer arranque). Si no puedes entrar, usa RESET_PASSWORD_FOR y RESET_PASSWORD_TO (ver README).'); return; }
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) return;
  if (process.env.ADMIN_PASSWORD.length < 10) return console.error('ADMIN_PASSWORD debe tener 10+ caracteres: no se creó el admin');
  try {
    await createUser(process.env.ADMIN_USERNAME, A.hashPassword(process.env.ADMIN_PASSWORD), 'admin');
    console.log('Admin inicial creado:', process.env.ADMIN_USERNAME);
  } catch (e) { if (!isDup(e)) throw e; }
}

// ---------- servidor ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' };
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; script-src 'self' https://accounts.google.com/gsi/client; img-src 'self' data: blob: https://*.googleusercontent.com; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com; frame-ancestors 'none'",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/status') { // para monitores externos (UptimeRobot, BetterStack…): responde 503 si la base de datos no contesta
      let db = true; try { await Promise.race([C.kv.findOne({ _id: 'ping' }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]); } catch { db = false; }
      res.writeHead(db ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify({ ok: db, db }));
    }
    if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if ((url.pathname === '/webhooks/central-one' || url.pathname === '/api/webhooks') && req.method === 'POST') return await handleWebhook(req, res);
    if (url.pathname.startsWith('/api/')) {
      const r = routes[req.method + ' ' + url.pathname];
      if (!r) return send(res, 404, { error: 'No encontrado' });
      let body = {};
      if (req.method === 'POST') {
        if (!(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'Content-Type debe ser JSON' });
        body = await readBody(req, url.pathname === '/api/topup-requests' ? 2500000 : url.pathname === '/api/admin/restore' ? 60e6 : url.pathname === '/api/store' ? 200000 : 20000); // la foto del comprobante va en la solicitud de saldo
      }
      let user = null;
      const ap = url.pathname, doAudit = (req.method === 'POST' && !AUDIT_SKIP.has(ap)) || AUDIT_GET.has(ap);
      if (r.role) {
        user = await A.readSession(req);
        if (!user) return send(res, 401, { error: 'Sesión expirada' });
        if (user.role === 'subadmin' && !user.totp_on && !GATE_OK.has(ap) && (await getSettings()).require_2fa)
          return send(res, 403, { error: 'El dueño exige verificación en dos pasos. Actívala en Mi cuenta.' });
        if (user.role === 'subadmin') user.perms = normPerms(user.perms || {});
        let ok = true;
        if (r.role === 'staff') ok = user.role === 'admin' || (user.role === 'subadmin' && !!(user.perms && user.perms[STAFF_PERM[req.method + ' ' + ap]]));
        else if (r.role !== 'any') ok = user.role === r.role;
        if (!ok) { if (doAudit || user.role === 'subadmin') await audit(req, user, ap, body, 403, null, res); return send(res, 403, { error: 'No permitido' }); }
      }
      const target = doAudit && ap.startsWith('/api/admin/') ? await auditTarget(ap, body) : null;
      let failed = false;
      try { return await r.fn(req, res, user, body); }
      catch (e) { failed = true; throw e; }
      finally { if (doAudit) await audit(req, user, ap, body, failed ? 500 : res.statusCode, target, res); }
    }
    // estáticos
    let f = url.pathname === '/' ? '/index.html' : url.pathname;
    const full = path.join(PUBLIC, path.normalize(f));
    if (!full.startsWith(PUBLIC + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) { res.writeHead(404); return res.end('No encontrado'); }
    // no-cache: el navegador siempre comprueba si hay versión nueva (si no, tras un deploy seguía usando el app.js viejo)
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': /\.(html|js|css)$/.test(full) ? 'no-cache' : 'public, max-age=86400', ...SEC });
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'Error interno' });
  }
});


/** Salida de emergencia si no puedes entrar: en Render pon RESET_PASSWORD_FOR=tu_usuario y RESET_PASSWORD_TO=nueva_clave (10+ caracteres),
 *  reinicia, entra y BORRA las dos variables. Si no existe ningún admin, lo crea con ese usuario. */
async function envResetPassword() {
  const raw = String(process.env.RESET_PASSWORD_FOR || '').trim(), n = raw.toLowerCase(), pw = String(process.env.RESET_PASSWORD_TO || '');
  if (!n) return;
  if (pw.length < 10) return console.error('RESET_PASSWORD_TO debe tener 10 o más caracteres: no se cambió nada.');
  const u = await C.users.findOne({ username_lc: n });
  if (!u) {
    if (await C.users.findOne({ role: 'admin' })) return console.error('RESET_PASSWORD_FOR: no existe el usuario "' + raw + '". Revisa cómo está escrito.');
    await createUser(raw, A.hashPassword(pw), 'admin');
    return console.warn(`⚠ No había ningún admin: se creó "${raw}" con la clave de RESET_PASSWORD_TO. Entra y BORRA esas dos variables.`);
  }
  if (A.verifyPassword(pw, u.password_hash)) return console.warn('RESET_PASSWORD_*: la clave ya es esa. BORRA esas dos variables de Render.');
  await C.users.updateOne({ _id: u._id }, { $set: { password_hash: A.hashPassword(pw), active: 1, needs_password: 0 }, $inc: { sv: 1 } });
  console.warn(`⚠ Contraseña de "${u.username}" restablecida por RESET_PASSWORD_FOR. Entra y BORRA esas dos variables de Render.`);
  try { await C.audit.insertOne({ _id: await nextId('audit'), at: now(), actor: 'sistema', actor_id: null, role: 'sistema', action: 'reset-password', label: 'Contraseña restablecida por RESET_PASSWORD_FOR', target: u.username, detail: {}, ok: true, status: 200, ip: null }); } catch {}
}

/** Una sola vez: las cuentas que ya existían con un margen distinto al general se marcan como "manual" (así el primer cambio general no les pisa lo que pusiste a mano).
 *  Las que tienen el mismo margen que el general quedan automáticas. Puedes corregir cualquiera desde Revendedores → Más opciones. */
async function migrateMarkup() {
  if (await kvGet('markup_manual_v1')) return;
  const def = Number((await getSettings()).default_markup || 0);
  await C.users.updateMany({ role: 'reseller', markup_manual: { $exists: false }, markup_pct: { $ne: def } }, { $set: { markup_manual: 1 } });
  await C.users.updateMany({ role: 'reseller', markup_manual: { $exists: false } }, { $set: { markup_manual: 0 } });
  await kvSet('markup_manual_v1', '1');
}

/** Una sola vez: el consumo de cupo CUP que estaba junto se reparte entre transferencia y saldo móvil según el historial real. */
async function migrateQuotaSplit() {
  if (await kvGet('quota_split_v1')) return;
  for (const m of await C.users.find({ role: 'subadmin' }).toArray()) {
    const since = m.quota_reset_at || m.created_at || new Date(0), used = { usdt: 0, transfer: 0, mobile: 0 };
    for (const r of await C.ledger.find({ by_id: m._id, created_at: { $gte: since } }).toArray()) if (!r.ref) used[curOf(r.currency)] += Math.abs(r.amount_cents);
    await C.users.updateOne({ _id: m._id }, { $set: { adj_used_transfer_c: used.transfer, adj_used_mobile_c: used.mobile, adj_used_cup_c: 0 } });
  }
  await kvSet('quota_split_v1', '1');
}

/** Una sola vez, por seguridad: apaga "confiar en billeteras" en todas las cuentas y revoca las billeteras que se registraron solas
 *  (nunca se comprobó que fueran del revendedor: bastaba copiar un hash público). Guarda la lista para revisarla y avisa por Telegram. */
async function migrateWalletAudit() {
  if (await kvGet('wallet_audit_v1')) return;
  const autos = await C.wallets.find({ by: 'auto' }).toArray(), users = new Map((await C.users.find({}).toArray()).map(x => [x._id, x.username]));
  const auto = (await C.topup_requests.find({ admin_note: 'Aprobado automáticamente (blockchain)' }).toArray()), per = new Map();
  for (const r of auto) { const k = users.get(r.user_id) || r.user_id, x = per.get(k) || { n: 0, c: 0 }; x.n++; x.c += r.approved_cents || 0; per.set(k, x); }
  const rep = { at: new Date().toISOString(), revoked: autos.map(w => ({ address: w._id, user: users.get(w.user_id) || w.user_id, created: w.created_at })), auto_deposits: [...per].map(([u, x]) => ({ user: u, count: x.n, usdt: x.c / 100 })) };
  await kvSet('wallet_audit_report', JSON.stringify(rep));
  await C.users.updateMany({}, { $set: { trust_wallets: 0 } });
  await kvSet('set_trust_new_wallets', '0');
  for (const w of autos) await C.wallets.deleteOne({ _id: w._id });
  await kvSet('wallet_audit_v1', '1');
  console.log('Auditoría de billeteras:', JSON.stringify(rep));
  if (autos.length || per.size) TG.notifyAdmins(`🔒 Seguridad de depósitos USDT\nSe apagó "confiar en billeteras" y se revocaron ${autos.length} billetera(s) registradas solas.\nDepósitos abonados automáticamente por cuenta:\n` + ([...per].map(([u, x]) => `• ${u}: ${x.n} (${(x.c / 100).toFixed(2)} USDT)`).join('\n') || '—') + '\nRevisa quién cobró pagos que no eran suyos (Saldo → historial) y corrige con un ajuste negativo si hace falta.').catch(() => {});
}

(async () => {
  await connect();
  await migrateWalletAudit();
  await migrateMarkup();
  await migrateQuotaSplit();
  await bootstrapAdmin();
  await envResetPassword();
  await envReset2fa();
  server.listen(PORT, () => console.log(`Panel en http://localhost:${PORT}  (proveedor: ${MODE}, base: ${process.env.MONGODB_URI ? 'MongoDB' : 'MEMORIA'})`));
  setInterval(() => pollOnce().catch(e => console.error('poll', e.message)), Number(process.env.POLL_MS) || 15000);
  setInterval(() => recoverPending(), 60000);
  setTimeout(recoverPending, 5000);
  if (MODE === 'real') provider.ping().then(() => console.log('Llave de Central One: OK'), e => console.error('ATENCIÓN: la llave de Central One no funciona:', e.message));
  setTimeout(syncSafe, 500);
  setInterval(() => checkProvider().catch(() => {}), 5 * 60e3); setTimeout(() => checkProvider().catch(() => {}), 45000);
  setInterval(() => checkRates().catch(() => {}), 3600e3); setTimeout(() => checkRates().catch(() => {}), 50000);
  setInterval(() => autoBackup().catch(e => console.error('respaldo', e.message)), 3600e3); setTimeout(() => autoBackup().catch(() => {}), 60000);
  const purgeAudit = () => { if (C.audit.deleteMany) C.audit.deleteMany({ at: { $lt: new Date(Date.now() - 180 * 864e5) } }).catch(() => {}); };
  setInterval(purgeAudit, 24 * 3600e3); setTimeout(purgeAudit, 30000);
  TG.start();
  if (BSC.enabled()) console.log('Depósitos USDT BEP20 automáticos: activos'); else if (process.env.USDT_WALLET && !BSC.walletOk()) console.error('USDT_WALLET no es una dirección BEP20 válida (0x + 40 caracteres)');
  setInterval(() => recheckDeposits().catch(e => console.error('depósitos', e.message)), 30000);
  const SCAN_MS = Number(process.env.SCAN_MS) || 30000;
  setInterval(() => scanDeposits().catch(() => {}), SCAN_MS); setTimeout(() => scanDeposits().catch(() => {}), Math.min(20000, SCAN_MS));
  setInterval(() => checkLowBalance().catch(e => console.error('saldo bajo', e.message)), 10 * 60 * 1000);
  setTimeout(() => checkLowBalance().catch(() => {}), 20000);
  setInterval(syncSafe, 15 * 60 * 1000); // el catálogo se actualiza cada 15 min (límite: 60 peticiones/min)
})().catch(e => { console.error('No se pudo iniciar:', e.message); process.exit(1); });
