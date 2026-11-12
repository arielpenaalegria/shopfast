'use strict';
document.head.append(Object.assign(document.createElement('style'), { textContent: '.addr{font-family:ui-monospace,Menlo,monospace;font-size:.92rem;word-break:break-all;background:#000;border:1px dashed #ff7a0080;color:#ffd7b0;padding:12px;border-radius:10px;margin-top:6px}.addr-s{font-family:ui-monospace,monospace;word-break:break-all;font-size:.75rem}.msg a,.mut a{color:var(--pri)}' }));
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
const usdt = n => Number(n).toFixed(2) + ' USDT';          // saldos y precios de revendedores
const usd = n => 'US$ ' + Number(n).toFixed(2);             // saldo de Central One
const STATUS = { completed: 'Completada', failed: 'Fallida', pending: 'Enviando', processing: 'En proceso', unknown: 'Verificando' };
const REQ = { pending: 'Pendiente', approved: 'Aprobada', rejected: 'Rechazada' };
const tag = (s, map = STATUS) => el('span', { class: 'tag ' + s }, map[s] || s);
const card = (title, ...kids) => el('div', { class: 'card' }, title ? el('h2', {}, title) : null, ...kids);
const groupBy = (arr, f) => arr.reduce((m, x) => { const k = f(x); (m.get(k) || m.set(k, []).get(k)).push(x); return m; }, new Map());
let timer = null, flash = null;
// Vista en CUP (solo visual: todo se cobra en USDT). La elección se recuerda en este teléfono.
let cupMode = ''; try { cupMode = localStorage.getItem('cup') || ''; } catch {}
let rates = { transfer: 0, mobile: 0 };
const CUPL = { transfer: 'CUP transferencia', mobile: 'CUP saldo móvil' };
const cupVal = n => { const r = rates[cupMode]; return cupMode && r > 0 ? Math.ceil(Number(n) * r) : null; };
const cup = n => { const v = cupVal(n); return v === null ? null : '≈ ' + v.toLocaleString('es') + ' CUP'; };

const REG = { ID: 'Indonesia', BR: 'Brasil', EU: 'Europa', LATAM: 'Latinoamérica', US: 'Estados Unidos', NA: 'Norteamérica', SG: 'Singapur', MY: 'Malasia',
  TH: 'Tailandia', VN: 'Vietnam', PH: 'Filipinas', IN: 'India', MENA: 'Medio Oriente y Norte de África', ME: 'Medio Oriente', TW: 'Taiwán', KR: 'Corea',
  JP: 'Japón', RU: 'Rusia', TR: 'Turquía', SA: 'Arabia Saudita', GLOBAL: '' };
const regName = v => REG[String(v).toUpperCase()] ?? '';
const regLabel = v => regName(v) ? `${regName(v)} (${v})` : v;
const shortName = n => { const i = n.indexOf(' · '); return i > 0 ? n.slice(i + 3) : n; }; // "Free Fire (BR) · 100 Diamantes" -> "100 Diamantes"
const regionCard = (code, sub, onclick) => el('button', { class: 'reg', onclick },
  el('span', { class: 'code' }, code), el('span', { class: 'rn' }, regName(code) ? el('b', {}, regName(code)) : null, el('span', { class: 'mut' }, sub)),
  el('span', { class: 'chev' }, '›'));

/** Reduce la foto del comprobante (máx. 1280 px, JPEG) para que suba rápido aunque la conexión sea lenta. */
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

/** Tarjeta para conectar Telegram y recibir avisos (admin y revendedores). */
function telegramCard(extra, refresh) {
  if (!extra.telegram) return null;
  const box = el('div');
  if (extra.telegram_linked) return card('Avisos por Telegram', el('div', { class: 'mut' }, '✓ Conectado. Te llegan los avisos a Telegram.'),
    el('div', { class: 'acts' }, el('button', { class: 'sec sm', onclick: async () => { await api('POST', '/api/telegram-unlink', {}); refresh(); } }, 'Desconectar')));
  const b = el('button', { class: 'sm' }, 'Conectar Telegram');
  b.onclick = async () => {
    try {
      const { url } = await api('POST', '/api/telegram-link', {});
      box.replaceChildren(el('div', { class: 'msg ok' }, 'Abre el bot y pulsa "Iniciar". Luego vuelve aquí y recarga.'),
        el('div', { class: 'acts' }, el('a', { href: url, target: '_blank', rel: 'noopener' }, el('button', { class: 'sm' }, 'Abrir Telegram')),
          el('button', { class: 'sec sm', onclick: refresh }, 'Ya lo hice')));
    } catch (e) { msg(box, e.message, 'err'); }
  };
  return card('Avisos por Telegram', el('div', { class: 'mut' }, 'Recibe un mensaje cuando una recarga se complete o falle y cuando te aprueben saldo.'), el('div', { class: 'acts' }, b), box);
}

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
$('lu').placeholder = 'Correo o usuario';
// Registro de revendedores (si el admin lo tiene abierto)
api('GET', '/api/public-config').then(cfg => {
  if (cfg.registration === 'off') return;
  const em = el('input', { type: 'email', placeholder: 'Tu correo', autocomplete: 'email' });
  const p1 = el('input', { type: 'password', placeholder: 'Contraseña (8 o más)', autocomplete: 'new-password' });
  const p2 = el('input', { type: 'password', placeholder: 'Repite la contraseña', autocomplete: 'new-password' });
  const rm = el('div'), rb = el('button', {}, 'Crear cuenta');
  const form = el('div', { class: 'hidden', style: 'margin-top:14px;text-align:left' }, el('h2', {}, 'Crear cuenta de revendedor'), em, p1, p2, rb, rm,
    cfg.registration === 'approval' ? el('div', { class: 'mut', style: 'margin-top:8px' }, 'El administrador aprobará tu cuenta antes de que puedas entrar.') : null);
  rb.onclick = async () => {
    if (p1.value !== p2.value) return msg(rm, 'Las contraseñas no coinciden', 'err');
    rb.disabled = true;
    try {
      const d = await api('POST', '/api/register', { email: em.value, password: p1.value });
      msg(rm, d.message, 'ok'); $('lu').value = em.value; p1.value = p2.value = '';
      if (d.active) { $('lp').focus(); form.classList.add('hidden'); toggle.classList.remove('hidden'); msg($('lm'), d.message, 'ok'); }
    } catch (e) { msg(rm, e.message, 'err'); }
    rb.disabled = false;
  };
  const toggle = el('button', { class: 'ghost', style: 'margin-top:12px', onclick: () => { form.classList.remove('hidden'); toggle.classList.add('hidden'); em.focus(); } }, '¿No tienes cuenta? Crear cuenta');
  $('login').append(toggle, form);
}).catch(() => {});

async function boot() {
  try {
    const me = await api('GET', '/api/me');
    $('who').replaceChildren(el('span', {}, me.username + ' · '),
      el('a', { href: '#', onclick: async e => { e.preventDefault(); await api('POST', '/api/logout', {}); show('login'); } }, 'Salir'));
    show('app');
    me.role === 'admin' ? adminView() : resellerView();
  } catch { show('login'); }
}

/* =================== REVENDEDOR =================== */
const pick = { family: null, variant: null, product: null, fill: null };
let scrollTo3 = false, rtab = 'recargar';
async function resellerView() {
  clearTimeout(timer);
  const [me, products, orders, led, reqs, extra, dep] = await Promise.all([api('GET', '/api/me'), api('GET', '/api/products'), api('GET', '/api/orders'),
    api('GET', '/api/ledger'), api('GET', '/api/topup-requests'), api('GET', '/api/me-extra'), api('GET', '/api/deposit-info')]);
  rates = me.rates || rates;
  if (cupMode && !(rates[cupMode] > 0)) cupMode = '';
  const out = $('app'); out.replaceChildren();
  const byId = new Map(products.map(p => [p.id, p]));
  const fams = groupBy(products, p => p.family);
  if (!fams.has(pick.family)) pick.family = fams.keys().next().value || null;
  const box = el('div'), vbox = el('div');
  if (flash) { msg(box, flash[0], flash[1]); flash = null; }

  const buy = el('div');
  const renderBuy = () => {
    buy.replaceChildren();
    if (!products.length) return buy.append(el('div', { class: 'mut' }, 'Aún no hay productos disponibles. Pídele al administrador que active juegos.'));
    buy.append(el('h3', {}, '1. Elige el juego'),
      el('div', { class: 'chips' }, ...[...fams.keys()].map(f => el('button', { class: 'chip' + (f === pick.family ? ' on' : ''), onclick: () => { pick.family = f; pick.variant = null; pick.product = null; renderBuy(); } }, f))));
    const vars = groupBy(fams.get(pick.family) || [], p => p.variant);
    if (pick.variant && !vars.has(pick.variant)) pick.variant = null;
    if (vars.size === 1) pick.variant = vars.keys().next().value;
    if (vars.size > 1 && !pick.variant) {
      buy.append(el('h3', {}, '2. ¿Qué región?'),
        el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Elige la región de la cuenta del jugador: cada paquete solo sirve en cuentas de su región o servidor.'),
        ...[...vars].sort((x, y) => y[1].length - x[1].length).map(([v, ps]) => regionCard(v, `${ps.length} opciones`, () => { pick.variant = v; pick.product = null; renderBuy(); })));
      return;
    }
    if (vars.size > 1) buy.append(el('div', { class: 'row', style: 'margin-top:10px;align-items:center' },
      el('span', { class: 'code' }, pick.variant), el('b', {}, regName(pick.variant) || pick.variant),
      el('button', { class: 'ghost', onclick: () => { pick.variant = null; pick.product = null; renderBuy(); } }, '← Cambiar región')));
    const list = (vars.get(pick.variant) || []).slice().sort((a, b) => a.price - b.price);
    if (!list.some(p => p.id === pick.product)) pick.product = null;
    const n = vars.size > 1 ? 3 : 2;
    buy.append(el('h3', {}, n + '. Elige el paquete'),
      el('div', { class: 'grid' }, ...list.map(p => el('button', { class: 'pkg' + (p.id === pick.product ? ' on' : ''), onclick: () => { pick.product = p.id; scrollTo3 = true; renderBuy(); } },
        shortName(p.name), el('b', {}, usdt(p.price)), cup(p.price) ? el('span', { class: 'mut', style: 'display:block;font-size:.78rem' }, cup(p.price)) : null))));
    const p = list.find(x => x.id === pick.product);
    if (!p) return;
    const inputs = {};
    const fields = p.fields.map(f => {
      const inp = f.type === 'select'
        ? el('select', {}, el('option', { value: '' }, f.label + '…'), ...(f.options || []).map(o => el('option', { value: o.value }, o.label)))
        : el('input', { placeholder: f.label, autocomplete: 'off', inputmode: /phone|tel|id/i.test(f.key) ? 'numeric' : null });
      inputs[f.key] = inp; return inp;
    });
    const fillWith = t => { for (const [k, i] of Object.entries(inputs)) if (t && t[k] !== undefined) i.value = t[k]; };
    if (pick.fill) { fillWith(pick.fill); pick.fill = null; }
    // IDs usados antes en este mismo juego y región (los más recientes primero)
    const seen = new Set(), recent = [];
    for (const o of orders) {
      const op = byId.get(o.product_id);
      if (!op || op.family !== p.family || op.variant !== p.variant || !o.target_payload) continue;
      const k = JSON.stringify(o.target_payload); if (seen.has(k)) continue;
      seen.add(k); recent.push(o.target_payload); if (recent.length >= 6) break;
    }
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
    const btn = el('button', {}, `Enviar · ${usdt(p.price)}`);
    btn.onclick = async () => {
      const t = target();
      if (!confirm(`¿Enviar ${p.name}\na ${Object.values(t).join(' · ')}\npor ${usdt(p.price)}${cup(p.price) ? ' (' + cup(p.price) + ' ' + CUPL[cupMode].replace('CUP ', '') + ')' : ''}?`)) return;
      btn.disabled = true;
      try {
        const d = await api('POST', '/api/orders', { product_id: p.id, target: t });
        flash = d.status === 'unknown' ? [d.message, 'warn'] : ['Recarga enviada. Se está procesando; el estado se actualiza solo.', 'ok'];
        pick.product = null;
      } catch (e) { flash = [e.message, 'err']; }
      resellerView();
    };
    const step3 = el('h3', {}, (n + 1) + '. Datos del jugador · ' + shortName(p.name));
    buy.append(step3,
      recent.length ? el('div', { class: 'recents' }, el('span', { class: 'mut', style: 'align-self:center' }, 'Recientes:'),
        ...recent.map(t => el('button', { class: 'chip', onclick: () => fillWith(t) }, Object.values(t).join(' · ')))) : null,
      el('div', { class: 'row' }, ...fields), el('div', { class: 'row' }, vbtn, btn), vbox);
    if (scrollTo3) { scrollTo3 = false; setTimeout(() => { step3.scrollIntoView({ behavior: 'smooth', block: 'start' }); if (!recent.length && fields[0]) fields[0].focus(); }, 50); }
  };

  // "Repetir": vuelve a elegir el mismo paquete con los mismos datos
  const repeat = o => {
    const p = byId.get(o.product_id);
    if (!p) return alert('Ese paquete ya no está disponible.');
    Object.assign(pick, { family: p.family, variant: p.variant, product: p.id, fill: o.target_payload });
    rtab = 'recargar'; scrollTo3 = true; resellerView();
  };

  // Pedir saldo: USDT BEP20 con hash (se verifica solo) o, si algo no cuadra, revisión manual
  const reqBox = el('div');
  const hash = el('input', { placeholder: 'Hash de la transacción (0x…)', autocomplete: 'off', spellcheck: 'false' });
  const amount = el('input', { type: 'number', inputmode: 'decimal', min: '1', step: '0.01', placeholder: 'Monto enviado en USDT' });
  const note = el('input', { placeholder: 'Nota (opcional)' });
  const file = el('input', { type: 'file', accept: 'image/*' });
  const preview = el('div');
  let image = null;
  file.onchange = async () => {
    image = null; preview.replaceChildren();
    if (!file.files[0]) return;
    try { image = await shrinkImage(file.files[0]); preview.append(el('img', { src: image, class: 'proof', alt: 'Comprobante' })); }
    catch (e) { msg(reqBox, e.message, 'err'); }
  };
  const send = el('button', {}, 'Enviar');
  send.onclick = async () => {
    send.disabled = true; msg(reqBox, 'Verificando el pago…', 'warn');
    try {
      const d = await api('POST', '/api/topup-requests', { tx_hash: hash.value.trim(), amount: amount.value.replace(',', '.'), note: note.value, image });
      flash = [d.message, d.auto === 'approved' ? 'ok' : d.auto === 'wait' ? 'warn' : 'ok']; rtab = 'saldo'; resellerView(); return;
    } catch (e) { msg(reqBox, e.message, 'err'); }
    send.disabled = false;
  };
  const copyBtn = el('button', { class: 'sec sm' }, 'Copiar');
  copyBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(dep.wallet); copyBtn.textContent = '✓ Copiada'; }
    catch { prompt('Copia la dirección:', dep.wallet); }
  };
  const walletCard = dep.wallet ? card('1. Envía USDT a esta billetera',
    el('div', { class: 'msg err', style: 'margin:0 0 10px' }, '⚠ Solo USDT por la red BSC (BEP20). Si lo envías por otra red (TRC20, ERC20…) el dinero se pierde.'),
    el('div', { class: 'addr' }, dep.wallet), el('div', { class: 'acts' }, copyBtn),
    el('div', { class: 'mut', style: 'margin-top:8px' }, 'Puedes enviar cualquier monto (mínimo 1 USDT). Se te abona lo que llegue a la billetera.'))
    : card('Pedir saldo', el('div', { class: 'mut' }, 'El administrador todavía no configuró su billetera. Pídele los datos de pago.'));
  const manual = el('details', { class: 'regd' }, el('summary', {}, el('span', { class: 'mut' }, '¿No tienes el hash? Revisión manual ›')),
    el('div', { class: 'row' }, amount), el('div', { class: 'row' }, file), preview);
  const tabs = [['recargar', 'Recargar'], ['historial', 'Mis recargas'], ['saldo', 'Pedir saldo' + (reqs.some(r => r.status === 'pending') ? ' •' : '')], ['cuenta', 'Cuenta']];
  out.append(
    me.announcement ? el('div', { class: 'msg warn', style: 'margin:0 0 12px;white-space:pre-wrap' }, '📢 ' + me.announcement) : null,
    el('div', { class: 'card hero' }, el('div', { class: 'mut' }, 'Mi saldo'), el('div', { class: 'bal' }, Number(me.balance).toFixed(2), el('small', {}, 'USDT')),
      cup(me.balance) ? el('div', { style: 'font-weight:700' }, cup(me.balance) + ' · ' + CUPL[cupMode].replace('CUP ', '')) : null,
      (rates.transfer > 0 || rates.mobile > 0) ? el('div', { class: 'chips', style: 'margin-top:10px' }, el('span', { class: 'mut', style: 'align-self:center' }, 'Ver en:'),
        ...[['', 'Solo USDT'], ['transfer', 'CUP transf.'], ['mobile', 'CUP saldo']].filter(([k]) => !k || rates[k] > 0).map(([k, l]) =>
          el('button', { class: 'chip' + (cupMode === k ? ' on' : ''), style: cupMode === k ? 'background:#000' : 'background:#ffffff26;border-color:#ffffff40;color:#fff',
            onclick: () => { cupMode = k; try { localStorage.setItem('cup', k); } catch {} resellerView(); } }, l))) : null,
      el('div', { class: 'acts' }, el('button', { class: 'sec sm', onclick: () => { rtab = 'saldo'; resellerView(); } }, '+ Pedir saldo'))),
    el('div', { class: 'tabs' }, ...tabs.map(([k, l]) => el('button', { class: k === rtab ? 'on' : '', onclick: () => { rtab = k; resellerView(); } }, l))));

  if (rtab === 'recargar') {
    renderBuy();
    out.append(card('Nueva recarga', buy, box, el('div', { class: 'mut', style: 'margin-top:10px' }, 'Una recarga puede tardar desde minutos hasta un par de horas. No la repitas mientras esté "En proceso": podría llegar dos veces.')));
  }
  if (rtab === 'historial') {
    out.append(box, card('Mis recargas', orders.length ? el('div', { class: 'list' }, ...orders.map(o => el('div', {},
      el('div', { class: 'l' }, el('div', {}, o.product_name), el('div', { class: 'mut' }, `#${o.id} · ${o.target} · ${o.created_at}`), o.reason ? el('div', { class: 'mut' }, o.reason) : null,
        byId.has(o.product_id) && ['completed', 'failed'].includes(o.status) ? el('button', { class: 'ghost', onclick: () => repeat(o) }, '↻ Repetir') : null),
      el('div', { class: 'r' }, el('div', {}, usdt(o.price)), cup(o.price) ? el('div', { class: 'mut', style: 'font-size:.75rem' }, cup(o.price)) : null, tag(o.status))))) : el('div', { class: 'mut' }, 'Todavía no has hecho recargas.')));
  }
  if (rtab === 'saldo') {
    out.append(box, walletCard,
      card('2. Pega el hash del envío', el('div', { class: 'mut', style: 'margin-bottom:8px' },
        dep.auto ? 'El panel comprueba el pago en la blockchain y te abona el saldo solo, normalmente en menos de un minuto.' : 'El administrador revisará el pago y te abonará el saldo.'),
        el('div', { class: 'row' }, hash), el('div', { class: 'row' }, note), manual, el('div', { class: 'acts' }, send), reqBox),
      card('Mis solicitudes', reqs.length ? el('div', { class: 'list' }, ...reqs.map(r => el('div', {},
        el('div', { class: 'l' }, el('div', {}, `Solicitud #${r.id}`), el('div', { class: 'mut' }, r.created_at + (r.tx_hash ? ' · ' + r.tx_hash.slice(0, 10) + '…' : '') + (r.note ? ' · ' + r.note : '')),
          r.status === 'pending' && r.verify === 'wait' ? el('div', { class: 'mut' }, '⏳ ' + (r.verify_msg || 'Confirmando en BSC…')) : null,
          r.status === 'pending' && r.verify !== 'wait' ? el('div', { class: 'mut' }, 'En revisión por el administrador') : null,
          r.admin_note ? el('div', { class: 'mut' }, r.admin_note) : null),
        el('div', { class: 'r' }, el('div', {}, (r.approved ?? r.chain_amount ?? r.amount) == null ? '—' : usdt(r.approved ?? r.chain_amount ?? r.amount)), tag(r.status, REQ))))) : el('div', { class: 'mut' }, 'No has pedido saldo todavía.')),
      card('Movimientos de saldo', led.length ? el('div', { class: 'list' }, ...led.map(l => el('div', {},
        el('div', { class: 'l' }, el('div', {}, { topup: 'Recarga de saldo', adjust: 'Ajuste', order: 'Compra', refund: 'Reembolso' }[l.type] || l.type), el('div', { class: 'mut' }, (l.note || '') + ' · ' + l.created_at)),
        el('div', { class: 'r', style: 'font-weight:700;color:' + (l.amount < 0 ? 'var(--err)' : 'var(--ok)') }, (l.amount > 0 ? '+' : '') + usdt(l.amount))))) : el('div', { class: 'mut' }, 'Sin movimientos.')));
  }
  if (rtab === 'cuenta') {
    out.append(card('Mi cuenta', el('div', {}, 'Usuario: ', el('b', {}, me.username))), telegramCard(extra, resellerView) || card('Avisos por Telegram', el('div', { class: 'mut' }, 'El administrador todavía no activó los avisos por Telegram.')));
  }
  if ((orders.some(o => ['pending', 'processing', 'unknown'].includes(o.status)) && rtab !== 'saldo') || (rtab === 'saldo' && reqs.some(r => r.status === 'pending' && r.verify === 'wait'))) timer = setTimeout(() => resellerView().catch(() => {}), 10000);
}

/* =================== ADMIN =================== */
let tab = 'resumen', catQuery = '', period = 'day';
async function adminView() {
  clearTimeout(timer);
  const out = $('app');
  const [users, orders, prods, st, reqs] = await Promise.all([api('GET', '/api/admin/users'), api('GET', '/api/admin/orders'), api('GET', '/api/admin/products'),
    api('GET', '/api/admin/status'), api('GET', '/api/admin/topup-requests')]);
  const cat = tab === 'catalogo' ? await api('GET', '/api/admin/catalog?q=' + encodeURIComponent(catQuery)) : [];
  const rep = tab === 'reportes' ? await api('GET', '/api/admin/report?period=' + period) : null;
  out.replaceChildren();
  const note = el('div');
  const act = (label, fn, cls = 'sec') => el('button', { class: cls + ' sm', onclick: async () => { try { await fn(); await adminView(); } catch (e) { if (e.message !== 'Cancelado') alert(e.message); } } }, label);
  const pending = orders.filter(o => o.status === 'unknown').length, preq = reqs.filter(r => r.status === 'pending').length;
  const pend = users.filter(u => u.pending).length;
  const tabs = [['resumen', 'Resumen'], ['saldo', 'Saldo' + (preq ? ` (${preq})` : '')], ['pedidos', 'Pedidos' + (pending ? ` (${pending})` : '')],
    ['reportes', 'Ganancias'], ['revendedores', 'Revendedores' + (pend ? ` (${pend})` : '')], ['catalogo', 'Catálogo']];
  out.append(el('div', { class: 'tabs' }, ...tabs.map(([k, l]) => el('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; adminView(); } }, l))));
  if (st.balance_low) out.append(el('div', { class: 'msg err', style: 'margin-bottom:12px' }, 'Tu saldo en Central One está bajo o no alcanzó para un pedido. Recarga para no rechazar pedidos.'));

  if (tab === 'resumen') {
    const today = new Date().toISOString().slice(0, 10);
    const done = orders.filter(o => o.status === 'completed' && o.created_at.startsWith(today));
    const pb = st.provider_balance;
    const th = el('input', { type: 'number', inputmode: 'decimal', min: '0', value: String(st.low_balance_threshold || ''), placeholder: 'Ej. 20' });
    out.append(
      el('div', { class: 'card hero' }, el('div', { class: 'mut' }, 'Saldo en Central One' + (pb && !pb.live ? ' (último dato)' : '')),
        el('div', { class: 'bal' }, pb ? usd(pb.available) : '—'),
        el('div', { class: 'mut' }, pb && pb.held !== null ? `Retenido en pedidos en curso: ${usd(pb.held)}` : (st.balance_error ? 'No se pudo leer el saldo en vivo' : ''))),
      card('Hoy', el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { class: 'mut' }, 'Recargas'), el('b', {}, String(done.length))),
        el('div', { class: 'stat' }, el('span', { class: 'mut' }, 'Vendido'), el('b', {}, usdt(done.reduce((s, o) => s + o.price, 0)))),
        el('div', { class: 'stat' }, el('span', { class: 'mut' }, 'Ganancia'), el('b', { style: 'color:var(--ok)' }, usdt(done.reduce((s, o) => s + Number(o.margin), 0)))),
        el('div', { class: 'stat' }, el('span', { class: 'mut' }, 'Por revisar'), el('b', { style: pending + preq ? 'color:var(--warn)' : '' }, String(pending + preq))))),
      card('Alerta de saldo bajo', el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Te aviso por Telegram (y aquí arriba) cuando el saldo de Central One baje de este monto. 0 = desactivada.'),
        el('div', { class: 'row' }, th, act('Guardar', () => api('POST', '/api/admin/settings', { low_balance_threshold: th.value.replace(',', '.') || 0 }), ''))),
      (() => {
        const S = st.settings, rt = el('input', { type: 'number', inputmode: 'decimal', min: '0', value: S.rate_transfer || '', placeholder: 'Ej. 400' }),
          rm = el('input', { type: 'number', inputmode: 'decimal', min: '0', value: S.rate_mobile || '', placeholder: 'Ej. 300' });
        return card('Tasas CUP (solo para mostrar)', el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'CUP por cada 1 USDT. Tus revendedores verán el equivalente en CUP debajo de cada precio. Se cobra siempre en USDT. 0 = no mostrar.'),
          el('div', { class: 'mut' }, 'Tasa transferencia bancaria'), el('div', { class: 'row' }, rt, act('Guardar transferencia', () => api('POST', '/api/admin/settings', { rate_transfer: rt.value || 0 }), '')),
          el('div', { class: 'mut' }, 'Tasa saldo móvil'), el('div', { class: 'row' }, rm, act('Guardar saldo móvil', () => api('POST', '/api/admin/settings', { rate_mobile: rm.value || 0 }), '')));
      })(),
      (() => {
        const S = st.settings, mode = el('select', {}, ...[['approval', 'Abierto, con mi aprobación'], ['open', 'Abierto, sin aprobación'], ['off', 'Cerrado (solo yo creo cuentas)']]
          .map(([v, l]) => el('option', { value: v, selected: S.registration === v ? '' : null }, l)));
        const mk = el('input', { type: 'number', inputmode: 'decimal', min: '0', max: '100', value: String(S.default_markup), placeholder: 'Margen %' });
        return card('Registro de revendedores', el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Tus revendedores pueden crearse una cuenta con su correo en ' + location.origin + '. Margen inicial de las cuentas nuevas:'),
          el('div', { class: 'row' }, mode), el('div', { class: 'row' }, mk, act('Guardar', () => api('POST', '/api/admin/settings', { registration: mode.value, default_markup: mk.value || 0 }), '')));
      })(),
      (() => {
        const ta = el('textarea', { rows: '3', placeholder: 'Ej.: Free Fire con 10% de bono hoy 🎉', style: 'width:100%' }); ta.value = st.settings.announcement || '';
        return card('Aviso para revendedores', el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Lo ven arriba en su panel. Déjalo vacío para quitarlo.'), ta,
          el('div', { class: 'acts' }, act('Publicar', () => api('POST', '/api/admin/settings', { announcement: ta.value }), ''), st.settings.announcement ? act('Quitar', () => api('POST', '/api/admin/settings', { announcement: '' }), 'red') : null));
      })(),
      telegramCard(st, adminView) || card('Avisos por Telegram', el('div', { class: 'mut' }, 'Desactivado. Para activarlo crea un bot con @BotFather y pon su token en la variable TELEGRAM_BOT_TOKEN de Render.')),
      card('Respaldo', el('div', { class: 'mut' }, 'Descarga una copia de revendedores, saldos y pedidos. Hazlo cada semana y guárdala en un lugar seguro: contiene los datos de tus revendedores.'),
        el('div', { class: 'acts' }, el('a', { href: '/api/admin/backup', download: '' }, el('button', { class: 'sm' }, '⬇ Descargar respaldo')))),
      card('Estado', el('div', { class: 'mut' }, 'Catálogo actualizado: ' + (st.catalog_synced_at ? st.catalog_synced_at + ' UTC' : 'todavía no')),
        el('div', { class: 'mut' }, 'Productos activos: ' + prods.filter(p => p.active).length + ' · Revendedores: ' + users.length),
        el('div', { class: 'mut' }, 'Webhooks: ' + (st.webhooks ? 'activos' + (st.webhook_test_at ? ' · última prueba ' + st.webhook_test_at + ' UTC' : '') : 'sin configurar (se usa consulta periódica)')),
        st.webhooks ? el('div', { class: 'acts' }, el('button', { class: 'sec sm', onclick: async () => { try { await api('POST', '/api/admin/webhook-test', {}); msg(note, 'Prueba enviada. Recarga en unos segundos.', 'ok'); } catch (e) { msg(note, e.message, 'err'); } } }, 'Enviar aviso de prueba')) : null, note));
  }

  if (tab === 'saldo') {
    const [dep, wallets] = await Promise.all([api('GET', '/api/deposit-info'), api('GET', '/api/admin/wallets')]);
    const showImg = async (r, holder, b) => {
      b.disabled = true;
      try { const d = await api('GET', '/api/admin/topup-image?id=' + r.id); holder.replaceChildren(d.image ? el('img', { src: d.image, class: 'proof', alt: 'Comprobante' }) : el('div', { class: 'mut' }, 'Sin imagen')); }
      catch (e) { alert(e.message); b.disabled = false; }
    };
    const VER = { wait: ['⏳', 'warn'], verified: ['✓ Verificado en BSC', 'ok'], bad: ['✗ No cuadra', 'err'], manual: ['Manual', 'warn'], ok: ['✓ Automático', 'ok'] };
    out.append(
      card('Depósitos USDT BEP20', dep.wallet
        ? el('div', {}, el('div', { class: 'mut' }, 'Billetera que ven tus revendedores:'), el('div', { class: 'addr' }, dep.wallet),
          el('div', { class: 'mut', style: 'margin-top:6px' }, dep.auto ? `Verificación automática activa (${dep.min_confirmations} confirmaciones).` : 'Verificación automática desactivada: falta BSC_RPC_URL en Render.'))
        : el('div', { class: 'mut' }, 'Sin configurar. En Render agrega USDT_WALLET (tu dirección BEP20) y BSC_RPC_URL (tu URL de NodeReal).')),
      card('Solicitudes de saldo', el('div', { class: 'mut' }, 'Las que vienen de una billetera de confianza se aprueban solas. Las demás las revisas aquí.'),
      reqs.length ? el('div', { class: 'list' }, ...reqs.map(r => {
        const holder = el('div'), vb = el('button', { class: 'ghost' }, 'Ver comprobante');
        vb.onclick = () => showImg(r, holder, vb);
        const v = r.verify === 'verified' && r.wallet_owner && r.wallet_owner !== r.username ? ['⚠ Revisar', 'warn'] : (VER[r.verify] || VER.manual);
        const show = r.approved ?? r.chain_amount ?? r.amount;
        return el('div', { style: 'display:block' },
          el('div', { style: 'display:flex;justify-content:space-between;gap:8px' },
            el('div', { class: 'l' }, el('div', {}, `${r.username} · #${r.id}`), el('div', { class: 'mut' }, r.created_at + (r.note ? ' · ' + r.note : '')),
              r.tx_hash ? el('div', { class: 'mut' }, el('a', { href: 'https://bscscan.com/tx/' + r.tx_hash, target: '_blank', rel: 'noopener' }, 'Ver en BscScan: ' + r.tx_hash.slice(0, 12) + '…')) : null,
              r.chain_from ? el('div', { class: 'mut' }, 'Desde ' + r.chain_from.slice(0, 8) + '…' + r.chain_from.slice(-6) + (r.wallet_owner ? ` (billetera de ${r.wallet_owner})` : ' (nueva)')) : null,
              r.amount != null && r.chain_amount != null && r.amount !== r.chain_amount ? el('div', { class: 'mut' }, `Dijo ${usdt(r.amount)}, llegó ${usdt(r.chain_amount)}`) : null,
              r.admin_note ? el('div', { class: 'mut' }, r.admin_note) : null),
            el('div', { class: 'r' }, el('div', { style: 'font-weight:800' }, show == null ? '—' : usdt(show)), tag(r.status, REQ))),
          r.status === 'pending' && (r.verify_msg || r.tx_hash) ? el('div', { class: 'msg ' + v[1] }, v[0] + (r.verify_msg ? ' · ' + r.verify_msg : '')) : null,
          r.has_image ? vb : null, holder,
          r.status === 'pending' ? el('div', { class: 'acts' },
            act('Aprobar', async () => {
              const a = prompt(`Monto a abonar a ${r.username} (USDT):`, show == null ? '' : Number(show).toFixed(2)); if (a === null) throw new Error('Cancelado');
              const trust = !!(r.chain_from && !r.wallet_owner) && confirm(`¿Confiar en la billetera ${r.chain_from.slice(0, 8)}… para ${r.username}?\n\nSus próximos pagos desde ella se aprobarán solos.\nPulsa Cancelar si es de un exchange (Binance, etc.), porque esas billeteras las comparten muchas personas.`);
              await api('POST', '/api/admin/topup-decide', { id: r.id, approve: true, amount: a.replace(',', '.'), trust_wallet: trust });
            }, ''),
            r.tx_hash && dep.auto ? act('Verificar otra vez', () => api('POST', '/api/admin/topup-recheck', { id: r.id })) : null,
            act('Rechazar', async () => {
              const m = prompt('Motivo (lo verá el revendedor):', ''); if (m === null) throw new Error('Cancelado');
              await api('POST', '/api/admin/topup-decide', { id: r.id, approve: false, note: m });
            }, 'red')) : null);
      })) : el('div', { class: 'mut' }, 'No hay solicitudes.')),
      card('Billeteras de confianza', el('div', { class: 'mut', style: 'margin-bottom:6px' }, 'Los pagos desde estas billeteras se abonan solos a su revendedor. No pongas aquí billeteras de exchanges.'),
        wallets.length ? el('div', { class: 'list' }, ...wallets.map(w => el('div', {},
          el('div', { class: 'l' }, el('div', {}, w.username || '?'), el('div', { class: 'mut addr-s' }, w.address)),
          el('div', { class: 'r' }, act('Quitar', () => api('POST', '/api/admin/wallet-remove', { address: w.address }), 'red'))))) : el('div', { class: 'mut' }, 'Ninguna todavía. Se agregan al aprobar un pago y marcar "confiar".')));
  }

  if (tab === 'reportes' && rep) {
    const max = Math.max(0.01, ...rep.daily.map(d => d.profit));
    out.append(
      el('div', { class: 'tabs' }, ...[['day', 'Hoy'], ['week', 'Esta semana'], ['month', 'Este mes']].map(([k, l]) =>
        el('button', { class: k === period ? 'on' : '', onclick: () => { period = k; adminView(); } }, l))),
      card('Ganancias', el('div', { class: 'mut' }, 'Desde ' + rep.from + ' UTC · solo recargas completadas'),
        el('div', { class: 'stats', style: 'margin-top:10px' },
          el('div', { class: 'stat' }, el('span', { class: 'mut' }, 'Recargas'), el('b', {}, String(rep.count))),
          el('div', { class: 'stat' }, el('span', { class: 'mut' }, 'Vendido'), el('b', {}, usdt(rep.sold))),
          el('div', { class: 'stat' }, el('span', { class: 'mut' }, 'Costo Central One'), el('b', {}, usdt(rep.cost))),
          el('div', { class: 'stat' }, el('span', { class: 'mut' }, 'Ganancia'), el('b', { style: 'color:var(--ok)' }, usdt(rep.profit))))),
      card('Ganancia de los últimos 14 días',
        el('div', { class: 'bars' }, ...rep.daily.map(d => el('div', { style: `height:${Math.round(d.profit / max * 100)}%`, title: `${d.day}: ${usdt(d.profit)}` }))),
        el('div', { class: 'bars-l' }, ...rep.daily.map(d => el('span', {}, d.day.slice(8))))),
      card('Por revendedor', rep.resellers.length ? el('div', { class: 'list' }, ...rep.resellers.map(x => el('div', {},
        el('div', { class: 'l' }, el('div', {}, x.username), el('div', { class: 'mut' }, `${x.count} recargas · vendió ${usdt(x.sold)}`)),
        el('div', { class: 'r', style: 'font-weight:800;color:var(--ok)' }, usdt(x.profit))))) : el('div', { class: 'mut' }, 'Sin ventas en este periodo.')),
      card('Productos que más ganancia dejan', rep.products.length ? el('div', { class: 'list' }, ...rep.products.map(x => el('div', {},
        el('div', { class: 'l' }, el('div', {}, x.name), el('div', { class: 'mut' }, `${x.count} vendidos`)),
        el('div', { class: 'r', style: 'font-weight:700' }, usdt(x.profit))))) : el('div', { class: 'mut' }, 'Sin ventas en este periodo.')));
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
        const byIdItems = items.filter(i => i.requires_target), on = byIdItems.filter(i => i.enabled).length;
        return el('details', { class: 'fam', open: catQuery ? '' : null },
          el('summary', {}, el('span', {}, f, el('div', { class: 'mut', style: 'font-weight:400' }, `${byIdItems.length} por ID · ${items.length - byIdItems.length} con código · vendes ${on}`)),
            on ? el('span', { class: 'tag id' }, 'Activo') : null),
          el('div', { class: 'body' },
            byIdItems.length ? el('div', { class: 'acts' }, on < byIdItems.length ? act(`Vender todos por ID (${byIdItems.length})`, () => api('POST', '/api/admin/family', { family: f, active: true }), '') : null,
              on ? act('Dejar de vender todo', () => api('POST', '/api/admin/family', { family: f, active: false }), 'red') : null) : null,
            ...[...groupBy(items, c => c.variant)].sort((x, y) => y[1].length - x[1].length).map(([v, vi]) => {
              const vId = vi.filter(i => i.requires_target), vOn = vId.filter(i => i.enabled).length;
              return el('details', { class: 'regd' },
                el('summary', {}, el('span', { class: 'code' }, v), el('span', { class: 'rn' }, regName(v) ? el('b', {}, regName(v)) : null,
                  el('span', { class: 'mut' }, `${vi.length} opciones · ${vId.length} por ID · vendes ${vOn}`)), vOn ? el('span', { class: 'tag id' }, 'Activo') : el('span', { class: 'chev' }, '›')),
                vId.length ? el('div', { class: 'acts' }, vOn < vId.length ? act(`Vender toda la región (${vId.length})`, () => api('POST', '/api/admin/family', { family: f, variant: v, active: true }), '') : null,
                  vOn ? act('Quitar región', () => api('POST', '/api/admin/family', { family: f, variant: v, active: false }), 'red') : null) : null,
                el('div', { class: 'list' }, ...vi.map(c => el('div', {},
                  el('div', { class: 'l' }, el('div', {}, shortName(c.name)), el('div', { class: 'mut' }, (c.price === null ? '' : 'Costo US$ ' + c.price) + (c.fields ? ' · pide: ' + c.fields : '') + (c.in_stock ? '' : ' · agotado'))),
                  el('div', { class: 'r' }, !c.requires_target ? el('span', { class: 'tag code' }, 'Código')
                    : c.enabled ? act('Quitar', () => api('POST', '/api/admin/product-update', { id: c.local_id, active: false }), 'red')
                      : act('Vender', () => api('POST', '/api/admin/products', { product_id: c.product_id }), ''))))));
            })));
      })),
      cat.length ? null : el('div', { class: 'mut' }, 'No hay productos. Pulsa "Actualizar" o revisa que tu llave tenga el permiso catalog:read.')));
    const mine = groupBy(prods.filter(p => p.active), p => p.family + ' · ' + regLabel(p.variant));
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
      try { await api('POST', '/api/admin/users', { username: nu.u.value, password: nu.p.value, markup_pct: nu.m.value.replace(',', '.') }); adminView(); }
      catch (e) { msg(note, e.message, 'err'); }
    };
    out.append(card('Nuevo revendedor', el('div', { class: 'row' }, nu.u, nu.p), el('div', { class: 'row' }, nu.m, create),
      el('div', { class: 'mut' }, 'Precio para él = costo de Central One + su margen %. Así ganas el mismo porcentaje en todos los paquetes, pequeños o grandes.'), note),
    users.some(u => u.pending) ? card('Pendientes de aprobación', el('div', { class: 'list' }, ...users.filter(u => u.pending).map(r => el('div', {},
      el('div', { class: 'l' }, el('div', {}, r.username), el('div', { class: 'mut' }, 'Se registró ' + r.created_at)),
      el('div', { class: 'r' }, act('Aprobar', () => api('POST', '/api/admin/user-update', { user_id: r.id, active: true }), ''), ' ',
        act('Borrar', async () => { if (!confirm('¿Borrar la cuenta ' + r.username + '?')) throw new Error('Cancelado'); await api('POST', '/api/admin/user-delete', { user_id: r.id }); }, 'red')))))) : null,
    card('Revendedores', users.some(u => !u.pending) ? el('div', { class: 'list' }, ...users.filter(u => !u.pending).map(r => el('div', { style: 'display:block' },
      el('div', { style: 'display:flex;justify-content:space-between;gap:8px' },
        el('div', {}, el('b', {}, r.username), ' ', r.active ? null : el('span', { class: 'tag off' }, 'Desactivado'), el('div', { class: 'mut' }, `Margen ${r.markup_pct}%`)),
        el('div', { style: 'font-size:1.15rem;font-weight:800' }, usdt(r.balance))),
      el('div', { class: 'acts' },
        act('+ Saldo', async () => { const a = prompt(`Monto a abonar a ${r.username} en USDT (negativo para restar):`); if (a) await api('POST', '/api/admin/balance', { user_id: r.id, amount: a.replace(',', '.') }); }, ''),
        act('Margen', async () => { const a = prompt('Nuevo margen %:', r.markup_pct); if (a !== null) await api('POST', '/api/admin/user-update', { user_id: r.id, markup_pct: a.replace(',', '.') }); }),
        act('Clave', async () => { const a = prompt('Nueva contraseña (8+):'); if (a) await api('POST', '/api/admin/user-update', { user_id: r.id, password: a }); }),
        act(r.active ? 'Desactivar' : 'Activar', () => api('POST', '/api/admin/user-update', { user_id: r.id, active: !r.active }), r.active ? 'red' : 'sec'))))) : el('div', { class: 'mut' }, 'Aún no tienes revendedores.')));
  }

  if (tab === 'pedidos') {
    out.append(card('Pedidos', el('div', { class: 'mut' }, 'Los "Verificando" necesitan tu revisión: compruébalos en el portal de Central One con la referencia.'),
      orders.length ? el('div', { class: 'list' }, ...orders.map(o => el('div', { style: 'display:block' },
        el('div', { style: 'display:flex;justify-content:space-between;gap:8px' },
          el('div', { class: 'l' }, el('div', {}, o.product_name), el('div', { class: 'mut' }, `#${o.id} · ${o.username} · ${o.target}`), el('div', { class: 'mut' }, o.created_at + (o.reference_code ? ' · Ref ' + o.reference_code : ''))),
          el('div', { class: 'r' }, el('div', {}, usdt(o.price)), el('div', { class: 'mut' }, 'gana ' + Number(o.margin).toFixed(2)), tag(o.status))),
        o.detail ? el('div', { class: 'mut', style: 'margin-top:4px' }, o.detail) : null,
        o.status === 'unknown' ? el('div', { class: 'acts' },
          act('Reintentar (seguro)', () => api('POST', '/api/admin/retry', { order_id: o.id })),
          act('Sí llegó', () => api('POST', '/api/admin/resolve', { order_id: o.id, outcome: 'completed' }), ''),
          act('No llegó (reembolsar)', () => api('POST', '/api/admin/resolve', { order_id: o.id, outcome: 'failed' }), 'red')) : null))) : el('div', { class: 'mut' }, 'Sin pedidos todavía.')));
  }
  if (orders.some(o => ['pending', 'processing'].includes(o.status)) && ['resumen', 'pedidos'].includes(tab) || (tab === 'saldo' && reqs.some(r => r.status === 'pending' && r.verify === 'wait'))) timer = setTimeout(() => adminView().catch(() => {}), 10000);
}
boot();
