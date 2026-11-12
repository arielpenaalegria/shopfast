'use strict';
const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    k === 'class' ? e.className = v : k.startsWith('on') ? e.addEventListener(k.slice(2), v) : e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : document.createTextNode(c));
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
const STATUS = { completed: 'Completada', failed: 'Fallida', pending: 'Enviando', processing: 'En proceso', unknown: 'Verificando' };
const tag = s => el('span', { class: 'tag ' + s }, STATUS[s] || s);
const card = (title, ...kids) => el('div', { class: 'card' }, title ? el('h2', {}, title) : null, ...kids);
const groupBy = (arr, f) => arr.reduce((m, x) => { const k = f(x); (m.get(k) || m.set(k, []).get(k)).push(x); return m; }, new Map());
let timer = null, flash = null;

function show(which) {
  clearTimeout(timer);
  $('login').classList.toggle('hidden', which !== 'login'); $('app').classList.toggle('hidden', which !== 'app');
  if (which === 'login') $('who').replaceChildren();
}
$('lb').onclick = async () => {
  try { await api('POST', '/api/login', { username: $('lu').value, password: $('lp').value }); $('lp').value = ''; boot(); }
  catch (e) { msg($('lm'), e.message, 'err'); }
};
$('lp').addEventListener('keydown', e => e.key === 'Enter' && $('lb').click());

async function boot() {
  try {
    const me = await api('GET', '/api/me');
    $('who').replaceChildren(el('span', {}, me.username + ' · '),
      el('a', { href: '#', onclick: async e => { e.preventDefault(); await api('POST', '/api/logout', {}); show('login'); } }, 'Salir'));
    show('app');
    me.role === 'admin' ? adminView() : resellerView();
  } catch { show('login'); }
}

/* =================== SUBREVENDEDOR =================== */
const pick = { family: null, product: null }; let scrollTo3 = false;
async function resellerView() {
  clearTimeout(timer);
  const [me, products, orders, led] = await Promise.all([api('GET', '/api/me'), api('GET', '/api/products'), api('GET', '/api/orders'), api('GET', '/api/ledger')]);
  const out = $('app'); out.replaceChildren();
  const fams = groupBy(products, p => p.family);
  if (!fams.has(pick.family)) pick.family = fams.keys().next().value || null;
  const box = el('div'), vbox = el('div');
  if (flash) { msg(box, flash[0], flash[1]); flash = null; }

  const buy = el('div');
  const renderBuy = () => {
    buy.replaceChildren();
    if (!products.length) return buy.append(el('div', { class: 'mut' }, 'Aún no hay productos disponibles. Pídele al administrador que active juegos.'));
    buy.append(el('h3', {}, '1. Elige el juego'),
      el('div', { class: 'chips' }, ...[...fams.keys()].map(f => el('button', { class: 'chip' + (f === pick.family ? ' on' : ''), onclick: () => { pick.family = f; pick.product = null; renderBuy(); } }, f))));
    const list = (fams.get(pick.family) || []).slice().sort((a, b) => a.price - b.price);
    if (!list.some(p => p.id === pick.product)) pick.product = null;
    buy.append(el('h3', {}, '2. Elige el paquete'),
      el('div', { class: 'grid' }, ...list.map(p => el('button', { class: 'pkg' + (p.id === pick.product ? ' on' : ''), onclick: () => { pick.product = p.id; scrollTo3 = true; renderBuy(); } },
        p.name.replace(pick.family, '').replace(/^\s*[·\-–]\s*/, '') || p.name, el('b', {}, money(p.price))))));
    const p = list.find(x => x.id === pick.product);
    if (!p) return;
    const inputs = {};
    const fields = p.fields.map(f => {
      const inp = f.type === 'select'
        ? el('select', {}, el('option', { value: '' }, f.label + '…'), ...(f.options || []).map(o => el('option', { value: o.value }, o.label)))
        : el('input', { placeholder: f.label, autocomplete: 'off', inputmode: /phone|tel|id/i.test(f.key) ? 'numeric' : null });
      inputs[f.key] = inp; return inp;
    });
    const target = () => { const t = {}; for (const [k, i] of Object.entries(inputs)) t[k] = i.value; return t; };
    const vbtn = el('button', { class: 'sec' }, 'Verificar ID');
    vbtn.onclick = async () => {
      vbtn.disabled = true; msg(vbox, 'Verificando…', 'warn');
      try {
        const d = await api('POST', '/api/validate', { product_id: p.id, target: target() });
        if (d.result === 'valid') msg(vbox, '✓ ID válido' + (d.name ? ': ' + d.name : ''), 'ok');
        else if (d.result === 'invalid') msg(vbox, '✗ ID no válido. Revísalo antes de enviar.', 'err');
        else msg(vbox, 'Este juego no permite verificar el ID. Revísalo bien antes de enviar.', 'warn');
      } catch (e) { msg(vbox, e.message, 'err'); }
      setTimeout(() => { vbtn.disabled = false; }, 2000);
    };
    const btn = el('button', {}, `Enviar recarga · ${money(p.price)}`);
    btn.onclick = async () => {
      const t = target();
      if (!confirm(`¿Enviar ${p.name}\na ${Object.values(t).join(' · ')}\npor ${money(p.price)}?`)) return;
      btn.disabled = true;
      try {
        const d = await api('POST', '/api/orders', { product_id: p.id, target: t });
        flash = d.status === 'unknown' ? [d.message, 'warn'] : ['Recarga enviada. Se está procesando; el estado se actualiza solo.', 'ok'];
        pick.product = null;
      } catch (e) { flash = [e.message, 'err']; }
      resellerView();
    };
    const step3 = el('h3', {}, '3. Datos del jugador · ' + p.name);
    buy.append(step3, el('div', { class: 'row' }, ...fields), el('div', { class: 'row' }, vbtn, btn), vbox);
    if (scrollTo3) { scrollTo3 = false; setTimeout(() => { step3.scrollIntoView({ behavior: 'smooth', block: 'start' }); fields[0] && fields[0].focus(); }, 50); }
  };
  renderBuy();

  out.append(
    el('div', { class: 'card hero' }, el('div', { class: 'mut' }, 'Mi saldo'), el('div', { class: 'bal' }, money(me.balance)), el('div', { class: 'mut' }, 'Hola, ' + me.username)),
    card('Nueva recarga', buy, box, el('div', { class: 'mut', style: 'margin-top:10px' }, 'Una recarga puede tardar desde minutos hasta un par de horas. No la repitas mientras esté "En proceso": podría llegar dos veces.')),
    card('Mis recargas', orders.length ? el('div', { class: 'list' }, ...orders.map(o => el('div', {},
      el('div', { class: 'l' }, el('div', {}, o.product_name), el('div', { class: 'mut' }, `#${o.id} · ${o.target} · ${o.created_at}`), o.reason ? el('div', { class: 'mut' }, o.reason) : null),
      el('div', { class: 'r' }, el('div', {}, money(o.price)), tag(o.status))))) : el('div', { class: 'mut' }, 'Todavía no has hecho recargas.')),
    card('Movimientos de saldo', led.length ? el('div', { class: 'list' }, ...led.map(l => el('div', {},
      el('div', { class: 'l' }, el('div', {}, { topup: 'Recarga de saldo', adjust: 'Ajuste', order: 'Compra', refund: 'Reembolso' }[l.type] || l.type), el('div', { class: 'mut' }, (l.note || '') + ' · ' + l.created_at)),
      el('div', { class: 'r', style: 'font-weight:700;color:' + (l.amount < 0 ? 'var(--err)' : 'var(--ok)') }, (l.amount > 0 ? '+' : '') + money(l.amount))))) : el('div', { class: 'mut' }, 'Sin movimientos.')));
  if (orders.some(o => ['pending', 'processing', 'unknown'].includes(o.status))) timer = setTimeout(() => resellerView().catch(() => {}), 10000);
}

/* =================== ADMIN =================== */
let tab = 'resumen', catQuery = '';
async function adminView() {
  clearTimeout(timer);
  const out = $('app');
  const [users, orders, prods, st] = await Promise.all([api('GET', '/api/admin/users'), api('GET', '/api/admin/orders'), api('GET', '/api/admin/products'), api('GET', '/api/admin/status')]);
  const cat = tab === 'catalogo' ? await api('GET', '/api/admin/catalog?q=' + encodeURIComponent(catQuery)) : [];
  out.replaceChildren();
  const note = el('div');
  const act = (label, fn, cls = 'sec') => el('button', { class: cls + ' sm', onclick: async () => { try { await fn(); await adminView(); } catch (e) { alert(e.message); } } }, label);
  const pending = orders.filter(o => o.status === 'unknown').length;
  const tabs = [['resumen', 'Resumen'], ['catalogo', 'Catálogo'], ['revendedores', 'Revendedores'], ['pedidos', 'Pedidos' + (pending ? ` (${pending})` : '')]];
  out.append(el('div', { class: 'tabs' }, ...tabs.map(([k, l]) => el('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; adminView(); } }, l))));
  if (st.balance_low) out.append(el('div', { class: 'msg err', style: 'margin-bottom:12px' }, 'Tu saldo en Central One está bajo o no alcanzó para un pedido. Recarga para no rechazar pedidos.'));

  if (tab === 'resumen') {
    const today = new Date().toISOString().slice(0, 10);
    const done = orders.filter(o => o.status === 'completed' && o.created_at.startsWith(today));
    const pb = st.provider_balance;
    out.append(
      el('div', { class: 'card hero' }, el('div', { class: 'mut' }, 'Saldo en Central One' + (pb && !pb.live ? ' (último dato)' : '')),
        el('div', { class: 'bal' }, pb ? 'US$ ' + Number(pb.available).toFixed(2) : '—'),
        el('div', { class: 'mut' }, pb && pb.held !== null ? `Retenido en pedidos en curso: US$ ${Number(pb.held).toFixed(2)}` : (st.balance_error ? 'No se pudo leer el saldo en vivo' : ''))),
      card('Hoy', el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { class: 'mut' }, 'Recargas completadas'), el('b', {}, String(done.length))),
        el('div', { class: 'stat' }, el('span', { class: 'mut' }, 'Vendido'), el('b', {}, money(done.reduce((s, o) => s + o.price, 0)))),
        el('div', { class: 'stat' }, el('span', { class: 'mut' }, 'Ganancia'), el('b', {}, money(done.reduce((s, o) => s + Number(o.margin), 0)))),
        el('div', { class: 'stat' }, el('span', { class: 'mut' }, 'Por revisar'), el('b', { style: pending ? 'color:var(--warn)' : '' }, String(pending))))),
      card('Estado', el('div', { class: 'mut' }, 'Catálogo actualizado: ' + (st.catalog_synced_at ? st.catalog_synced_at + ' UTC' : 'todavía no')),
        el('div', { class: 'mut' }, 'Productos activos: ' + prods.filter(p => p.active).length + ' · Revendedores: ' + users.length),
        el('div', { class: 'mut' }, 'Webhooks: ' + (st.webhooks ? 'activos' + (st.webhook_test_at ? ' · última prueba ' + st.webhook_test_at + ' UTC' : '') : 'sin configurar (se usa consulta periódica)')),
        st.webhooks ? el('div', { class: 'acts' }, el('button', { class: 'sec sm', onclick: async () => { try { await api('POST', '/api/admin/webhook-test', {}); msg(note, 'Prueba enviada. Recarga en unos segundos.', 'ok'); } catch (e) { msg(note, e.message, 'err'); } } }, 'Enviar aviso de prueba')) : null, note));
  }

  if (tab === 'catalogo') {
    const q = el('input', { placeholder: 'Buscar juego o paquete…', value: catQuery });
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { catQuery = q.value; adminView(); } });
    const fams = groupBy(cat, c => c.family);
    out.append(card('Catálogo de Central One',
      el('div', { class: 'row' }, q, el('button', { class: 'sec', onclick: () => { catQuery = q.value; adminView(); } }, 'Buscar'),
        el('button', { class: 'sec', onclick: async () => { try { const r = await api('POST', '/api/admin/catalog-sync', {}); msg(note, `Catálogo actualizado: ${r.count} productos.`, 'ok'); setTimeout(adminView, 800); } catch (e) { msg(note, e.message, 'err'); } } }, 'Actualizar')),
      el('div', { class: 'mut' }, `${cat.length} productos en ${fams.size} juegos. "Por ID" se puede vender; "Código" (gift card/PIN) todavía no.`), note,
      el('div', { style: 'margin-top:10px' }, ...[...fams].map(([f, items]) => {
        const byId = items.filter(i => i.requires_target), on = byId.filter(i => i.enabled).length;
        return el('details', { class: 'fam', open: catQuery ? '' : null },
          el('summary', {}, el('span', {}, f, el('div', { class: 'mut', style: 'font-weight:400' }, `${byId.length} por ID · ${items.length - byId.length} con código · vendes ${on}`)),
            on ? el('span', { class: 'tag id' }, 'Activo') : null),
          el('div', { class: 'body' },
            byId.length ? el('div', { class: 'acts' }, on < byId.length ? act(`Vender todos por ID (${byId.length})`, () => api('POST', '/api/admin/family', { family: f, active: true }), '') : null,
              on ? act('Dejar de vender todo', () => api('POST', '/api/admin/family', { family: f, active: false }), 'red') : null) : null,
            el('div', { class: 'list' }, ...items.map(c => el('div', {},
              el('div', { class: 'l' }, el('div', {}, c.name), el('div', { class: 'mut' }, (c.price === null ? '' : 'Costo US$ ' + c.price) + (c.fields ? ' · pide: ' + c.fields : '') + (c.in_stock ? '' : ' · agotado'))),
              el('div', { class: 'r' }, !c.requires_target ? el('span', { class: 'tag code' }, 'Código')
                : c.enabled ? act('Quitar', () => api('POST', '/api/admin/product-update', { id: c.local_id, active: false }), 'red')
                  : act('Vender', () => api('POST', '/api/admin/products', { product_id: c.product_id }), '')))))));
      })),
      cat.length ? null : el('div', { class: 'mut' }, 'No hay productos. Pulsa "Actualizar" o revisa que tu llave tenga el permiso catalog:read.')));
    const mine = groupBy(prods.filter(p => p.active), p => p.family);
    out.append(card('Lo que ven tus revendedores', mine.size ? el('div', {}, ...[...mine].map(([f, ps]) => el('div', {}, el('h3', {}, f),
      el('div', { class: 'list' }, ...ps.map(p => el('div', {},
        el('div', { class: 'l' }, el('div', {}, p.name), el('div', { class: 'mut' }, p.cost === null ? 'fuera del catálogo' : 'Costo US$ ' + p.cost + (p.in_stock ? '' : ' · agotado'))),
        el('div', { class: 'r' }, act('Renombrar', async () => { const a = prompt('Nombre que verán tus revendedores:', p.name); if (a) await api('POST', '/api/admin/product-update', { id: p.id, name: a }); }))))))))
      : el('div', { class: 'mut' }, 'Todavía no vendes nada. Abre un juego arriba y pulsa "Vender todos por ID".')));
  }

  if (tab === 'revendedores') {
    const nu = { u: el('input', { placeholder: 'Usuario' }), p: el('input', { placeholder: 'Contraseña (8+)', type: 'password' }), m: el('input', { placeholder: 'Margen %', type: 'number', inputmode: 'decimal', value: '10' }) };
    const create = el('button', {}, 'Crear');
    create.onclick = async () => {
      try { await api('POST', '/api/admin/users', { username: nu.u.value, password: nu.p.value, markup_pct: nu.m.value }); adminView(); }
      catch (e) { msg(note, e.message, 'err'); }
    };
    out.append(card('Nuevo revendedor', el('div', { class: 'row' }, nu.u, nu.p), el('div', { class: 'row' }, nu.m, create),
      el('div', { class: 'mut' }, 'Precio para él = costo de Central One + su margen %.'), note),
    card('Revendedores', users.length ? el('div', { class: 'list' }, ...users.map(r => el('div', { style: 'display:block' },
      el('div', { style: 'display:flex;justify-content:space-between;gap:8px' },
        el('div', {}, el('b', {}, r.username), ' ', r.active ? null : el('span', { class: 'tag off' }, 'Desactivado'), el('div', { class: 'mut' }, `Margen ${r.markup_pct}%`)),
        el('div', { style: 'font-size:1.2rem;font-weight:800' }, money(r.balance))),
      el('div', { class: 'acts' },
        act('+ Saldo', async () => { const a = prompt(`Monto a abonar a ${r.username} (negativo para restar):`); if (a) await api('POST', '/api/admin/balance', { user_id: r.id, amount: a.replace(',', '.') }); }, ''),
        act('Margen', async () => { const a = prompt('Nuevo margen %:', r.markup_pct); if (a !== null) await api('POST', '/api/admin/user-update', { user_id: r.id, markup_pct: a.replace(',', '.') }); }),
        act('Clave', async () => { const a = prompt('Nueva contraseña (8+):'); if (a) await api('POST', '/api/admin/user-update', { user_id: r.id, password: a }); }),
        act(r.active ? 'Desactivar' : 'Activar', () => api('POST', '/api/admin/user-update', { user_id: r.id, active: !r.active }), r.active ? 'red' : 'sec'))))) : el('div', { class: 'mut' }, 'Aún no tienes revendedores.')));
  }

  if (tab === 'pedidos') {
    out.append(card('Pedidos', el('div', { class: 'mut' }, 'Los "Verificando" necesitan tu revisión: compruébalos en el portal de Central One con la referencia.'),
      orders.length ? el('div', { class: 'list' }, ...orders.map(o => el('div', { style: 'display:block' },
        el('div', { style: 'display:flex;justify-content:space-between;gap:8px' },
          el('div', { class: 'l' }, el('div', {}, o.product_name), el('div', { class: 'mut' }, `#${o.id} · ${o.username} · ${o.target}`), el('div', { class: 'mut' }, o.created_at + (o.reference_code ? ' · Ref ' + o.reference_code : ''))),
          el('div', { class: 'r' }, el('div', {}, money(o.price)), el('div', { class: 'mut' }, 'gana ' + Number(o.margin).toFixed(2)), tag(o.status))),
        o.detail ? el('div', { class: 'mut', style: 'margin-top:4px' }, o.detail) : null,
        o.status === 'unknown' ? el('div', { class: 'acts' },
          act('Reintentar (seguro)', () => api('POST', '/api/admin/retry', { order_id: o.id })),
          act('Sí llegó', () => api('POST', '/api/admin/resolve', { order_id: o.id, outcome: 'completed' }), ''),
          act('No llegó (reembolsar)', () => api('POST', '/api/admin/resolve', { order_id: o.id, outcome: 'failed' }), 'red')) : null))) : el('div', { class: 'mut' }, 'Sin pedidos todavía.')));
  }
  if (orders.some(o => ['pending', 'processing'].includes(o.status)) && tab !== 'catalogo') timer = setTimeout(() => adminView().catch(() => {}), 10000);
}
boot();
