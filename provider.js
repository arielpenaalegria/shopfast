'use strict';
/**
 * Adaptador de Central One (API v1). TODO el contacto con la API vive SOLO aquí.
 *
 * Confirmado en la documentación:
 *  - Auth: "Authorization: Bearer co_live_..." (solo desde el servidor; sin CORS, sin ?api_key=).
 *  - POST /api/v1/orders  (scope orders:write). Cabecera Idempotency-Key obligatoria (8-255, A-Za-z0-9_-).
 *      Cuerpo: { items: [{ catalog_item_id, quantity, target_payload }], note }
 *      NO hay campo de precio: lo calcula el servidor con el catálogo. Un campo desconocido => 400.
 *      Misma llave + misma compra => mismo pedido (201), sin cobrar dos veces.
 *      Misma llave + compra distinta => 422 idempotency_key_reused.
 *  - GET /api/v1/orders/{id}  (scope orders:read) = endpoint de estado.
 *      order.status (visto: "confirmed", "failed"); items[].failure {code, message, message_es, action};
 *      items[].refund {refunded,...}. Un pedido fallido sigue en "failed" (refund.scope "full").
 *
 * ProviderError.definitive:
 *   true  -> el proveedor rechazó claramente y NO creó nada: 400, 401, 403, 404, 409 insufficient_balance,
 *            409 insufficient_stock, 422 (salvo idempotency_key_reused). Se reembolsa al subrevendedor.
 *   false -> no sabemos (timeout, red, 429, 5xx, otros 409, idempotency_key_reused). NO se reembolsa solo:
 *            se reintenta con la MISMA llave (no duplica nada) y, si sigue sin respuesta, queda "unknown".
 */
class ProviderError extends Error {
  constructor(message, definitive, code, retryAfterSec) { super(message); this.definitive = definitive; this.code = code || null; this.retryAfterSec = retryAfterSec || 0; }
}

const MODE = process.env.PROVIDER_MODE || 'mock';
const BASE = (process.env.PROVIDER_BASE_URL || 'https://portal.centraloneglobal.com').replace(/\/$/, '');
const KEY = process.env.PROVIDER_API_KEY || '';
if (MODE === 'real' && !/^co_live_/.test(KEY)) {
  console.error('ERROR: PROVIDER_API_KEY debe ser la llave co_live_... de Integración en el portal.');
  process.exit(1);
}

async function call(method, path, body, extraHeaders = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetch(BASE + '/api/v1' + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ProviderError('Sin respuesta del proveedor: ' + e.message, false);
  } finally { clearTimeout(t); }

  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  const reqId = res.headers.get('x-request-id'); // se guarda: es lo que pide soporte para encontrar la petición

  const err = data.error;
  const code = (err && typeof err === 'object' ? err.code : err) || data.code || `http_${res.status}`;
  const msg = ((err && typeof err === 'object' ? (err.message_es || err.message) : null) || String(code)) + (reqId ? ` [req ${reqId}]` : '');
  // La llave pertenece a OTRA compra: algo está mal de nuestro lado. No reembolsar solo.
  if (code === 'idempotency_key_reused') throw new ProviderError(`${code}: ${msg}`, false, code);
  const definitive = [400, 401, 403, 404].includes(res.status)
    || (res.status === 409 && ['insufficient_balance', 'insufficient_stock'].includes(code))
    || (res.status === 422);
  throw new ProviderError(`${code}: ${msg}`, definitive, code, Number(res.headers.get('retry-after')) || 0);
}

/** "12.3400" -> 123400 (entero, sin floats). null si no es un decimal válido. */
function parseE4(v) {
  if (v === null || v === undefined) return null;
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(String(v).trim());
  if (!m) return null;
  return Number(m[1]) * 10000 + Number((m[2] || '').padEnd(4, '0'));
}

/** Normaliza un item de GET /catalog. */
function normalizeItem(i) {
  let schema = Array.isArray(i.target_schema) ? i.target_schema : [];
  if (!schema.length && Array.isArray(i.target_fields)) schema = i.target_fields.map(k => ({ key: k, label: k, type: 'text', options: null }));
  return {
    productId: String(i.product_id), sku: i.sku || null, name: String(i.name || i.sku || i.product_id),
    category: i.category || null, productType: i.product_type || null, familyName: i.product_family_name || null,
    currency: i.currency || null, priceE4: parseE4(i.reseller_price),
    inStock: !!i.in_stock, availableStock: Number.isInteger(i.available_stock) ? i.available_stock : null,
    inCatalog: i.status ? i.status === 'active' : true,
    requiresTarget: !!i.requires_target || schema.length > 0,
    targetSchema: schema.map(f => ({ key: String(f.key), label: String(f.label || f.key), type: f.type === 'select' ? 'select' : 'text', options: f.type === 'select' ? (f.options || []) : null })),
    priceUpdatedAt: i.price_updated_at || null,
  };
}

// Estados del pedido (documentación "Estados del pedido") -> estados internos:
//   created / confirmed / processing  -> processing  (sigue avanzando sola; puede tardar hasta un par de horas)
//   completed                         -> completed   (entregado completo; recién ahí se cobra de verdad)
//   failed / cancelled                -> failed      (la retención se libera; nunca se cobró)
//   partially_completed / refunded    -> review      (con 1 línea no debería ocurrir: lo revisa el admin)
// Un estado desconocido se trata como "processing" (nunca se da por entregado por suposición).
function mapStatus(s) {
  if (s === 'completed') return 'completed';
  if (s === 'failed' || s === 'cancelled') return 'failed';
  if (s === 'partially_completed' || s === 'refunded') return 'review';
  return 'processing';
}
function summarize(o) {
  const f = (o.items || []).map(i => i.failure).find(Boolean) || null;
  return {
    status: mapStatus(o.status),
    rawStatus: o.status,
    referenceCode: o.reference_code || null,
    totalE4: parseE4(o.total_sale_amount), // lo que Central One cobra realmente (4 decimales)
    // failure.code y failure.action son lo que debe leer el sistema; message/message_es son solo para mostrar.
    failureCode: f ? f.code : null,
    failureAction: f ? f.action : null,
    failure: f ? `${f.code}${f.action ? ' (' + f.action + ')' : ''}: ${f.message_es || f.message || ''}` : null,
  };
}

const real = {
  async createOrder({ catalogItemId, targetPayload, idempotencyKey, note }) {
    const d = await call('POST', '/orders', {
      items: [{ catalog_item_id: catalogItemId, quantity: 1, target_payload: targetPayload }],
      note,
    }, { 'Idempotency-Key': idempotencyKey });
    const o = d.order || d; // POST /orders -> 201 { order: { id, reference_code, status, total_sale_amount, currency, created_at } }
    if (!o.id) throw new ProviderError('Respuesta sin id de pedido', false);
    return { providerOrderId: String(o.id), ...summarize(o) };
  },
  async getOrder(providerOrderId) {
    const d = await call('GET', `/orders/${encodeURIComponent(providerOrderId)}`);
    return summarize(d.order || d);
  },
  // GET /catalog (scope catalog:read). Límite: 60 peticiones/min; basta con pedirlo cada 15 minutos.
  async getCatalog() {
    const d = await call('GET', '/catalog');
    return (d.items || []).map(normalizeItem);
  },
  // POST /webhooks/test (scope orders:write, máx. 5 por hora): encola un evento webhook.test hacia la URL registrada.
  // Responde 404 mientras Central One no active los webhooks nuevos para la cuenta.
  async webhookTest() {
    const d = await call('POST', '/webhooks/test');
    return { deliveryId: d.delivery && d.delivery.id, status: d.delivery && d.delivery.status };
  },
  // Comprobación de cuenta antes de comprar (scope catalog:read, límite 30/min para TODA la cuenta).
  async validatePlayer({ catalogItemId, targetPayload }) {
    const d = await call('POST', '/player/validate', { product_id: catalogItemId, target_payload: targetPayload });
    return { status: d.status, reason: d.reason || null, name: d.player && d.player.name };
  },
  // GET /balance (scope balance:read): { available_balance, held_balance, total_balance, currency } con 4 decimales.
  // Un pedido nuevo se paga contra available_balance.
  async getBalance() {
    const d = await call('GET', '/balance');
    return { availableE4: parseE4(d.available_balance), heldE4: parseE4(d.held_balance), totalE4: parseE4(d.total_balance), currency: d.currency || 'USD' };
  },
  // GET /ping: confirma que la llave sirve (scope catalog:read).
  async ping() { await call('GET', '/ping'); return true; },
};

// ---------- MODO SIMULADO ----------
const mockOrders = new Map();
const MOCK_CATALOG = [
  { product_id: 'aaaaaaaa-0000-4000-8000-000000000001', sku: 'MOCK-TOPUP-10', name: 'Recarga móvil 10 (simulada)', category: 'topup', product_type: 'mobile_topup', product_family_name: 'Recarga móvil', currency: 'USD', reseller_price: '10.5000', status: 'active', requires_target: true, target_fields: ['phone'], target_schema: [{ key: 'phone', label: 'Número', type: 'text', options: null }], in_stock: true, available_stock: null, price_updated_at: '2026-01-01T00:00:00Z' },
  { product_id: 'aaaaaaaa-0000-4000-8000-000000000002', sku: 'MOCK-GAME-100', name: 'Juego 100 gemas (simulado)', category: 'gaming_topup', product_type: 'game_topup', product_family_name: 'Juego', currency: 'USD', reseller_price: '1.2345', status: 'active', requires_target: true, target_fields: ['player_id', 'server'], target_schema: [{ key: 'player_id', label: 'ID del jugador', type: 'text', options: null }, { key: 'server', label: 'Servidor', type: 'select', options: [{ value: 'region_a', label: 'Región A' }, { value: 'region_b', label: 'Región B' }] }], in_stock: true, available_stock: null, price_updated_at: '2026-01-01T00:00:00Z' },
  { product_id: 'aaaaaaaa-0000-4000-8000-000000000003', sku: 'MOCK-GC-1', name: 'Gift card (simulada)', category: 'gift_card', product_type: 'gift_card', product_family_name: 'Gift card', currency: 'USD', reseller_price: '12.3400', status: 'active', requires_target: false, target_fields: [], target_schema: [], in_stock: true, available_stock: 100, price_updated_at: '2026-01-01T00:00:00Z' },
];
const mock = {
  async getCatalog() { return MOCK_CATALOG.map(normalizeItem); },
  async createOrder({ catalogItemId, targetPayload, idempotencyKey }) {
    await new Promise(r => setTimeout(r, 200));
    const target = String(Object.values(targetPayload)[0] || '');
    if (target.endsWith('0000')) throw new ProviderError('invalid_request: dato inválido (simulado)', true, 'invalid_request');
    if (target.endsWith('9999')) throw new ProviderError('Tiempo agotado (simulado)', false);
    const item = MOCK_CATALOG.find(c => c.product_id === catalogItemId);
    if (!mockOrders.has(idempotencyKey)) mockOrders.set(idempotencyKey, { at: Date.now(), target });
    return { providerOrderId: idempotencyKey, referenceCode: 'CO-MOCK-' + idempotencyKey.slice(-6), status: 'processing', rawStatus: 'confirmed', totalE4: item ? parseE4(item.reseller_price) : null, failure: null };
  },
  async getOrder(id) {
    const o = mockOrders.get(id);
    if (!o || Date.now() - o.at < 3000) return { status: 'processing', rawStatus: 'processing', failure: null };
    if (o.target.endsWith('1111')) return { status: 'failed', rawStatus: 'failed', failureCode: 'invalid_player', failureAction: 'fix_and_retry', failure: 'invalid_player (fix_and_retry): La cuenta no existe (simulado)' };
    if (o.target.endsWith('3333') || o.target.endsWith('4444')) { // falla y luego se confirma la entrega (simulado)
      const age = Date.now() - o.at;
      if (age < 8000) return { status: 'failed', rawStatus: 'failed', failureCode: 'provider_unavailable', failureAction: 'retry_later', failure: 'provider_unavailable (retry_later): simulado' };
      return { status: 'completed', rawStatus: 'completed', failure: null };
    }
    if (o.target.endsWith('2222')) return { status: 'review', rawStatus: 'partially_completed', failure: null };
    return { status: 'completed', rawStatus: 'completed', failure: null };
  },
  async validatePlayer() { return { status: 'unverified', reason: 'not_supported', name: null }; },
  async webhookTest() { return { deliveryId: 'mock-delivery', status: 'pending' }; },
  async getBalance() { return { availableE4: 4700000, heldE4: 300000, totalE4: 5000000, currency: 'USD' }; },
  async ping() { return true; },
};

module.exports = { provider: MODE === 'real' ? real : mock, ProviderError, MODE, parseE4 };
