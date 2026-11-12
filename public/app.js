'use strict';
const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) k === 'class' ? e.className = v : k.startsWith('on') ? e.addEventListener(k.slice(2), v) : e.setAttribute(k, v);
  for (const c of kids) e.append(c instanceof Node ? c : document.createTextNode(c ?? ''));
  return e;
};
async function api(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/api/login') { show('login'); throw new Error('Sesión expirada'); }
  if (!r.ok && r.status !== 202) throw Object.assign(new Error(d.error || 'Error'), { data: d });
  return d;
}
const msg = (box, text, cls) => { box.replaceChildren(el('div', { class: 'msg ' + cls }, text)); };
const money = n => '$' + Number(n).toFixed(2);
const table = (cols, rows) => el('div', { class: 'tbl' }, el('table', {},
  el('thead', {}, el('tr', {}, ...cols.map(c => el('th', {}, c[0])))),
  el('tbody', {}, ...rows.map(r => el('tr', {}, ...cols.map(c => el('td', {}, c[1](r))))))));
let timer = null, flash = null;
const tag = s => el('span', { class: 'tag ' + s }, { completed: 'Completada', failed: 'Fallida', pending: 'Enviando', processing: 'En proceso', unknown: 'Verificando' }[s] || s);

function show(which) { clearTimeout(timer); $('login').classList.toggle('hidden', which !== 'login'); $('app').classList.toggle('hidden', which !== 'app'); if (which === 'login') $('who').replaceChildren(); }

$('lb').onclick = async () => {
  try { await api('POST', '/api/login', { username: $('lu').value, password: $('lp').value }); $('lp').value = ''; boot(); }
  catch (e) { msg($('lm'), e.message, 'err'); }
};
$('lp').addEventListener('keydown', e => e.key === 'Enter' && $('lb').click());

async function boot() {
  try {
    const me = await api('GET', '/api/me');
    $('who').replaceChildren(el('span', {}, me.username + ' · '), el('a', { href: '#', style: 'color:#fff', onclick: async e => { e.preventDefault(); await api('POST', '/api/logout', {}); show('login'); } }, 'Salir'));
    show('app');
    me.role === 'admin' ? adminView(me) : resellerView(me);
  } catch { show('login'); }
}

/* ---------- Subrevendedor ---------- */
async function resellerView(me) {
  clearTimeout(timer);
  const out = $('app'); out.replaceChildren();
  const products = await api('GET', '/api/products');
  const orders = await api('GET', '/api/orders'), led = await api('GET', '/api/ledger');
  const box = el('div');
  const sel = el('select', {}, ...products.map(p => el('option', { value: p.id }, `${p.name} — ${money(p.price)}`)));
  const fieldsBox = el('div', { class: 'row' });
  let inputs = {};
  // Los campos salen del target_schema del producto: texto libre o lista de opciones
  const renderFields = () => {
    const p = products.find(x => x.id == sel.value); inputs = {}; fieldsBox.replaceChildren();
    if (!p) return;
    for (const f of p.fields) {
      const inp = f.type === 'select'
        ? el('select', {}, el('option', { value: '' }, f.label + '…'), ...(f.options || []).map(o => el('option', { value: o.value }, o.label)))
        : el('input', { placeholder: f.label, autocomplete: 'off' });
      inputs[f.key] = inp; fieldsBox.append(inp);
    }
  };
  sel.addEventListener('change', renderFields); renderFields();
  const btn = el('button', {}, 'Enviar recarga');
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const target = {}; for (const [k, i] of Object.entries(inputs)) target[k] = i.value;
      const d = await api('POST', '/api/orders', { product_id: Number(sel.value), target });
      flash = d.status === 'unknown' ? [d.message, 'warn'] : ['Recarga enviada. Se está procesando; el estado se actualiza solo.', 'ok'];
    } catch (e) { flash = [e.message, 'err']; }
    resellerView(await api('GET', '/api/me'));
  };
  if (flash) { msg(box, flash[0], flash[1]); flash = null; }
  out.append(
    el('div', { class: 'card' }, el('h2', {}, 'Mi saldo'), el('div', { class: 'bal' }, money(me.balance))),
    el('div', { class: 'card' }, el('h2', {}, 'Nueva recarga'),
      products.length ? el('div', {}, el('div', { class: 'row' }, sel), fieldsBox, btn) : el('div', {}, 'Aún no hay productos disponibles.'), box,
      el('small', {}, 'Una recarga puede tardar desde minutos hasta un par de horas. No la repitas mientras esté "En proceso": podría llegar dos veces.')),
    el('div', { class: 'card' }, el('h2', {}, 'Mis recargas'), table([['#', r => r.id], ['Producto', r => r.product_name], ['Destino', r => r.target], ['Cobrado', r => money(r.price)], ['Estado', r => el('span', {}, tag(r.status), r.reason ? ' ' + r.reason : '')], ['Fecha', r => r.created_at]], orders)),
    el('div', { class: 'card' }, el('h2', {}, 'Movimientos de saldo'), table([['Movimiento', r => r.type], ['Monto', r => money(r.amount)], ['Nota', r => r.note || ''], ['Fecha', r => r.created_at]], led)));
  if (orders.some(o => ['pending', 'processing', 'unknown'].includes(o.status))) {
    timer = setTimeout(async () => { try { resellerView(await api('GET', '/api/me')); } catch {} }, 10000);
  }
}

/* ---------- Admin ---------- */
let catQuery = '';
async function adminView(me) {
  clearTimeout(timer);
  const out = $('app'); out.replaceChildren();
  const [users, orders, prods, st, cat] = await Promise.all([
    api('GET', '/api/admin/users'), api('GET', '/api/admin/orders'), api('GET', '/api/admin/products'), api('GET', '/api/admin/status'),
    api('GET', '/api/admin/catalog?q=' + encodeURIComponent(catQuery))]);
  const nu = { u: el('input', { placeholder: 'Usuario' }), p: el('input', { placeholder: 'Contraseña (8+)', type: 'password' }), m: el('input', { placeholder: 'Margen %', type: 'number', value: '0' }) };
  const b1 = el('div'), b3 = el('div');
  const create = el('button', {}, 'Crear subrevendedor');
  create.onclick = async () => {
    try { await api('POST', '/api/admin/users', { username: nu.u.value, password: nu.p.value, markup_pct: nu.m.value }); adminView(me); }
    catch (e) { msg(b1, e.message, 'err'); }
  };
  const act = (label, fn, cls = '') => el('button', { class: cls, style: 'margin-right:4px', onclick: async () => { try { await fn(); adminView(me); } catch (e) { alert(e.message); } } }, label);
  const q = el('input', { placeholder: 'Buscar en el catálogo (nombre o SKU)', value: catQuery });
  const search = el('button', { class: 'sec', onclick: () => { catQuery = q.value; adminView(me); } }, 'Buscar');
  const sync = el('button', { class: 'sec', onclick: async () => { try { await api('POST', '/api/admin/catalog-sync', {}); adminView(me); } catch (e) { msg(b3, e.message, 'err'); } } }, 'Actualizar catálogo');

  const banners = [];
  if (st.balance_low) banners.push(el('div', { class: 'msg err' }, 'Tu saldo en Central One está bajo o no alcanzó para un pedido. Recarga para no rechazar pedidos.'));
  out.append(...banners,
    el('div', { class: 'card' }, el('h2', {}, 'Central One'),
      el('div', {}, st.provider_balance ? (st.provider_balance.live ? `Saldo disponible en Central One: US$ ${st.provider_balance.available} · retenido por pedidos en curso: US$ ${st.provider_balance.held}` : `Saldo (último dato conocido): US$ ${st.provider_balance.available}`) : 'Saldo: no disponible todavía.', st.balance_error ? ' — No se pudo leer el saldo en vivo (¿falta el permiso balance:read?)' : ''),
      el('div', {}, 'Catálogo actualizado: ' + (st.catalog_synced_at ? st.catalog_synced_at + ' UTC' : 'todavía no'), ' · Webhooks: ' + (st.webhooks ? 'activos' : 'sin configurar (se usa consulta periódica)')),
      st.webhooks ? el('div', {}, 'Último aviso de prueba recibido: ' + (st.webhook_test_at ? st.webhook_test_at + ' UTC' : 'ninguno'), ' ',
        el('button', { class: 'sec', onclick: async () => { try { await api('POST', '/api/admin/webhook-test', {}); msg(b3, 'Prueba enviada. Recarga en unos segundos para ver si llegó.', 'ok'); } catch (e) { msg(b3, e.message, 'err'); } } }, 'Enviar aviso de prueba')) : ''),
    el('div', { class: 'card' }, el('h2', {}, 'Productos que vendes'),
      table([['Producto', r => r.name + (r.active ? '' : ' (oculto)')], ['Costo Central One', r => r.cost === null ? 'fuera del catálogo' : 'US$ ' + r.cost], ['Stock', r => r.in_stock ? 'sí' : 'agotado'],
        ['', r => el('span', {}, act('Renombrar', async () => { const a = prompt('Nombre que verán tus subrevendedores:', r.name); if (a) await api('POST', '/api/admin/product-update', { id: r.id, name: a }); }, 'sec'),
          act(r.active ? 'Ocultar' : 'Mostrar', () => api('POST', '/api/admin/product-update', { id: r.id, active: !r.active }), 'sec'))]], prods)),
    el('div', { class: 'card' }, el('h2', {}, 'Catálogo de Central One'), el('div', { class: 'row' }, q, search, sync), b3,
      table([['Producto', r => r.name], ['Costo', r => r.price === null ? '' : 'US$ ' + r.price], ['Datos que pide', r => r.fields || '—'], ['Stock', r => r.in_stock ? 'sí' : 'agotado'],
        ['', r => r.enabled ? 'Ya lo vendes' : (r.requires_target ? act('Vender', () => api('POST', '/api/admin/products', { product_id: r.product_id })) : 'No soportado (da código)')]], cat)),
    el('div', { class: 'card' }, el('h2', {}, 'Nuevo subrevendedor'), el('div', { class: 'row' }, nu.u, nu.p, nu.m, create), b1),
    el('div', { class: 'card' }, el('h2', {}, 'Subrevendedores'), table([
      ['Usuario', r => r.username + (r.active ? '' : ' (desactivado)')], ['Saldo', r => money(r.balance)], ['Margen', r => r.markup_pct + '%'],
      ['Acciones', r => el('span', {},
        act('+ Saldo', async () => { const a = prompt('Monto a abonar (negativo para restar):'); if (a) await api('POST', '/api/admin/balance', { user_id: r.id, amount: a }); }),
        act('Margen', async () => { const a = prompt('Nuevo margen %:', r.markup_pct); if (a !== null) await api('POST', '/api/admin/user-update', { user_id: r.id, markup_pct: a }); }, 'sec'),
        act('Clave', async () => { const a = prompt('Nueva contraseña (8+):'); if (a) await api('POST', '/api/admin/user-update', { user_id: r.id, password: a }); }, 'sec'),
        act(r.active ? 'Desactivar' : 'Activar', () => api('POST', '/api/admin/user-update', { user_id: r.id, active: !r.active }), r.active ? 'red' : 'sec'))]], users)),
    el('div', { class: 'card' }, el('h2', {}, 'Pedidos (los "Verificando" requieren tu revisión)'), table([
      ['#', r => r.id], ['Usuario', r => r.username], ['Producto', r => r.product_name], ['Destino', r => r.target], ['Costo', r => r.cost], ['Cobrado', r => money(r.price)], ['Margen', r => r.margin],
      ['Estado', r => tag(r.status)], ['Ref.', r => r.reference_code || ''], ['Detalle', r => r.detail || ''],
      ['', r => r.status === 'unknown' ? el('span', {},
        act('Reintentar (seguro)', () => api('POST', '/api/admin/retry', { order_id: r.id }), 'sec'),
        act('Sí llegó', () => api('POST', '/api/admin/resolve', { order_id: r.id, outcome: 'completed' })),
        act('No llegó (reembolsar)', () => api('POST', '/api/admin/resolve', { order_id: r.id, outcome: 'failed' }), 'red')) : '']], orders)));
  if (orders.some(o => ['pending', 'processing'].includes(o.status))) timer = setTimeout(async () => { try { adminView(me); } catch {} }, 10000);
}
boot();
