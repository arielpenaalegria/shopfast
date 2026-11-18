'use strict';
document.head.append(Object.assign(document.createElement('style'), { textContent: '.addr{font-family:ui-monospace,Menlo,monospace;font-size:.92rem;word-break:break-all;background:#000;border:1px dashed #ff7a0080;color:#ffd7b0;padding:12px;border-radius:10px;margin-top:6px}.addr-s{font-family:ui-monospace,monospace;word-break:break-all;font-size:.75rem}.msg a,.mut a{color:var(--pri)}.proof{display:block;max-width:100%;max-height:380px;border-radius:10px;margin-top:8px;border:1px solid var(--line);cursor:zoom-in}.payinfo{background:#000;border:1px dashed #ff7a0080;border-radius:10px;padding:6px 12px}.payinfo .pl{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #ffffff12;overflow-wrap:anywhere}.payinfo .pl:last-child{border:0}.payinfo .pl span{color:#ffd7b0}.steps{margin:0 0 10px;padding-left:20px;color:var(--mut);font-size:.88rem}.steps li{margin:3px 0}.big{font-size:1.05rem;padding:13px}.zoom{position:fixed;inset:0;background:#000e;z-index:50;display:flex;align-items:center;justify-content:center;padding:10px;cursor:zoom-out}.zoom img{max-width:100%;max-height:100%;border-radius:8px}.row3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:4px 0}.row3 .fld{font-size:.78rem;min-width:0}.row3 input{padding:10px 8px;font-size:.95rem}.bals{display:grid;gap:6px;margin:6px 0 4px}.bals>div{display:flex;justify-content:space-between;align-items:baseline;background:#0000002a;border-radius:10px;padding:8px 12px}.bals span{font-size:.88rem;color:#ffedd5}.bals b{font-size:1.35rem;font-weight:900}.bals small{font-size:.8rem;font-weight:700}.paych{display:flex;flex-direction:column;align-items:flex-start;border-radius:12px;text-align:left}.paych small{font-weight:500;font-size:.74rem;opacity:.8}.paych.low:not(.on){opacity:.55}' }));
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
  let r;
  try { r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error('Sin conexión con el panel. Revisa tu internet e intenta otra vez.'); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/api/login') { show('login'); throw new Error('Sesión expirada'); }
  if (!r.ok && r.status !== 202) throw Object.assign(new Error(d.error || 'Error'), { data: d });
  return d;
}
/** Como append, pero ignora null/false (si no, el navegador escribe "null" en pantalla). */
const put = (parent, ...kids) => parent.append(...kids.flat().filter(k => k !== null && k !== undefined && k !== false));
const msg = (box, text, cls) => { box.replaceChildren(el('div', { class: 'msg ' + cls }, text)); };
const usdt = n => Number(n).toFixed(2) + ' USDT';          // saldos y precios de revendedores
const usd = n => 'US$ ' + Number(n).toFixed(2);             // saldo de Central One
const STATUS = { completed: 'Completada', failed: 'Fallida', pending: 'Enviando', processing: 'En proceso', unknown: 'Verificando' };
const REQ = { pending: 'Pendiente', approved: 'Aprobada', rejected: 'Rechazada' };
const tag = (s, map = STATUS) => el('span', { class: 'tag ' + s }, map[s] || s);
const card = (title, ...kids) => el('div', { class: 'card' }, title ? el('h2', {}, title) : null, ...kids);
const groupBy = (arr, f) => arr.reduce((m, x) => { const k = f(x); (m.get(k) || m.set(k, []).get(k)).push(x); return m; }, new Map());
let timer = null, flash = null;
/* 3 saldos separados: USDT, CUP transferencia y CUP saldo móvil. Cada uno se recarga y se gasta en su moneda. */
const CURS = ['usdt', 'transfer', 'mobile'];
const CUR_S = { usdt: 'USDT', transfer: 'CUP transf.', mobile: 'CUP saldo' };
const CUR_LONG = { usdt: 'USDT', transfer: 'CUP Transferencia', mobile: 'CUP Saldo móvil' };
const CUR_ICON = { usdt: '💲', transfer: '🏦', mobile: '📱' };
/** Monto con su moneda: USDT con 2 decimales, CUP en enteros. */
const money = (n, c = 'usdt') => (!c || c === 'usdt') ? Number(n).toFixed(2) + ' USDT' : Math.round(Number(n)).toLocaleString('es') + ' ' + CUR_S[c];
const priceIn = (p, c) => p.prices ? (p.prices[c] != null ? p.prices[c] : (c === 'usdt' ? p.price : null)) : (c === 'usdt' ? p.price : null);
let userQuery = '', ME = null, auditCat = 'all', auditQ = '', userFilter = 'all', fundSort = 'usdt', fundOnly = false;
let hsub = 'recargas', myOrdF = { status: '', q: '', from: '', to: '' }, myLedF = { status: '', method: '', q: '', from: '', to: '' };
let ordF = { status: '', q: '', from: '', to: '' }, reqF = { status: '', method: '', q: '', from: '', to: '' };
const qs = o => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
const hasF = F => Object.values(F).some(v => v);
/** Resume los límites de un sub-admin en las 3 monedas: "💲 50 USDT · 🏦 20.000 CUP transf. · 📱 10.000 CUP saldo". pre = 'max_' | 'max_adj_' | 'quota_' */
const limLine = (p, pre) => CURS.map(c => CUR_ICON[c] + ' ' + money(p[pre + c] || 0, c)).join(' · ');
let payCur = 'usdt'; try { payCur = localStorage.getItem('payCur') || 'usdt'; } catch {}
const METHOD_L = { usdt: 'USDT BEP20', transfer: 'Transferencia', mobile: 'Saldo móvil' };

const REG = { ID: 'Indonesia', BR: 'Brasil', EU: 'Europa', LATAM: 'Latinoamérica', US: 'Estados Unidos', NA: 'Norteamérica', SG: 'Singapur', MY: 'Malasia',
  TH: 'Tailandia', VN: 'Vietnam', PH: 'Filipinas', IN: 'India', MENA: 'Medio Oriente y Norte de África', ME: 'Medio Oriente', TW: 'Taiwán', KR: 'Corea',
  JP: 'Japón', RU: 'Rusia', TR: 'Turquía', SA: 'Arabia Saudita', GLOBAL: '' };
const regName = v => REG[String(v).toUpperCase()] ?? '';
const regLabel = v => regName(v) ? `${regName(v)} (${v})` : v;
const PTYPES = [['diamantes', 'Diamantes'], ['pases', 'Pases'], ['membresias', 'Membresías'], ['otros', 'Otros']];
/** Tipo de oferta por el nombre del paquete (el dueño puede corregirlo en Catálogo → "Tipo"). */
const autoType = n => {
  const t = shortName(n).toLowerCase();
  if (/membres|membership|suscrip|subscri|semanal|mensual|weekly|monthly|\bvip\b/.test(t)) return 'membresias';
  if (/\bpase|\bpass\b|booyah|level ?up|evo ?access|battle ?pass/.test(t)) return 'pases';
  if (/diamant|diamond|gema|\bgems?\b|cristal|crystal|\buc\b|\bcp\b|\bvp\b|moneda|coin|cr[eé]dito|credit|robux|\boro\b|gold|token|bono|bonus/.test(t)) return 'diamantes';
  return 'otros';
};
const typeOf = p => p.ptype || autoType(p.name);
const shortName = n => { const i = n.indexOf(' · '); return i > 0 ? n.slice(i + 3) : n; }; // "Free Fire (BR) · 100 Diamantes" -> "100 Diamantes"
const regionCard = (code, sub, onclick) => el('button', { class: 'reg', onclick },
  el('span', { class: 'code' }, code), el('span', { class: 'rn' }, regName(code) ? el('b', {}, regName(code)) : null, el('span', { class: 'mut' }, sub)),
  el('span', { class: 'chev' }, '›'));

/** Reduce la foto del comprobante (máx. 1280 px, JPEG) para que suba rápido aunque la conexión sea lenta. */
/** Reduce la foto del comprobante a JPEG (máx. ~1.7 MB). Prueba 3 formas de leerla para que funcione en cualquier móvil. */
async function shrinkImage(file) {
  if (!file) throw new Error('No elegiste ninguna imagen');
  if (file.type && !file.type.startsWith('image/')) throw new Error('El archivo no es una imagen');
  if (file.size > 25e6) throw new Error('La imagen pesa demasiado (máx. 25 MB)');
  const loadImg = src => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
  let src = null, url = null;
  try { if (window.createImageBitmap) src = await createImageBitmap(file); } catch {}
  if (!src) try { url = URL.createObjectURL(file); src = await loadImg(url); } catch { src = null; }
  if (!src) try {
    const data = await new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsDataURL(file); });
    src = await loadImg(data);
  } catch { src = null; }
  if (url) URL.revokeObjectURL(url);
  if (!src || !src.width) throw new Error('No se pudo leer la imagen. Haz una captura de pantalla del comprobante y súbela.');
  const c = document.createElement('canvas'), ctx = c.getContext('2d');
  for (const [side, q] of [[1400, 0.75], [1100, 0.65], [850, 0.6], [650, 0.55]]) {
    const k = Math.min(1, side / Math.max(src.width, src.height));
    c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); // fondo blanco para PNG transparentes
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const out = c.toDataURL('image/jpeg', q);
    if (out.startsWith('data:image/jpeg') && out.length < 1700000) { if (src.close) src.close(); return out; }
  }
  throw new Error('No se pudo comprimir la imagen. Prueba con una captura de pantalla.');
}

/** Selector de comprobante: botón grande, vista previa y "Quitar". get() devuelve la imagen lista o null. */
function proofPicker(onErr) {
  let image = null;
  const input = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  const label = el('span', {}, '📷 Adjuntar foto del comprobante');
  const pick = el('button', { type: 'button', class: 'sec', style: 'width:100%' }, label);
  const preview = el('div');
  pick.onclick = () => input.click();
  input.onchange = async () => {
    const f = input.files[0]; input.value = '';
    if (!f) return;
    pick.disabled = true; label.textContent = '⏳ Procesando imagen…';
    try {
      image = await shrinkImage(f);
      const rm = el('button', { type: 'button', class: 'red sm' }, '✕ Quitar');
      rm.onclick = () => { image = null; preview.replaceChildren(); label.textContent = '📷 Adjuntar foto del comprobante'; };
      preview.replaceChildren(el('img', { src: image, class: 'proof', alt: 'Comprobante' }), el('div', { class: 'acts' }, rm));
      label.textContent = '📷 Cambiar foto';
    } catch (e) { image = null; preview.replaceChildren(); label.textContent = '📷 Adjuntar foto del comprobante'; onErr(e.message); }
    pick.disabled = false;
  };
  return { node: el('div', { style: 'margin:8px 0' }, input, pick, preview), get: () => image, busy: () => pick.disabled };
}

/** Muestra los datos de pago del admin con un botón "Copiar" en cada línea que tenga números (tarjeta, teléfono…). */
function payInfo(text) {
  return el('div', { class: 'payinfo' }, ...String(text).split('\n').filter(l => l.trim()).map(line => {
    const digits = line.replace(/[^\d+]/g, '');
    if (digits.replace('+', '').length < 6) return el('div', { class: 'pl' }, el('span', {}, line));
    const val = (line.match(/[+\d][\d\s-]{4,}\d/) || [line])[0].replace(/[\s-]/g, '');
    const b = el('button', { type: 'button', class: 'sec sm' }, 'Copiar');
    b.onclick = async () => { try { await navigator.clipboard.writeText(val); b.textContent = '✓'; setTimeout(() => b.textContent = 'Copiar', 1500); } catch { prompt('Copia:', val); } };
    return el('div', { class: 'pl' }, el('span', { style: 'font-weight:700' }, line), b);
  }));
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
const lc = el('input', { id: 'lc', class: 'hidden', placeholder: 'Código de 6 dígitos (o de recuperación)', inputmode: 'numeric', autocomplete: 'one-time-code' });
$('lp').after(lc);
$('lb').onclick = async () => {
  try {
    const d = await api('POST', '/api/login', { username: $('lu').value, password: $('lp').value, code: lc.value });
    if (d.need_2fa) { lc.classList.remove('hidden'); lc.focus(); return msg($('lm'), 'Escribe el código de tu app de autenticación.', 'ok'); }
    $('lp').value = ''; lc.value = ''; lc.classList.add('hidden'); $('lm').replaceChildren(); boot();
  } catch (e) { msg($('lm'), e.message, 'err'); }
};
lc.addEventListener('keydown', e => e.key === 'Enter' && $('lb').click());
$('lp').addEventListener('keydown', e => e.key === 'Enter' && $('lb').click());
$('lu').placeholder = 'Correo o usuario';
// ¿Olvidaste tu contraseña? (revendedores: código por Telegram, o aviso al administrador)
{
  const fu = el('input', { placeholder: 'Tu correo o usuario', autocomplete: 'username' });
  const fc = el('input', { placeholder: 'Código de 6 dígitos', inputmode: 'numeric', autocomplete: 'one-time-code', class: 'hidden' });
  const f1 = el('input', { type: 'password', placeholder: 'Nueva contraseña (8 o más)', autocomplete: 'new-password', class: 'hidden' });
  const f2 = el('input', { type: 'password', placeholder: 'Repite la nueva contraseña', autocomplete: 'new-password', class: 'hidden' });
  const fm = el('div'), fb = el('button', {}, 'Enviarme el código');
  let step = 1;
  const form = el('div', { class: 'hidden', style: 'margin-top:14px;text-align:left' }, el('h2', {}, 'Recuperar contraseña'),
    el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Si tu cuenta tiene Telegram conectado, te mandamos un código por ahí. Si no, avisamos al administrador para que te la cambie.'), fu, fc, f1, f2, fb, fm);
  fb.onclick = async () => {
    fb.disabled = true;
    try {
      if (step === 1) {
        const d = await api('POST', '/api/forgot', { username: fu.value });
        msg(fm, d.message, 'ok'); step = 2; for (const x of [fc, f1, f2]) x.classList.remove('hidden'); fb.textContent = 'Cambiar contraseña';
      } else {
        if (f1.value !== f2.value) throw new Error('Las contraseñas no coinciden');
        await api('POST', '/api/reset-password', { username: fu.value, code: fc.value, password: f1.value });
        $('lu').value = fu.value; fc.value = f1.value = f2.value = ''; step = 1; for (const x of [fc, f1, f2]) x.classList.add('hidden'); fb.textContent = 'Enviarme el código';
        form.classList.add('hidden'); fm.replaceChildren(); msg($('lm'), 'Listo: ya puedes entrar con tu nueva contraseña.', 'ok'); $('lp').focus();
      }
    } catch (e) { msg(fm, e.message, 'err'); }
    fb.disabled = false;
  };
  $('login').append(el('button', { class: 'ghost', style: 'margin-top:12px', onclick: () => form.classList.toggle('hidden') }, '¿Olvidaste tu contraseña?'), form);
}
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
    ME = me;
    $('who').replaceChildren(el('span', {}, me.username + (me.role === 'subadmin' ? ' (sub-admin)' : '') + ' · '),
      el('a', { href: '#', onclick: async e => { e.preventDefault(); await api('POST', '/api/logout', {}); show('login'); } }, 'Salir'));
    show('app');
    me.role === 'admin' || me.role === 'subadmin' ? adminView() : resellerView();
  } catch { show('login'); }
}

/** true si el usuario está escribiendo o tiene un formulario a medias (para no refrescar y borrarle lo escrito). */
let lastTyping = 0;
document.addEventListener('input', () => { lastTyping = Date.now(); }, true);
function userBusy() {
  const a = document.activeElement;
  if (a && $('app').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
  if (Date.now() - lastTyping < 60000) return true;
  return [...$('app').querySelectorAll('input:not([type=file]),textarea')].some(i => i.value.trim()) || !!$('app').querySelector('img.proof:not([data-saved])') || !!document.querySelector('.zoom, .modal');
}

/** Tarjeta para cambiar la contraseña propia (revendedor, sub-admin o dueño). */
function passwordCard() {
  const cur = el('input', { type: 'password', placeholder: 'Contraseña actual', autocomplete: 'current-password' });
  const n1 = el('input', { type: 'password', placeholder: 'Nueva contraseña (8+)', autocomplete: 'new-password' });
  const n2 = el('input', { type: 'password', placeholder: 'Repite la nueva', autocomplete: 'new-password' });
  const box = el('div'), b = el('button', { class: 'sm' }, 'Cambiar contraseña');
  b.onclick = async () => {
    if (n1.value !== n2.value) return msg(box, 'Las contraseñas nuevas no coinciden.', 'err');
    b.disabled = true;
    try { await api('POST', '/api/change-password', { current: cur.value, password: n1.value }); cur.value = n1.value = n2.value = ''; msg(box, 'Contraseña cambiada.', 'ok'); }
    catch (e) { msg(box, e.message, 'err'); }
    b.disabled = false;
  };
  return card('Cambiar mi contraseña', el('div', { class: 'row' }, cur), el('div', { class: 'row' }, n1, n2), el('div', { class: 'acts' }, b), box);
}

/** Filtros de una lista: chips de estado (y de método), lupa y rango de fechas. reload() vuelve a pedir la lista al servidor. */
function filterBar(F, statuses, reload, methods) {
  const mkChips = (key, list) => {
    const w = el('div', { class: 'chips', style: 'margin-bottom:8px' });
    for (const [k, l] of list) w.append(el('button', { type: 'button', class: 'chip' + (F[key] === k ? ' on' : ''), onclick: ev => { F[key] = k; for (const c of w.children) c.classList.toggle('on', c === ev.currentTarget); reload(); } }, l));
    return w;
  };
  const si = el('input', { type: 'search', placeholder: 'Buscar nombre, #número, destino…', value: F.q, autocomplete: 'off', 'aria-label': 'Buscar' });
  let t; si.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { F.q = si.value; reload(); }, 400); });
  const d1 = el('input', { type: 'date', value: F.from, 'aria-label': 'Desde' }), d2 = el('input', { type: 'date', value: F.to, 'aria-label': 'Hasta' });
  d1.onchange = () => { F.from = d1.value; reload(); }; d2.onchange = () => { F.to = d2.value; reload(); };
  const clr = el('button', { type: 'button', class: 'ghost clr', title: 'Borrar', onclick: () => { si.value = ''; F.q = ''; reload(); si.focus(); } }, '✕');
  return el('div', {}, mkChips('status', statuses), methods ? mkChips('method', methods) : null,
    el('div', { class: 'search' }, el('span', { class: 'lupa', 'aria-hidden': 'true' }, '🔍'), si, clr),
    el('div', { class: 'row' }, el('label', { class: 'fld' }, 'Desde', d1), el('label', { class: 'fld' }, 'Hasta', d2)));
}

/** Verificación en dos pasos (app de autenticación). Solo dueño y sub-admins. */
function twoFaCard() {
  const box = el('div'), body = el('div');
  const showCodes = codes => {
    body.replaceChildren(el('div', { class: 'msg ok' }, '✓ Verificación en dos pasos activada.'),
      el('div', { class: 'mut', style: 'margin:8px 0' }, 'Guarda estos códigos de recuperación en un lugar seguro. Cada uno sirve una sola vez si pierdes tu celular y NO se vuelven a mostrar:'),
      el('div', { class: 'addr' }, codes.join('   ')),
      el('div', { class: 'acts' }, el('button', { class: 'sm', onclick: () => adminView() }, 'Ya los guardé')));
  };
  const draw = () => {
    body.replaceChildren();
    if (ME.totp) {
      const pw = el('input', { type: 'password', placeholder: 'Tu contraseña', autocomplete: 'current-password' });
      const cd = el('input', { placeholder: 'Código de tu app (o de recuperación)', inputmode: 'numeric', autocomplete: 'one-time-code' });
      const off = el('button', { class: 'red sm' }, 'Desactivar');
      off.onclick = async () => { off.disabled = true; try { await api('POST', '/api/2fa/disable', { password: pw.value, code: cd.value }); ME.totp = false; draw(); } catch (e) { msg(box, e.message, 'err'); off.disabled = false; } };
      put(body, el('div', { class: 'msg ok' }, '✓ Activada. Al entrar te pediremos el código de tu app.'),
        el('details', { class: 'regd' }, el('summary', {}, el('b', {}, 'Desactivar'), el('span', { class: 'chev', style: 'margin-left:auto' }, '›')),
          el('div', { class: 'row' }, pw), el('div', { class: 'row' }, cd), el('div', { class: 'acts', style: 'margin-bottom:10px' }, off)));
    } else {
      const on = el('button', { class: 'sm' }, 'Activar verificación en dos pasos');
      on.onclick = async () => {
        on.disabled = true;
        try {
          const d = await api('POST', '/api/2fa/start', {});
          const cd = el('input', { placeholder: 'Código de 6 dígitos', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '8' });
          const ok = el('button', { class: 'sm' }, 'Confirmar y activar');
          ok.onclick = async () => { ok.disabled = true; try { const r = await api('POST', '/api/2fa/confirm', { code: cd.value }); ME.totp = true; ME.must_2fa = false; showCodes(r.recovery); } catch (e) { msg(box, e.message, 'err'); ok.disabled = false; } };
          body.replaceChildren(el('div', { class: 'mut' }, '1) En Google Authenticator, Authy o similar agrega una cuenta con esta clave (o toca el enlace si estás en el celular):'),
            el('div', { class: 'addr' }, d.secret.match(/.{1,4}/g).join(' ')), el('a', { href: d.uri }, 'Abrir en mi app de autenticación'),
            el('div', { class: 'mut', style: 'margin-top:10px' }, '2) Escribe el código de 6 dígitos que te muestre:'), el('div', { class: 'row' }, cd), el('div', { class: 'acts' }, ok));
        } catch (e) { msg(box, e.message, 'err'); on.disabled = false; }
      };
      put(body, el('div', { class: 'mut' }, 'Protege tu cuenta con un código de tu celular además de la contraseña. Muy recomendado: por aquí se mueve el dinero.'), el('div', { class: 'acts' }, on));
    }
  };
  draw();
  return card('Verificación en dos pasos (2FA)', body, box);
}
function sessionsCard() {
  return card('Sesiones', el('div', { class: 'mut' }, 'Si perdiste un teléfono o crees que alguien entró, cierra tu sesión en todos los dispositivos (también en este).'),
    el('div', { class: 'acts' }, el('button', { class: 'red sm', onclick: async () => { if (!confirm('¿Cerrar la sesión en todos tus dispositivos?')) return; try { await api('POST', '/api/logout-all', {}); } catch {} show('login'); } }, 'Cerrar todas las sesiones')));
}
const accountCards = staff => [passwordCard(), staff ? twoFaCard() : null, sessionsCard()];

/* =================== COMPROBANTE + EFECTO DE ÉXITO (sin precio) =================== */
const fmtDur = ms => { const t = Math.max(0, Math.round(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = t % 60;
  return h ? `${h} h ${m} min` : m ? `${m} min ${sec} s` : `${sec} s`; };
const fmtWhen = ts => new Date(ts).toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const loadImg = src => new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
/** Dibuja el comprobante en un canvas. NUNCA incluye el precio ni el saldo usado. */
async function receiptBlob(o) {
  const W = 720, H = 1040, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), F = 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#1a0f05'); bg.addColorStop(1, '#0b0b0d'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, 250, 10, W / 2, 250, 420); glow.addColorStop(0, 'rgba(34,197,94,.28)'); glow.addColorStop(1, 'rgba(34,197,94,0)'); g.fillStyle = glow; g.fillRect(0, 0, W, H);
  g.textAlign = 'center';
  const logo = await loadImg('logo.jpg');
  if (logo) { g.save(); g.beginPath(); g.arc(W / 2, 90, 44, 0, 7); g.clip(); g.drawImage(logo, W / 2 - 44, 46, 88, 88); g.restore(); }
  g.fillStyle = '#f4f4f5'; g.font = `800 28px ${F}`; g.fillText('SHOP FAST', W / 2, 168);
  // círculo de éxito
  g.beginPath(); g.arc(W / 2, 270, 52, 0, 7); g.fillStyle = '#22c55e'; g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 12; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(W / 2 - 22, 272); g.lineTo(W / 2 - 5, 290); g.lineTo(W / 2 + 26, 252); g.stroke();
  g.fillStyle = '#86efac'; g.font = `800 38px ${F}`; g.fillText('¡Recarga realizada con éxito!', W / 2, 372);
  // paquete (diamantes)
  const fit = (t, max, size, w = 800) => { let z = size; do { g.font = `${w} ${z}px ${F}`; z -= 2; } while (g.measureText(t).width > max && z > 14); };
  g.fillStyle = '#ff7a00'; fit('💎 ' + o.product_name, 640, 40); g.fillText('💎 ' + o.product_name, W / 2, 440);
  // tarjeta con datos
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  rr(40, 480, W - 80, 380, 24); g.fillStyle = '#16161a'; g.fill(); g.strokeStyle = '#2a2a31'; g.lineWidth = 2; g.stroke();
  const rows = [['ID del jugador', o.target], ['Nombre de la cuenta', o.player_name || 'No disponible'], ['Tiempo en completarse', o.done_ts && o.created_ts ? fmtDur(o.done_ts - o.created_ts) : '—'], ['Fecha', o.done_ts ? fmtWhen(o.done_ts) : o.created_at]];
  rows.forEach(([k, v], i) => {
    const y = 520 + i * 90;
    g.fillStyle = '#a1a1aa'; g.font = `600 22px ${F}`; g.fillText(k, W / 2, y + 22);
    g.fillStyle = '#f4f4f5'; fit(String(v), 600, 34, 700); g.fillText(String(v), W / 2, y + 62);
    if (i < rows.length - 1) { g.fillStyle = '#2a2a31'; g.fillRect(90, y + 76, W - 180, 2); }
  });
  g.fillStyle = '#a1a1aa'; g.font = `500 22px ${F}`; g.fillText(`Pedido #${o.id}`, W / 2, 920);
  g.fillStyle = '#ff7a00'; g.font = `700 24px ${F}`; g.fillText('Gracias por tu compra 🔥', W / 2, 980);
  return new Promise(ok => cv.toBlob(ok, 'image/png'));
}
async function shareReceipt(o, btn) {
  const old = btn && btn.textContent; if (btn) { btn.disabled = true; btn.textContent = 'Generando…'; }
  try {
    const blob = await receiptBlob(o), file = new File([blob], `recarga-${o.id}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Recarga realizada con éxito' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: file.name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } finally { if (btn) { btn.disabled = false; btn.textContent = old; } }
}
/** Pantalla de celebración: confeti + vista previa del comprobante con botón de compartir. */
async function celebrate(o) {
  if (document.getElementById('cele')) return;
  const blob = await receiptBlob(o), url = URL.createObjectURL(blob);
  const close = () => { ov.remove(); URL.revokeObjectURL(url); };
  const ov = el('div', { id: 'cele', class: 'cele', onclick: e => { if (e.target === ov) close(); } },
    el('div', { class: 'cele-box' }, el('div', { class: 'cele-t' }, '🎉 ¡Recarga realizada con éxito!'), el('img', { src: url, alt: 'Comprobante' }),
      el('div', { class: 'row', style: 'margin-top:12px' }, el('button', { onclick: e => shareReceipt(o, e.target) }, '📤 Compartir / Guardar'), el('button', { class: 'ghost', onclick: close }, 'Cerrar'))));
  const cols = ['#ff7a00', '#22c55e', '#facc15', '#38bdf8', '#f472b6'];
  for (let i = 0; i < 46; i++) ov.append(el('i', { class: 'conf', style: `left:${Math.random() * 100}%;background:${cols[i % 5]};animation-delay:${(Math.random() * 0.8).toFixed(2)}s;animation-duration:${(2 + Math.random() * 1.8).toFixed(2)}s;transform:rotate(${Math.floor(Math.random() * 360)}deg)` }));
  document.body.append(ov);
  try { navigator.vibrate && navigator.vibrate([80, 40, 120]); } catch {}
}
document.head.append(Object.assign(document.createElement('style'), { textContent: '.cele{position:fixed;inset:0;z-index:99;background:#000c;display:flex;align-items:center;justify-content:center;padding:14px;overflow:hidden;animation:rise .25s ease both}.cele-box{position:relative;z-index:2;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px;max-width:420px;width:100%;max-height:96vh;overflow:auto;text-align:center;animation:pop .45s cubic-bezier(.2,1.4,.4,1) both}.cele-t{font-weight:800;font-size:1.1rem;margin-bottom:10px;color:#86efac}.cele-box img{width:100%;border-radius:12px;display:block}.conf{position:absolute;top:-20px;width:9px;height:16px;border-radius:2px;z-index:1;animation:fall linear forwards}@keyframes fall{to{top:105%;opacity:.8}}@keyframes pop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}' }));
const seenActive = new Set();
function checkNewlyCompleted(orders) {
  const first = !seenActive.size && !checkNewlyCompleted.init; checkNewlyCompleted.init = true;
  let hit = null;
  for (const o of orders) {
    if (['pending', 'processing', 'unknown'].includes(o.status)) seenActive.add(o.id);
    else if (o.status === 'completed' && seenActive.has(o.id)) { seenActive.delete(o.id); if (!first) hit = hit || o; }
  }
  if (hit) celebrate(hit).catch(() => {});
}

/* =================== REVENDEDOR =================== */
const pick = { family: null, variant: null, product: null, fill: null };
let scrollTo3 = false, rtab = 'recargar';
async function resellerView() {
  clearTimeout(timer);
  const [me, products, orders, led, reqs, extra, dep] = await Promise.all([api('GET', '/api/me'), api('GET', '/api/products'), api('GET', '/api/orders'),
    api('GET', '/api/ledger'), api('GET', '/api/topup-requests'), api('GET', '/api/me-extra'), api('GET', '/api/deposit-info')]);
  const bal = me.balances || { usdt: me.balance, transfer: 0, mobile: 0 };
  checkNewlyCompleted(orders);
  const out = $('app'); out.replaceChildren();
  const byId = new Map(products.map(p => [p.id, p]));
  const fams = groupBy(products, p => p.family);
  if (!fams.has(pick.family)) pick.family = fams.keys().next().value || null;
  const box = el('div'), vbox = el('div');
  if (flash) { msg(box, flash[0], flash[1]); flash = null; }

  const buy = el('div');
  const renderBuy = () => {
    buy.replaceChildren();
    if (!products.length) return put(buy, el('div', { class: 'mut' }, 'Aún no hay productos disponibles. Pídele al administrador que active juegos.'));
    // Tipo de pago: cada uno es independiente (solo se ven los precios de ese saldo)
    const curOk = CURS.filter(c => products.some(p => priceIn(p, c) != null));
    if (!curOk.includes(payCur)) payCur = curOk[0] || 'usdt';
    const vis = products.filter(p => priceIn(p, payCur) != null);
    const fams = groupBy(vis, p => p.family);
    if (!fams.has(pick.family)) { pick.family = fams.keys().next().value || null; pick.variant = null; pick.product = null; }
    put(buy, el('h3', { style: 'margin-top:0' }, 'Pagar con'),
      el('div', { class: 'seg' }, ...curOk.map(c => el('button', { type: 'button', class: c === payCur ? 'on' : '',
        onclick: () => { payCur = c; try { localStorage.setItem('payCur', c); } catch {} pick.product = null; renderBuy(); } },
        el('span', { class: 'si' }, CUR_ICON[c]), el('span', { class: 'sl' }, CUR_LONG[c]), el('small', {}, money(bal[c], c))))));
    put(buy, el('h3', {}, '1. Elige el juego'),
      el('div', { class: 'chips' }, ...[...fams.keys()].map(f => el('button', { class: 'chip' + (f === pick.family ? ' on' : ''), onclick: () => { pick.family = f; pick.variant = null; pick.product = null; renderBuy(); } }, f))));
    const vars = groupBy(fams.get(pick.family) || [], p => p.variant);
    if (pick.variant && !vars.has(pick.variant)) pick.variant = null;
    if (vars.size === 1) pick.variant = vars.keys().next().value;
    if (vars.size > 1 && !pick.variant) {
      put(buy, el('h3', {}, '2. ¿Qué región?'),
        el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Elige la región de la cuenta del jugador: cada paquete solo sirve en cuentas de su región o servidor.'),
        ...[...vars].sort((x, y) => y[1].length - x[1].length).map(([v, ps]) => regionCard(v, `${ps.length} opciones`, () => { pick.variant = v; pick.product = null; renderBuy(); })));
      return;
    }
    if (vars.size > 1) put(buy, el('div', { class: 'row', style: 'margin-top:10px;align-items:center' },
      el('span', { class: 'code' }, pick.variant), el('b', {}, regName(pick.variant) || pick.variant),
      el('button', { class: 'ghost', onclick: () => { pick.variant = null; pick.product = null; renderBuy(); } }, '← Cambiar región')));
    const all = (vars.get(pick.variant) || []).slice().sort((a, b) => priceIn(a, payCur) - priceIn(b, payCur));
    const byType = groupBy(all, typeOf), types = PTYPES.filter(([k]) => byType.has(k));
    if (!types.some(([k]) => k === pick.ptype)) pick.ptype = types.length ? types[0][0] : null;
    const list = byType.get(pick.ptype) || [];
    if (!list.some(p => p.id === pick.product)) pick.product = null;
    const n = vars.size > 1 ? 3 : 2;
    put(buy, el('h3', {}, n + '. Elige el paquete'),
      types.length > 1 ? el('div', { class: 'chips', style: 'margin-bottom:10px' }, ...types.map(([k, l]) => el('button', { class: 'chip' + (k === pick.ptype ? ' on' : ''), onclick: () => { pick.ptype = k; pick.product = null; renderBuy(); } }, `${l} (${byType.get(k).length})`))) : null,
      el('div', { class: 'grid' }, ...list.map(p => el('button', { class: 'pkg' + (p.id === pick.product ? ' on' : ''), onclick: () => { pick.product = p.id; scrollTo3 = true; renderBuy(); } },
        shortName(p.name), el('b', {}, money(priceIn(p, payCur), payCur))))));
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
    // El saldo con el que paga es el tipo de pago elegido arriba (independiente de los demás)
    const priceOf = c => priceIn(p, c);
    const btn = el('button', { class: 'big' });
    const payBox = el('div');
    const renderPay = () => {
      const pr = priceOf(payCur), enough = bal[payCur] >= pr;
      btn.textContent = `Enviar · ${money(pr, payCur)}`;
      payBox.replaceChildren(); put(payBox, el('div', { class: 'paysum' + (enough ? '' : ' low') },
        el('span', {}, CUR_ICON[payCur] + ' Tu saldo disponible'), el('b', {}, money(bal[payCur], payCur))),
        enough ? null : el('div', { class: 'msg err', style: 'margin:8px 0 0' }, `No te alcanza el saldo ${CUR_LONG[payCur]}. Cambia el tipo de pago arriba o pide saldo.`));
    };
    renderPay();
    btn.onclick = async () => {
      const t = target();
      const empty = p.fields.find(f => !String(t[f.key] || '').trim());
      if (empty) { msg(vbox, `Falta: ${empty.label}`, 'err'); inputs[empty.key].focus(); return; }
      for (const k of Object.keys(t)) t[k] = String(t[k]).trim();
      if (bal[payCur] < priceOf(payCur)) { msg(vbox, `Saldo ${CUR_LONG[payCur]} insuficiente. Elige otro saldo o pide saldo.`, 'err'); return; }
      if (!confirm(`¿Enviar ${p.name}\na ${Object.values(t).join(' · ')}\n\nSe pagará con saldo ${CUR_LONG[payCur]}: ${money(priceOf(payCur), payCur)}?`)) return;
      btn.disabled = true;
      try {
        const d = await api('POST', '/api/orders', { product_id: p.id, target: t, currency: payCur });
        flash = d.status === 'unknown' ? [d.message, 'warn'] : ['Recarga enviada. Se está procesando; el estado se actualiza solo.', 'ok'];
        pick.product = null;
      } catch (e) { flash = [e.message, 'err']; }
      resellerView();
    };
    const step3 = el('h3', {}, (n + 1) + '. Datos del jugador · ' + shortName(p.name));
    put(buy, step3,
      recent.length ? el('div', { class: 'recents' }, el('span', { class: 'mut', style: 'align-self:center' }, 'Recientes:'),
        ...recent.map(t => el('button', { class: 'chip', onclick: () => fillWith(t) }, Object.values(t).join(' · ')))) : null,
      el('div', { class: 'row' }, ...fields), payBox, el('div', { class: 'row' }, vbtn, btn), vbox);
    if (scrollTo3) { scrollTo3 = false; setTimeout(() => { step3.scrollIntoView({ behavior: 'smooth', block: 'start' }); if (!recent.length && fields[0]) fields[0].focus(); }, 50); }
  };

  // "Repetir": vuelve a elegir el mismo paquete con los mismos datos
  const repeat = o => {
    const p = byId.get(o.product_id);
    if (!p) return alert('Ese paquete ya no está disponible.');
    Object.assign(pick, { family: p.family, variant: p.variant, product: p.id, fill: o.target_payload });
    rtab = 'recargar'; scrollTo3 = true; resellerView();
  };

  // --- "Pedir saldo": 3 métodos (USDT BEP20 / Transferencia / Saldo móvil). Solo se muestran los que el admin configuró. ---
  const methods = [['usdt', '💲 USDT', !!dep.wallet], ['transfer', '🏦 Transferencia', !!dep.payment_transfer], ['mobile', '📱 Saldo móvil', !!dep.payment_mobile]].filter(m => m[2]);
  const susp = dep.suspended || {};
  let depMethod = 'usdt'; try { depMethod = sessionStorage.getItem('depM') || 'usdt'; } catch {}
  if (!methods.some(m => m[0] === depMethod)) depMethod = methods.length ? methods[0][0] : null;
  /** Construye el formulario de depósito según el método elegido. */
  function depositForm(method) {
    const reqBox = el('div');
    const proof = proofPicker(m => msg(reqBox, m, 'err'));
    const note = el('input', { placeholder: 'Nota (opcional)', maxlength: '300' });
    const submit = async (btn, body, waitText) => {
      if (proof.busy()) return msg(reqBox, 'Espera a que termine de procesarse la foto.', 'warn');
      btn.disabled = true; msg(reqBox, waitText, 'warn');
      try {
        const d = await api('POST', '/api/topup-requests', { ...body, note: note.value.trim(), image: proof.get() });
        flash = [d.message, d.auto === 'wait' ? 'warn' : 'ok']; rtab = 'saldo'; window.scrollTo(0, 0); resellerView(); return;
      } catch (e) { msg(reqBox, e.message, 'err'); }
      btn.disabled = false;
    };

    if (method === 'usdt') {
      const hash = el('input', { placeholder: 'Hash de la transacción (0x…)', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
      const amount = el('input', { type: 'number', inputmode: 'decimal', min: '0.01', step: '0.01', placeholder: 'Monto enviado en USDT (desde 0.01)' });
      const sendBtn = el('button', { class: 'big' }, 'Enviar solicitud');
      sendBtn.onclick = () => {
        const h = hash.value.trim().replace(/\s+/g, '');
        if (!h && !amount.value) return msg(reqBox, 'Pega el hash del envío, o abre "¿No tienes el hash?" e indica el monto.', 'err');
        const av = Number(String(amount.value).replace(',', '.'));
        if (amount.value && !(av >= 0.01)) return msg(reqBox, 'El monto debe ser de 0.01 USDT o más.', 'err');
        if (h && !/^0x[0-9a-fA-F]{64}$/.test(h)) return msg(reqBox, 'El hash no es válido: empieza por 0x y tiene 66 caracteres. Cópialo completo desde tu billetera.', 'err');
        submit(sendBtn, { method: 'usdt', tx_hash: h, amount: amount.value.replace(',', '.') }, h ? 'Verificando el pago…' : 'Enviando…');
      };
      const copyBtn = el('button', { class: 'sec sm' }, 'Copiar dirección');
      copyBtn.onclick = async () => { try { await navigator.clipboard.writeText(dep.wallet); copyBtn.textContent = '✓ Copiada'; } catch { prompt('Copia:', dep.wallet); } };
      const manual = el('details', { class: 'regd' }, el('summary', {}, el('span', { class: 'mut' }, '¿No tienes el hash? Revisión manual ›')),
        el('div', { class: 'mut', style: 'margin:8px 0' }, 'Indica el monto y adjunta una captura del envío. El admin lo revisará.'),
        el('div', { class: 'row' }, amount));
      return el('div', {},
        card('1. Envía USDT a esta billetera',
          el('div', { class: 'msg err', style: 'margin:0 0 10px' }, '⚠ Solo USDT por la red BSC (BEP20). Si envías por otra red el dinero se pierde.'),
          el('div', { class: 'addr' }, dep.wallet), el('div', { class: 'acts' }, copyBtn),
          el('div', { class: 'mut', style: 'margin-top:8px' }, 'Puedes enviar cualquier monto (desde 0.01 USDT). Se abona a tu saldo USDT lo que llegue.'),
          // Si ya tiene una billetera registrada, el pago se acredita solo, sin hash ni comprobante
          dep.autoscan && (dep.my_wallets || []).length ? el('div', { class: 'msg ok', style: 'margin:10px 0 0' }, el('b', {}, '⚡ Abono automático activo. '),
            `Todo lo que envíes desde ${dep.my_wallets.map(a => a.slice(0, 6) + '…' + a.slice(-4)).join(' o ')} se abona solo en 1-2 minutos. No tienes que pegar el hash ni enviar nada. `, el('span', { class: 'mut' }, 'Si pagas desde otra billetera, usa el paso 2.')) : null),
        card('2. Pega el hash del envío', el('div', { class: 'mut', style: 'margin-bottom:8px' },
          dep.auto ? 'Se comprueba en la blockchain y se te abona solo, normalmente en menos de un minuto.' : 'El admin revisará el pago y te abonará el saldo.'),
          el('div', { class: 'row' }, hash), manual, el('div', { class: 'row', style: 'margin-top:8px' }, note), proof.node,
          el('div', { class: 'acts' }, sendBtn), reqBox));
    }

    // Transferencia bancaria o Saldo móvil (siempre revisión manual del admin)
    const info = method === 'transfer' ? dep.payment_transfer : dep.payment_mobile;
    const label = method === 'transfer' ? 'transferencia' : 'saldo móvil';
    const cupAmt = el('input', { type: 'number', inputmode: 'numeric', min: '1', step: '1', placeholder: 'Monto enviado en CUP' });
    const equiv = el('div', { class: 'mut', style: 'margin:-2px 0 8px;font-weight:700;color:var(--ok)' });
    cupAmt.oninput = () => {
      const v = Math.floor(Number(cupAmt.value));
      equiv.textContent = v > 0 ? `Se abonarán ${v.toLocaleString('es')} CUP a tu saldo ${CUR_LONG[method]}` : '';
    };
    const sendBtn = el('button', { class: 'big' }, 'Enviar solicitud');
    sendBtn.onclick = () => {
      const v = Number(String(cupAmt.value).replace(',', '.'));
      if (!(v > 0)) return msg(reqBox, 'Escribe cuántos CUP enviaste.', 'err');
      if (!Number.isInteger(v)) return msg(reqBox, 'El monto en CUP debe ser un número entero (sin decimales).', 'err');
      if (!proof.get()) return msg(reqBox, 'Adjunta la foto o captura del comprobante para que el admin pueda confirmar el pago.', 'err');
      submit(sendBtn, { method, amount_cup: String(v) }, 'Enviando… (subiendo la foto)');
    };
    return el('div', {},
      card(`1. Envía por ${label} a:`, payInfo(info)),
      card('2. Avisa que ya pagaste',
        el('ol', { class: 'steps' }, el('li', {}, 'Escribe cuántos CUP enviaste.'), el('li', {}, 'Adjunta la captura o foto del comprobante.'), el('li', {}, `El admin lo confirma y se te abona en tu saldo ${CUR_LONG[method]}.`)),
        el('div', { class: 'row' }, cupAmt), equiv, el('div', { class: 'row' }, note), proof.node,
        el('div', { class: 'acts' }, sendBtn), reqBox));
  }

  const tabs = [['recargar', 'Recargar'], ['historial', 'Mis recargas'], ['saldo', 'Pedir saldo' + (reqs.some(r => r.status === 'pending') ? ' •' : '')], ['cuenta', 'Cuenta']];
  put(out, 
    me.maintenance ? el('div', { class: 'msg err', style: 'margin:0 0 12px;white-space:pre-wrap' }, '🛠 ' + me.maintenance.msg) : null,
    me.announcement ? el('div', { class: 'msg warn', style: 'margin:0 0 12px;white-space:pre-wrap' }, '📢 ' + me.announcement) : null,
    el('div', { class: 'card hero' }, el('div', { class: 'mut' }, 'Mis saldos'),
      el('div', { class: 'bals' }, ...CURS.map(c => el('div', {}, el('span', {}, CUR_ICON[c] + ' ' + CUR_LONG[c]),
        el('b', {}, c === 'usdt' ? Number(bal[c]).toFixed(2) : Math.round(bal[c]).toLocaleString('es'), el('small', {}, c === 'usdt' ? ' USDT' : ' CUP'))))),
      el('div', { class: 'acts' }, el('button', { class: 'sec sm', onclick: () => { rtab = 'saldo'; resellerView(); } }, '+ Pedir saldo'))),
    el('div', { class: 'tabs' }, ...tabs.map(([k, l]) => el('button', { class: k === rtab ? 'on' : '', onclick: () => { rtab = k; resellerView(); } }, l))));

  if (rtab === 'recargar' && me.maintenance) put(out, card('Recargas en pausa', el('div', { class: 'mut' }, 'Mientras dure el mantenimiento no se pueden enviar recargas. Tus saldos están seguros y puedes seguir pidiendo saldo.')));
  else if (rtab === 'recargar') {
    renderBuy();
    put(out, card('Nueva recarga', buy, box, el('div', { class: 'mut', style: 'margin-top:10px' }, 'Una recarga puede tardar desde minutos hasta un par de horas. No la repitas mientras esté "En proceso": podría llegar dos veces.')));
  }
  if (rtab === 'historial') {
    const isO = hsub === 'recargas', F = isO ? myOrdF : myLedF, base = isO ? '/api/orders' : '/api/ledger';
    const LT = { topup: 'Recarga de saldo', adjust: 'Ajuste', order: 'Compra', refund: 'Reembolso' };
    const listBox = el('div'), cnt = el('div', { class: 'mut', style: 'margin:6px 0' });
    const csv = el('a', { href: base + '.csv?' + qs(F), download: '' }, el('button', { class: 'sec sm' }, '⬇ Descargar CSV'));
    const rowO = o => el('div', {},
      el('div', { class: 'l' }, el('div', {}, o.product_name), el('div', { class: 'mut' }, `#${o.id} · ${o.target} · ${o.created_at}`), o.reason ? el('div', { class: 'mut' }, o.reason) : null,
        el('div', { class: 'acts', style: 'gap:6px' },
          o.status === 'completed' ? el('button', { class: 'sec sm', onclick: e => shareReceipt(o, e.target) }, '🧾 Comprobante') : null,
          byId.has(o.product_id) && ['completed', 'failed'].includes(o.status) ? el('button', { class: 'ghost', onclick: () => repeat(o) }, '↻ Repetir') : null)),
      el('div', { class: 'r' }, el('div', {}, money(o.price, o.currency)), tag(o.status)));
    const rowL = l => el('div', {},
      el('div', { class: 'l' }, el('div', {}, LT[l.type] || l.type), el('div', { class: 'mut' }, (l.note || '') + ' · ' + l.created_at)),
      el('div', { class: 'r', style: 'font-weight:700;color:' + (l.amount < 0 ? 'var(--err)' : 'var(--ok)') }, (l.amount > 0 ? '+' : '') + money(l.amount, l.currency)));
    const draw = list => {
      cnt.textContent = `${list.length} ${isO ? 'recarga' : 'movimiento'}${list.length === 1 ? '' : 's'}` + (list.length >= 100 ? ' (los más recientes: afina el filtro para ver otros)' : '');
      listBox.replaceChildren(list.length ? el('div', { class: 'list' }, ...list.map(isO ? rowO : rowL)) : el('div', { class: 'mut' }, hasF(F) ? 'Nada coincide con ese filtro.' : (isO ? 'Todavía no has hecho recargas.' : 'Sin movimientos.')));
      csv.href = base + '.csv?' + qs(F);
    };
    const reload = async () => { listBox.replaceChildren(el('div', { class: 'mut' }, 'Buscando…')); try { draw(await api('GET', base + '?' + qs({ ...F, limit: 100 }))); } catch (e) { msg(listBox, e.message, 'err'); } };
    put(out, box,
      el('div', { class: 'chips', style: 'margin-bottom:12px' }, ...[['recargas', 'Mis recargas'], ['mov', 'Movimientos de saldo']].map(([k, l]) => el('button', { class: 'chip' + (hsub === k ? ' on' : ''), onclick: () => { hsub = k; resellerView(); } }, l))),
      card(isO ? 'Mis recargas' : 'Movimientos de saldo',
        filterBar(F, isO ? [['', 'Todas'], ['completed', 'Completadas'], ['active', 'En proceso'], ['unknown', 'Verificando'], ['failed', 'Fallidas']]
          : [['', 'Todos'], ['topup', 'Recargas de saldo'], ['order', 'Compras'], ['refund', 'Reembolsos'], ['adjust', 'Ajustes']], reload, isO ? null : [['', 'Todas las monedas'], ['usdt', 'USDT'], ['transfer', 'CUP transf.'], ['mobile', 'CUP saldo']]),
        cnt, listBox, el('div', { class: 'acts' }, csv)));
    if (hasF(F)) reload(); else draw(isO ? orders : led);
  }
  if (rtab === 'saldo') {
    // Sub-pestañas: 3 métodos de depósito
    put(out, box,
      methods.length > 1 ? el('div', { class: 'chips', style: 'margin-bottom:12px' }, ...methods.map(([k, l]) =>
        el('button', { class: 'chip' + (depMethod === k ? ' on' : ''), onclick: () => { depMethod = k; try { sessionStorage.setItem('depM', k); } catch {} resellerView(); } }, l + (susp[k] ? ' ⏸' : '')))) : null,
      methods.length ? (susp[depMethod] ? card('Pagos en pausa', el('div', { class: 'msg warn' }, 'Los pagos por ' + METHOD_L[depMethod] + ' están suspendidos por ahora. Usa otro método o inténtalo más tarde.')) : depositForm(depMethod)) : card('Pedir saldo', el('div', { class: 'mut' }, 'El administrador todavía no configuró ninguna forma de pago. Escríbele para recargar saldo.')),
      card('Mis solicitudes', reqs.length ? el('div', { class: 'list' }, ...reqs.map(r => el('div', {},
        el('div', { class: 'l' }, el('div', {}, `#${r.id} · ${METHOD_L[r.method] || 'USDT'}`),
          el('div', { class: 'mut' }, r.created_at + (r.tx_hash ? ' · ' + r.tx_hash.slice(0, 10) + '…' : '') + (r.note ? ' · ' + r.note : '')),
          r.status === 'pending' && r.verify === 'wait' ? el('div', { class: 'mut' }, '⏳ ' + (r.verify_msg || 'Confirmando en BSC…')) : null,
          r.status === 'pending' && r.verify !== 'wait' ? el('div', { class: 'mut' }, 'En revisión por el administrador') : null,
          r.admin_note ? el('div', { class: 'mut' }, r.admin_note) : null),
        el('div', { class: 'r' }, el('div', {}, (r.approved ?? r.chain_amount ?? r.amount) == null ? '—' : money(r.approved ?? r.chain_amount ?? r.amount, r.currency)), tag(r.status, REQ))))) : el('div', { class: 'mut' }, 'No has pedido saldo todavía.')));
  }
  if (rtab === 'cuenta') {
    put(out, card('Mi cuenta', el('div', {}, 'Usuario: ', el('b', {}, me.username))), telegramCard(extra, resellerView) || card('Avisos por Telegram', el('div', { class: 'mut' }, 'El administrador todavía no activó los avisos por Telegram.')), ...accountCards(false));
  }
  // Refresco automático mientras haya algo en curso, pero sin borrar lo que el revendedor está escribiendo
  if (orders.some(o => ['pending', 'processing', 'unknown'].includes(o.status)) || reqs.some(r => r.status === 'pending')) {
    const tick = () => { if (userBusy()) timer = setTimeout(tick, 10000); else resellerView().catch(() => { timer = setTimeout(tick, 20000); }); };
    timer = setTimeout(tick, rtab === 'saldo' ? 15000 : 10000);
  }
}

/* =================== ADMIN =================== */
let tab = 'resumen', catQuery = '', period = 'day';
async function adminView() {
  clearTimeout(timer);
  const out = $('app');
  const OWN = ME.role === 'admin', can = k => OWN || !!(ME.perms && ME.perms[k]), none = v => Promise.resolve(v);
  if (ME.role === 'subadmin' && ME.must_2fa) {
    out.replaceChildren();
    return put(out, el('div', { class: 'msg err', style: 'margin-bottom:12px' }, 'El dueño exige verificación en dos pasos. Actívala aquí para poder trabajar.'), twoFaCard());
  }
  const [users, orders, prods, st, reqs] = await Promise.all([can('revendedores') ? api('GET', '/api/admin/users') : none([]), can('pedidos') ? api('GET', '/api/admin/orders') : none([]),
    OWN ? api('GET', '/api/admin/products') : none([]), OWN ? api('GET', '/api/admin/status') : none({ settings: {} }), can('saldo') ? api('GET', '/api/admin/topup-requests') : none([])]);
  const cat = tab === 'catalogo' ? await api('GET', '/api/admin/catalog?q=' + encodeURIComponent(catQuery)) : [];
  const rep = tab === 'reportes' ? await api('GET', '/api/admin/report?period=' + period) : null;
  out.replaceChildren();
  const note = el('div');
  /** Ventana para agregar o quitar saldo a mano. El sub-admin ve cuánto cupo le queda antes de confirmar. */
  const adjust = (r, c0 = 'usdt') => new Promise((resolve, reject) => {
    let cur = c0, sign = 1;
    const bal = c => ((r.balances || { usdt: r.balance })[c] || 0);
    const amt = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', placeholder: 'Monto', 'aria-label': 'Monto' });
    const why = el('input', { placeholder: OWN ? 'Motivo (opcional)' : 'Motivo (obligatorio, queda en el registro)', maxlength: '200', 'aria-label': 'Motivo' });
    const err = el('div'), info = el('div', { class: 'mut' }), prev = el('div', { class: 'paysum' });
    const chipsBox = el('div', { class: 'chips' }), pm = el('div', { class: 'pm' });
    const close = () => ov.remove();
    const cancel = () => { close(); reject(new Error('Cancelado')); };
    const draw = () => {
      chipsBox.replaceChildren(...CURS.map(k => el('button', { type: 'button', class: 'chip' + (k === cur ? ' on' : ''), onclick: () => { cur = k; draw(); } }, CUR_ICON[k] + ' ' + CUR_S[k])));
      pm.replaceChildren(el('button', { type: 'button', class: 'plus' + (sign > 0 ? ' on' : ''), onclick: () => { sign = 1; draw(); } }, '＋ Agregar'), el('button', { type: 'button', class: 'minus' + (sign < 0 ? ' on' : ''), onclick: () => { sign = -1; draw(); } }, '－ Quitar'));
      const n = Number(String(amt.value).replace(',', '.')) || 0, after = bal(cur) + sign * n;
      prev.className = 'paysum' + (after < 0 ? ' low' : '');
      prev.replaceChildren(el('span', {}, `Ahora tiene ${money(bal(cur), cur)} → quedaría`), el('b', {}, money(after, cur)));
      if (!OWN && ME.quota) {
        const q = ME.quota[cur], mx = ME.perms['max_adj_' + cur];
        info.className = 'msg ' + (q.left <= 0 ? 'err' : 'warn');
        info.replaceChildren(`Cupo de ${CUR_S[cur]}: te quedan ${money(q.left, cur)} (agregar y quitar suman) · máximo por ajuste: ${money(mx, cur)}`);
      }
    };
    amt.addEventListener('input', draw);
    const go = el('button', { class: 'big' }, 'Confirmar');
    go.onclick = async () => {
      const n = Number(String(amt.value).replace(',', '.'));
      if (!(n > 0)) return msg(err, 'Escribe un monto mayor que 0.', 'err');
      if (cur !== 'usdt' && !Number.isInteger(n)) return msg(err, 'En CUP el monto debe ser un número entero.', 'err');
      if (!OWN && why.value.trim().length < 3) return msg(err, 'Escribe el motivo (mínimo 3 letras).', 'err');
      if (!OWN && ME.quota) {
        const q = ME.quota[cur], mx = Number(ME.perms['max_adj_' + cur]);
        if (n > mx) return msg(err, `Este monto supera tu máximo por ajuste en ${CUR_S[cur]} (${money(mx, cur)}). Pídele al dueño que lo haga o divídelo.`, 'err');
        if (n > q.left) return msg(err, q.left <= 0 ? `Llegaste a tu límite de ajustes en ${CUR_S[cur]}. El dueño debe restablecerlo.` : `Solo te quedan ${money(q.left, cur)} de cupo en ${CUR_S[cur]}. Pídele al dueño que lo restablezca.`, 'err');
      }
      go.disabled = true;
      try {
        await api('POST', '/api/admin/balance', { user_id: r.id, amount: String(sign * n), currency: cur, note: why.value.trim() });
        if (!OWN) { try { ME = await api('GET', '/api/me'); } catch {} }
        close(); resolve();
      } catch (e) { msg(err, e.message, 'err'); go.disabled = false; }
    };
    const ov = el('div', { class: 'modal', onclick: e => { if (e.target === ov) cancel(); } },
      el('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Ajustar saldo' },
        el('h2', {}, 'Ajustar saldo'), el('div', { class: 'mut', style: 'margin:-6px 0 12px' }, 'Cuenta: ', el('b', {}, r.username)),
        chipsBox, el('div', { style: 'height:10px' }), pm, el('div', { style: 'height:10px' }), amt, el('div', { style: 'height:8px' }), why, el('div', { style: 'height:10px' }), prev, info, err,
        el('div', { class: 'row', style: 'margin:12px 0 0' }, el('button', { type: 'button', class: 'sec', onclick: cancel }, 'Cancelar'), go)));
    draw(); document.body.append(ov); amt.focus();
  });
  /** Barras de cupo de ajustes manuales (USDT y CUP). */
  const meterRow = (label, q, unit) => {
    const pct = q.limit > 0 ? Math.min(100, Math.round(q.used / q.limit * 100)) : 100, cls = pct >= 100 ? 'low' : pct >= 80 ? 'warn' : '';
    const f = unit === 'USDT' ? v => Number(v).toFixed(2) : v => Math.round(v).toLocaleString('es');
    return el('div', {}, el('div', { class: 'qrow' }, el('span', { class: 'mut' }, label), el('span', {}, el('b', {}, `Quedan ${f(q.left)} ${unit}`), el('span', { class: 'mut' }, ` · usado ${f(q.used)} de ${f(q.limit)}`))), el('div', { class: 'meter ' + cls }, el('i', { style: `width:${pct}%` })));
  };
  const quotaBlock = qt => el('div', {}, meterRow('💲 USDT', qt.usdt, 'USDT'), meterRow('🏦 CUP transferencia', qt.transfer, 'CUP'), meterRow('📱 CUP saldo móvil', qt.mobile, 'CUP'),
    el('div', { class: 'mut', style: 'margin-top:6px;font-size:.78rem' }, 'Último restablecimiento: ' + (qt.reset_at ? qt.reset_at + ' UTC' : 'nunca')));
  const resetQuota = async m => { if (!confirm(`¿Restablecer el cupo de ${m.username}?\nVolverá a tener su cupo completo y el conteo empieza de cero.`)) throw new Error('Cancelado'); await api('POST', '/api/admin/staff-update', { user_id: m.id, reset_quota: true }); };
  const stat = (l, v, style) => el('div', { class: 'stat' }, el('span', { class: 'mut' }, l), el('b', { style: style || null }, String(v)));
  const sect = t => el('div', { class: 'sect' }, t);
  const act = (label, fn, cls = 'sec') => el('button', { class: cls + ' sm', onclick: async () => { try { await fn(); await adminView(); } catch (e) { if (e.message !== 'Cancelado') alert(e.message); } } }, label);
  const pending = orders.filter(o => o.status === 'unknown').length, preq = reqs.filter(r => r.status === 'pending').length;
  const pend = users.filter(u => u.pending).length;
  const tSaldo = ['saldo', 'Saldo' + (preq ? ` (${preq})` : '')], tPed = ['pedidos', 'Pedidos' + (pending ? ` (${pending})` : '')], tRev = ['revendedores', 'Revendedores' + (pend ? ` (${pend})` : '')];
  const tFondos = ['fondos', 'Fondos'];
  const tabs = OWN ? [['resumen', 'Resumen'], tSaldo, tFondos, tPed, ['reportes', 'Ventas'], tRev, ['catalogo', 'Catálogo'], ['equipo', 'Equipo'], ['registro', 'Registro'], ['ajustes', 'Ajustes']]
    : [can('saldo') && tSaldo, can('saldos') && tFondos, can('pedidos') && tPed, can('revendedores') && tRev, ['cuenta', 'Mi cuenta']].filter(Boolean);
  if (!tabs.some(t => t[0] === tab)) { tab = tabs[0][0]; if (tab === 'cuenta' && can('saldo')) tab = 'saldo'; }
  put(out, el('div', { class: 'tabs' }, ...tabs.map(([k, l]) => el('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; adminView(); } }, l))));
  if (OWN) {
    const days = Number(st.settings.rate_stale_days || 0), ru = st.rates_updated ? (Date.now() - new Date(st.rates_updated).getTime()) / 864e5 : 0;
    const bn = (c, t) => put(out, el('div', { class: 'msg ' + c, style: 'margin-bottom:12px' }, t));
    if (st.provider_down) bn('err', 'Central One no está respondiendo ahora mismo. Si dura, activa el Modo mantenimiento en Resumen.');
    if (Number(st.settings.maintenance)) bn('warn', '🛠 Modo mantenimiento ACTIVO: tus revendedores no pueden enviar recargas. Desactívalo en Resumen.');
    if (days && ru > days && (Number(st.settings.rate_transfer) > 0 || Number(st.settings.rate_mobile) > 0)) bn('warn', `Tus tasas CUP llevan ${Math.floor(ru)} días sin actualizarse. Revísalas en Resumen.`);
    if (st.db_mode === 'memory') bn('err', 'La base de datos está en MEMORIA: todo se borra al reiniciar. Configura MONGODB_URI en Render.');
    const bl = st.backup_last ? (Date.now() - new Date(st.backup_last).getTime()) / 864e5 : null;
    if (Number(st.settings.auto_backup) && bl !== null && bl > 8) bn('warn', `Hace ${Math.floor(bl)} días que no se envía un respaldo a tu Telegram. Revisa que tu cuenta esté conectada.`);
  }
  if (st.balance_low) put(out, el('div', { class: 'msg err', style: 'margin-bottom:12px' }, 'Tu saldo en Central One está bajo o no alcanzó para un pedido. Recarga para no rechazar pedidos.'));

  if (tab === 'resumen') {
    const today = new Date().toISOString().slice(0, 10);
    const [feed, team] = await Promise.all([api('GET', '/api/admin/audit?cat=money&limit=8'), api('GET', '/api/admin/team-activity')]);
    const done = orders.filter(o => o.status === 'completed' && o.created_at.startsWith(today));
    const pb = st.provider_balance;
    put(out,
      el('div', { class: 'card hero' }, el('div', { class: 'mut' }, 'Saldo en Central One' + (pb && !pb.live ? ' (último dato)' : '')),
        el('div', { class: 'bal' }, pb ? usd(pb.available) : '—'),
        el('div', { class: 'mut' }, pb && pb.held !== null ? `Retenido en pedidos en curso: ${usd(pb.held)}` : (st.balance_error ? 'No se pudo leer el saldo en vivo' : ''))),
      card('Hoy', el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { class: 'mut' }, 'Recargas'), el('b', {}, String(done.length))),
        el('div', { class: 'stat' }, el('span', { class: 'mut' }, 'Vendido'), el('b', {}, usdt(done.reduce((s, o) => s + o.price, 0)))),
        el('div', { class: 'stat' }, el('span', { class: 'mut' }, 'Ganancia'), el('b', { style: 'color:var(--ok)' }, usdt(done.reduce((s, o) => s + Number(o.margin), 0)))),
        el('div', { class: 'stat' }, el('span', { class: 'mut' }, 'Por revisar'), el('b', { style: pending + preq ? 'color:var(--warn)' : '' }, String(pending + preq))))),
      card('Equipo · cupo de saldo manual', el('div', { class: 'mut', style: 'margin-bottom:6px' }, 'Lo que le queda a cada sub-administrador para agregar o quitar saldo a mano. Cuando llega a 0, tú decides si le restableces el cupo.'),
        team.staff.filter(m => m.perms.ajustar).length ? el('div', { class: 'list' }, ...team.staff.filter(m => m.perms.ajustar).map(m => el('div', { style: 'display:block' },
          el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px' }, el('div', {}, el('b', {}, m.username), ' ', m.active ? null : el('span', { class: 'tag off' }, 'Desactivado')), act('Restablecer cupo', () => resetQuota(m))),
          quotaBlock(m.quota))))
          : el('div', { class: 'mut' }, 'Ningún sub-administrador tiene el permiso "Ajustar saldo a mano".'),
        el('div', { class: 'acts' }, el('button', { class: 'sec sm', onclick: () => { tab = 'equipo'; adminView(); } }, 'Ver detalle por revendedor'))),
      (() => {
        const line = r => {
          const d = r.detail || {};
          const what = r.action === 'admin/balance' ? `${Number(d.amount) >= 0 ? 'agregó' : 'quitó'} ${money(Math.abs(Number(d.amount)), d.currency || 'usdt')} ${Number(d.amount) >= 0 ? 'a' : 'de'} ${r.target || '?'}` : `aprobó saldo · monto ${d.amount || 'según solicitud'} · ${r.target || ''}`;
          return el('div', { style: 'display:block' }, el('div', { style: 'display:flex;justify-content:space-between;gap:8px' }, el('div', { class: 'l' }, el('div', {}, el('b', {}, r.actor), ' ' + what), d.note ? el('div', { class: 'mut' }, 'Motivo: ' + d.note) : null), el('div', { class: 'r mut' }, r.at)));
        };
        return card('Saldo movido por tu equipo', el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Lo que tus sub-administradores aprueban o ajustan a mano. También te llega aviso por Telegram.'),
          feed.length ? el('div', { class: 'list' }, ...feed.map(line)) : el('div', { class: 'mut' }, 'Todavía no han movido saldo.'), el('div', { class: 'acts' }, el('button', { class: 'sec sm', onclick: () => { auditCat = 'money'; tab = 'registro'; adminView(); } }, 'Ver todo en Registro')));
      })());
  }

  /* ---------- Ajustes: todo lo que se configura una vez, ordenado por tema ---------- */
  if (tab === 'ajustes') {
    const th = el('input', { type: 'number', inputmode: 'decimal', min: '0', value: String(st.low_balance_threshold || ''), placeholder: 'Ej. 20' });
    put(out,
      sect('Precios y cuentas'),
      (() => {
        const S = st.settings, mk = el('input', { type: 'number', inputmode: 'decimal', min: '0', max: '100', step: 'any', value: String(S.default_markup), placeholder: 'Ej. 10', 'aria-label': 'Margen general %' });
        const manual = users.filter(u => u.markup_manual && !u.pending), auto = users.filter(u => !u.markup_manual && !u.pending);
        return card('Margen de ganancia general',
          el('div', { class: 'mut', style: 'margin-bottom:10px' }, 'Un solo % para todas las cuentas: las nuevas nacen con él y las ya registradas lo reciben cuando pulsas "Aplicar a todos". Las cuentas con margen puesto a mano (🔒) no se tocan: solo tú las cambias, una por una.'),
          el('div', { class: 'stats' }, stat('Margen general', S.default_markup + '%', 'color:var(--pri3)'), stat('Cuentas automáticas', auto.length), stat('Con margen manual 🔒', manual.length)),
          el('div', { class: 'row', style: 'margin-top:12px' }, mk, act('Aplicar a todos', async () => {
            const v = Number(String(mk.value).replace(',', '.'));
            if (!(mk.value !== '' && v >= 0 && v <= 100)) throw new Error('Escribe un margen entre 0 y 100.');
            if (!confirm(`¿Poner ${v}% de margen a las ${auto.length} cuentas automáticas y a las nuevas?\n\n${manual.length} cuenta(s) con margen manual NO cambian.`)) throw new Error('Cancelado');
            const r = await api('POST', '/api/admin/markup-all', { markup_pct: mk.value.replace(',', '.') });
            alert(`Listo: ${r.applied} cuenta(s) pasaron a ${r.markup_pct}%.` + (r.skipped ? `\n${r.skipped} con margen manual quedaron como estaban.` : ''));
          }, '')),
          manual.length ? el('details', { class: 'regd', style: 'margin-top:10px' }, el('summary', {}, el('b', {}, `Cuentas con margen manual (${manual.length})`), el('span', { class: 'chev', style: 'margin-left:auto' }, '›')),
            el('div', { class: 'list' }, ...manual.map(u => el('div', {}, el('div', { class: 'l' }, u.username, el('div', { class: 'mut' }, `Margen ${u.markup_pct}% 🔒`)),
              el('div', { class: 'r' }, act('Volver a automático', () => api('POST', '/api/admin/user-update', { user_id: u.id, markup_auto: true })))))),
            el('div', { class: 'mut', style: 'margin:6px 0 10px' }, '"Volver a automático" le pone el margen general y desde ahí sigue los cambios generales.')) : null);
      })(),
      (() => {
        const S = st.settings, rt = el('input', { type: 'number', inputmode: 'decimal', min: '0', value: S.rate_transfer || '', placeholder: 'Ej. 400' }),
          rm = el('input', { type: 'number', inputmode: 'decimal', min: '0', value: S.rate_mobile || '', placeholder: 'Ej. 300' }), rd = el('input', { type: 'number', min: '0', max: '60', value: String(S.rate_stale_days ?? 3) });
        return card('Tasas CUP (para precios)', el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'CUP por cada 1 USDT. Solo sirven para calcular el precio en CUP de cada paquete (precio USDT × tasa). Los saldos CUP de tus revendedores no se convierten. 0 = no se puede pagar con ese saldo.'),
          el('div', { class: 'mut' }, 'Tasa transferencia bancaria'), el('div', { class: 'row' }, rt, act('Guardar transferencia', () => api('POST', '/api/admin/settings', { rate_transfer: rt.value || 0 }), '')),
          el('div', { class: 'mut' }, 'Tasa saldo móvil'), el('div', { class: 'row' }, rm, act('Guardar saldo móvil', () => api('POST', '/api/admin/settings', { rate_mobile: rm.value || 0 }), '')),
          el('div', { class: 'mut', style: 'margin-top:10px' }, 'Última actualización: ' + (st.rates_updated ? new Date(st.rates_updated).toLocaleString('es') : 'sin registro todavía')),
          el('div', { class: 'row' }, el('label', { class: 'fld' }, 'Avisarme si pasan N días sin actualizar (0 = no avisar)', rd), act('Guardar aviso', () => api('POST', '/api/admin/settings', { rate_stale_days: rd.value || 0 }), '')),
          el('div', { class: 'acts' }, act('✔ Siguen vigentes', () => api('POST', '/api/admin/rates-confirm', {}), 'sec')));
      })(),
      (() => {
        const S = st.settings, mode = el('select', {}, ...[['approval', 'Abierto, con mi aprobación'], ['open', 'Abierto, sin aprobación'], ['off', 'Cerrado (solo yo creo cuentas)']]
          .map(([v, l]) => el('option', { value: v, selected: S.registration === v ? '' : null }, l)));
        const tw = el('input', { type: 'checkbox' }); tw.checked = !!Number(S.trust_new_wallets);
        return card('Registro de revendedores', el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Tus revendedores pueden crearse una cuenta con su correo en ' + location.origin + '. Las cuentas nuevas nacen con el margen general de arriba (' + S.default_markup + '%).'),
          el('div', { class: 'row' }, mode),
          el('label', { class: 'chk' }, tw, el('span', {}, el('b', {}, 'Confiar en las billeteras de las cuentas nuevas'),
            el('small', { class: 'mut', style: 'display:block' }, 'Activado: la primera billetera USDT desde la que pague una cuenta nueva se registra como de confianza y se le abona sola, sin que la apruebes. Solo cuenta para las cuentas que se creen desde ahora; en las que ya existen lo activas una por una en Revendedores → Más opciones.'),
            el('small', { style: 'display:block;color:#fcd34d;margin-top:4px' }, 'Ojo: una cuenta con esto activo podría reclamar con su hash un pago hecho por otra persona a tu billetera. Actívalo solo si confías en tus revendedores.'))),
          el('div', { class: 'acts' }, act('Guardar', () => api('POST', '/api/admin/settings', { registration: mode.value, trust_new_wallets: tw.checked ? 1 : 0 }), '')));
      })(),
      sect('Avisos'),
      card('Alerta de saldo bajo', el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Te aviso por Telegram (y aquí arriba) cuando el saldo de Central One baje de este monto. 0 = desactivada.'),
        el('div', { class: 'row' }, th, act('Guardar', () => api('POST', '/api/admin/settings', { low_balance_threshold: th.value.replace(',', '.') || 0 }), ''))),
      (() => {
        const ta = el('textarea', { rows: '3', placeholder: 'Ej.: Free Fire con 10% de bono hoy 🎉', style: 'width:100%' }); ta.value = st.settings.announcement || '';
        return card('Aviso para revendedores', el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Lo ven arriba en su panel. Déjalo vacío para quitarlo.'), ta,
          el('div', { class: 'acts' }, act('Publicar', () => api('POST', '/api/admin/settings', { announcement: ta.value }), ''), st.settings.announcement ? act('Quitar', () => api('POST', '/api/admin/settings', { announcement: '' }), 'red') : null));
      })(),
      telegramCard(st, adminView) || card('Avisos por Telegram', el('div', { class: 'mut' }, 'Desactivado. Para activarlo crea un bot con @BotFather y pon su token en la variable TELEGRAM_BOT_TOKEN de Render.')),
      sect('Copias y seguridad'),
      (() => {
        const bkBox = el('div'), bkAuto = el('input', { type: 'checkbox' });
        bkAuto.checked = !!Number(st.settings.auto_backup ?? 1);
        bkAuto.onchange = async () => { try { await api('POST', '/api/admin/settings', { auto_backup: bkAuto.checked ? 1 : 0 }); } catch (e) { msg(bkBox, e.message, 'err'); } };
        const bkNow = el('button', { class: 'sm' }, '📨 Enviar respaldo a mi Telegram');
        bkNow.onclick = async () => { bkNow.disabled = true; try { await api('POST', '/api/admin/backup-send', {}); msg(bkBox, 'Enviado. Revisa tu Telegram.', 'ok'); } catch (e) { msg(bkBox, e.message, 'err'); } bkNow.disabled = false; };
        return card('Respaldo', el('div', { class: 'mut' }, 'Cada 7 días el panel te manda una copia a tu Telegram (sin contraseñas ni fotos). Último envío: ' + (st.backup_last ? new Date(st.backup_last).toLocaleString('es') : 'todavía no') + '.'),
          st.backup_err ? el('div', { class: 'msg err', style: 'margin:8px 0' }, 'El último intento falló: ' + st.backup_err) : null,
          el('label', { class: 'chk', style: 'margin-top:10px' }, bkAuto, el('span', {}, el('b', {}, 'Respaldo automático semanal'))),
          el('div', { class: 'acts' }, bkNow, el('a', { href: '/api/admin/backup', download: '' }, el('button', { class: 'sec sm' }, '⬇ Descargar completo (con claves)'))), bkBox);
      })(),
      (() => {
        const on = el('input', { type: 'checkbox' }); on.checked = !!Number(st.settings.maintenance);
        const mt = el('textarea', { rows: '2', placeholder: 'Mensaje para tus revendedores (opcional)', style: 'width:100%' }); mt.value = st.settings.maintenance_msg || '';
        return card('Modo mantenimiento', el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Pausa las recargas (no se pueden enviar pedidos) cuando Central One falle o vayas a cambiar precios. Tus revendedores siguen viendo sus saldos y pueden pedir saldo.'),
          el('label', { class: 'chk' }, on, el('span', {}, el('b', {}, 'Pausar recargas ahora'))), mt,
          el('div', { class: 'acts' }, act('Guardar', () => api('POST', '/api/admin/settings', { maintenance: on.checked ? 1 : 0, maintenance_msg: mt.value }), '')));
      })(),
      (() => {
        let data = null;
        const box = el('div'), area = el('div'), file = el('input', { type: 'file', accept: '.json,.gz,application/json,application/gzip' });
        const NAMES = { users: 'cuentas', products: 'productos', wallets: 'billeteras', orders: 'pedidos', ledger: 'movimientos de saldo', topup_requests: 'solicitudes de saldo', kv: 'ajustes', audit: 'registro de actividad' };
        const plan = d => {
          const mode = el('select', {}, el('option', { value: 'missing' }, 'Solo reponer lo que falte (recomendado)'), el('option', { value: 'overwrite' }, 'Sobrescribir con lo del respaldo (vuelve atrás en el tiempo)'));
          const pw = el('input', { type: 'password', placeholder: 'Tu contraseña', autocomplete: 'current-password' });
          const cd = ME.totp ? el('input', { placeholder: 'Código de tu app de autenticación', inputmode: 'numeric', autocomplete: 'one-time-code' }) : null;
          const cf = el('input', { placeholder: 'Escribe RESTAURAR para confirmar', autocomplete: 'off' });
          const go = el('button', { class: 'red' }, 'Restaurar ahora');
          const run = async force => {
            go.disabled = true;
            try {
              const r = await api('POST', '/api/admin/restore', { data, mode: mode.value, password: pw.value, code: cd ? cd.value : '', confirm: cf.value, force });
              area.replaceChildren(el('div', { class: 'msg ok' }, '✓ Restauración terminada.'), el('div', { class: 'list' }, ...Object.entries(r.report).map(([k, v]) => el('div', {}, el('div', { class: 'l' }, NAMES[k] || k), el('div', { class: 'r mut' }, `${v.in_backup} en el respaldo · ${v.added} añadidos` + (v.errors ? ` · ${v.errors} con error` : ''))))),
                el('div', { class: 'mut', style: 'margin-top:8px' }, 'Recarga la página para ver los datos. Si el respaldo no traía contraseñas, las cuentas repuestas quedaron con la clave bloqueada: cámbiasela a cada una en Revendedores → Clave.'));
              data = null; file.value = '';
            } catch (e) {
              if (/Continuar sin ella/.test(e.message) && confirm(e.message)) return run(true);
              msg(box, e.message, 'err');
            }
            go.disabled = false;
          };
          go.onclick = () => run(false);
          area.replaceChildren(el('div', { class: 'msg ok' }, 'Respaldo leído' + (d.exported_at ? ' · generado ' + new Date(d.exported_at).toLocaleString('es') : '') + '.'),
            el('div', { class: 'list' }, ...Object.entries(d.counts).map(([k, n]) => el('div', {}, el('div', { class: 'l' }, NAMES[k] || k), el('div', { class: 'r' }, String(n))))),
            d.stripped ? el('div', { class: 'msg warn', style: 'margin-top:8px' }, 'Este respaldo no trae contraseñas (es el de Telegram). Las cuentas que no existan quedarán con la clave bloqueada hasta que se la cambies. Tu cuenta no se toca.') : null,
            el('div', { class: 'mut', style: 'margin:10px 0 4px' }, 'Antes de restaurar te mando una copia del estado actual a Telegram. Esta acción nunca borra datos.'),
            el('div', { class: 'row' }, mode), el('div', { class: 'row' }, pw), cd ? el('div', { class: 'row' }, cd) : null, el('div', { class: 'row' }, cf), el('div', { class: 'acts' }, go));
        };
        file.onchange = async () => {
          area.replaceChildren(); box.replaceChildren(); data = null;
          const f = file.files[0]; if (!f) return;
          try {
            let text;
            if (/\.gz$/i.test(f.name)) { if (typeof DecompressionStream === 'undefined') throw new Error('Tu navegador no puede abrir .gz: descomprímelo y sube el .json.'); text = await new Response(f.stream().pipeThrough(new DecompressionStream('gzip'))).text(); }
            else text = await f.text();
            data = JSON.parse(text);
            plan(await api('POST', '/api/admin/restore', { data, dry_run: true }));
          } catch (e) { data = null; msg(box, e.message || 'No se pudo leer el archivo', 'err'); }
        };
        return card('Restaurar un respaldo', el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Sube el archivo de respaldo (el .json que descargas o el .json.gz que te llega a Telegram) si perdiste datos. Primero verás qué trae, sin cambiar nada.'), el('div', { class: 'row' }, file), area, box);
      })(),
      card('Monitoreo y copias',
        el('div', { class: st.db_mode === 'memory' ? 'msg err' : 'mut' }, 'Base de datos: ' + (st.db_mode === 'memory' ? 'MEMORIA (¡se borra al reiniciar!)' : 'MongoDB ✓')),
        el('div', { class: 'mut' }, 'Último respaldo a Telegram: ' + (st.backup_last ? new Date(st.backup_last).toLocaleString('es') : 'todavía no')),
        el('div', { class: 'mut', style: 'margin-top:10px' }, 'Para que te avisen si el panel se cae: crea una cuenta gratis en UptimeRobot o BetterStack, agrega un monitor HTTP con esta dirección (revisa cada 5 min) y pon tu correo o Telegram como alerta. De paso, en Render gratis evita que el servicio se duerma:'),
        el('div', { class: 'addr' }, location.origin + '/status'),
        el('div', { class: 'mut' }, 'Responde error 503 si la base de datos no contesta. Ojo: el MongoDB Atlas gratis NO hace copias automáticas; tu copia real es el respaldo semanal de Telegram. Pruébalo restaurándolo alguna vez.'),
        el('div', { class: 'acts' }, el('button', { class: 'sec sm', onclick: () => { try { navigator.clipboard.writeText(location.origin + '/status'); alert('Dirección copiada'); } catch { alert(location.origin + '/status'); } } }, 'Copiar dirección'))),
      sect('Estado del sistema'),
      card('Estado', el('div', { class: 'mut' }, 'Catálogo actualizado: ' + (st.catalog_synced_at ? st.catalog_synced_at + ' UTC' : 'todavía no')),
        el('div', { class: 'mut' }, 'Productos activos: ' + prods.filter(p => p.active).length + ' · Revendedores: ' + users.length),
        el('div', { class: 'mut' }, 'Webhooks: ' + (st.webhooks ? 'activos' + (st.webhook_test_at ? ' · última prueba ' + st.webhook_test_at + ' UTC' : '') : 'sin configurar (se usa consulta periódica)')),
        st.webhooks ? el('div', { class: 'acts' }, el('button', { class: 'sec sm', onclick: async () => { try { await api('POST', '/api/admin/webhook-test', {}); msg(note, 'Prueba enviada. Recarga en unos segundos.', 'ok'); } catch (e) { msg(note, e.message, 'err'); } } }, 'Enviar aviso de prueba')) : null, note));
  }

  if (tab === 'saldo') {
    const [dep, wallets] = await Promise.all([api('GET', '/api/deposit-info'), OWN ? api('GET', '/api/admin/wallets') : none([])]);
    const showImg = async (r, holder, b) => {
      b.disabled = true;
      try {
        const d = await api('GET', '/api/admin/topup-image?id=' + r.id);
        if (!d.image) return holder.replaceChildren(el('div', { class: 'mut' }, 'Sin imagen'));
        const img = el('img', { src: d.image, class: 'proof', alt: 'Comprobante', 'data-saved': '1' });
        img.onclick = () => { const v = el('div', { class: 'zoom', onclick: () => v.remove() }, el('img', { src: d.image, alt: 'Comprobante' })); document.body.append(v); };
        holder.replaceChildren(img, el('div', { class: 'mut' }, 'Toca la foto para verla en grande.')); b.remove();
      } catch (e) { alert(e.message); b.disabled = false; }
    };
    const VER = { wait: ['⏳', 'warn'], verified: ['✓ Verificado en BSC', 'ok'], bad: ['✗ No cuadra', 'err'], manual: ['Manual', 'warn'], ok: ['✓ Automático', 'ok'] };
    // Payment info textareas
    const ptTA = el('textarea', { rows: '3', placeholder: 'Ej.: Banco X · Cuenta 1234 · Nombre Y', style: 'width:100%' }); ptTA.value = dep.payment_transfer || '';
    const pmTA = el('textarea', { rows: '3', placeholder: 'Ej.: +53 5XXXXXXX · Transfermóvil', style: 'width:100%' }); pmTA.value = dep.payment_mobile || '';
    const reqRow = r => {
        const holder = el('div'), vb = el('button', { class: 'ghost' }, 'Ver comprobante');
        vb.onclick = () => showImg(r, holder, vb);
        const v = r.verify === 'verified' && r.wallet_owner && r.wallet_owner !== r.username ? ['⚠ Revisar', 'warn'] : (VER[r.verify] || VER.manual);
        const show = r.approved ?? r.chain_amount ?? r.amount;
        const mLabel = METHOD_L[r.method] || 'USDT';
        return el('div', { style: 'display:block' },
          el('div', { style: 'display:flex;justify-content:space-between;gap:8px' },
            el('div', { class: 'l' }, el('div', {}, `${r.username} · #${r.id} · ${mLabel}`), el('div', { class: 'mut' }, r.created_at + (r.note ? ' · ' + r.note : '')),
              r.tx_hash ? el('div', { class: 'mut' }, el('a', { href: 'https://bscscan.com/tx/' + r.tx_hash, target: '_blank', rel: 'noopener' }, 'Ver en BscScan: ' + r.tx_hash.slice(0, 12) + '…')) : null,
              r.chain_from ? el('div', { class: 'mut' }, 'Desde ' + r.chain_from.slice(0, 8) + '…' + r.chain_from.slice(-6) + (r.wallet_owner ? ` (billetera de ${r.wallet_owner})` : ' (nueva)')) : null,
              r.amount != null && r.chain_amount != null && r.amount !== r.chain_amount ? el('div', { class: 'mut' }, `Dijo ${usdt(r.amount)}, llegó ${usdt(r.chain_amount)}`) : null,
              r.admin_note ? el('div', { class: 'mut' }, r.admin_note) : null),
            el('div', { class: 'r' }, el('div', { style: 'font-weight:800' }, show == null ? '—' : money(show, r.currency)), tag(r.status, REQ))),
          r.status === 'pending' && (r.verify_msg || r.tx_hash) ? el('div', { class: 'msg ' + v[1] }, v[0] + (r.verify_msg ? ' · ' + r.verify_msg : '')) : null,
          r.has_image ? vb : null, holder,
          r.status === 'pending' ? el('div', { class: 'acts' },
            act('Aprobar', async () => {
              const cup = r.currency !== 'usdt';
              const cupTxt = cup ? `\nDijo que envió ${money(r.amount, r.currency)}\nCompruébalo en tu ${r.method === 'mobile' ? 'teléfono' : 'banco'} antes de aprobar.` : '';
              const a = prompt(`Monto a abonar a ${r.username} en ${CUR_LONG[r.currency]}:${cupTxt}`, show == null ? '' : cup ? String(Math.round(show)) : Number(show).toFixed(2)); if (a === null) throw new Error('Cancelado');
              const n = Number(a.replace(',', '.'));
              if (!(n > 0)) throw new Error('Escribe el monto a abonar.');
              if (cup && !Number.isInteger(n)) throw new Error('El monto en CUP debe ser entero.');
              const trust = OWN && !!(r.chain_from && !r.wallet_owner) && confirm(`¿Confiar en la billetera ${r.chain_from.slice(0, 8)}… para ${r.username}?\n\nSus próximos pagos desde ella se aprobarán solos.\nPulsa Cancelar si es de un exchange (Binance, etc.), porque esas billeteras las comparten muchas personas.`);
              await api('POST', '/api/admin/topup-decide', { id: r.id, approve: true, amount: a.replace(',', '.'), trust_wallet: trust });
            }, ''),
            r.tx_hash && dep.auto ? act('Verificar otra vez', () => api('POST', '/api/admin/topup-recheck', { id: r.id })) : null,
            act('Rechazar', async () => {
              const m = prompt('Motivo (lo verá el revendedor):', ''); if (m === null) throw new Error('Cancelado');
              await api('POST', '/api/admin/topup-decide', { id: r.id, approve: false, note: m });
            }, 'red')) : null);
};
    const reqBox = el('div'), reqCnt = el('div', { class: 'mut', style: 'margin:6px 0' });
    const drawReqs = list => {
      reqCnt.textContent = `${list.length} solicitud${list.length === 1 ? '' : 'es'}` + (list.length >= 100 ? ' (las más recientes: afina el filtro para ver otras)' : '');
      reqBox.replaceChildren(list.length ? el('div', { class: 'list' }, ...list.map(reqRow)) : el('div', { class: 'mut' }, hasF(reqF) ? 'Ninguna solicitud coincide con ese filtro.' : 'No hay solicitudes.'));
    };
    const reloadReqs = async () => { reqBox.replaceChildren(el('div', { class: 'mut' }, 'Buscando…')); try { drawReqs(await api('GET', '/api/admin/topup-requests?' + qs({ ...reqF, limit: 200 }))); } catch (e) { msg(reqBox, e.message, 'err'); } };
    const reqFilters = filterBar(reqF, [['', 'Todas'], ['pending', 'Pendientes'], ['approved', 'Aprobadas'], ['rejected', 'Rechazadas']], reloadReqs, [['', 'Todos los métodos'], ['usdt', 'USDT'], ['transfer', 'Transferencia'], ['mobile', 'Saldo móvil']]);
    put(out, 
      OWN && (() => {
        const S = st.settings, rows = [['usdt', '💲 USDT BEP20'], ['transfer', '🏦 Transferencia'], ['mobile', '📱 Saldo móvil']];
        return card('Pagos por método', el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Suspende un método cuando no puedas atender pagos (por ejemplo, saldo móvil sin cobertura). Tus revendedores verán que está en pausa y no podrán pedir saldo por ahí. Sus saldos y las solicitudes ya enviadas no cambian.'),
          el('div', { class: 'list' }, ...rows.map(([k, l]) => { const off = !!Number(S['pay_off_' + k]); return el('div', {}, el('div', { class: 'l' }, el('b', {}, l), ' ', off ? el('span', { class: 'tag off' }, 'Suspendido') : el('span', { class: 'tag ok' }, 'Activo')),
            el('div', { class: 'r' }, act(off ? 'Reanudar' : 'Suspender', () => api('POST', '/api/admin/settings', { ['pay_off_' + k]: off ? 0 : 1 }), off ? '' : 'red'))); })));
      })(),
      OWN && card('USDT BEP20', dep.wallet
        ? el('div', {}, el('div', { class: 'mut' }, 'Billetera que ven tus revendedores:'), el('div', { class: 'addr' }, dep.wallet),
          el('div', { class: 'mut', style: 'margin-top:6px' }, dep.auto ? `Verificación automática activa (${dep.min_confirmations} confirmaciones).` : 'Verificación automática desactivada: falta BSC_RPC_URL en Render.'))
        : el('div', { class: 'mut' }, 'Sin configurar. En Render agrega USDT_WALLET (tu dirección BEP20) y BSC_RPC_URL (tu URL de NodeReal).')),
      OWN && card('Datos de Transferencia bancaria', el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Tus revendedores verán esto cuando elijan depositar por transferencia. Deja vacío para ocultar ese método.'), ptTA,
        el('div', { class: 'acts' }, act('Guardar', () => api('POST', '/api/admin/settings', { payment_transfer: ptTA.value }), ''))),
      OWN && card('Datos de Saldo móvil', el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Tus revendedores verán esto cuando elijan depositar por saldo móvil. Deja vacío para ocultar ese método.'), pmTA,
        el('div', { class: 'acts' }, act('Guardar', () => api('POST', '/api/admin/settings', { payment_mobile: pmTA.value }), ''))),
      card('Solicitudes de saldo', el('div', { class: 'mut' }, 'Las que vienen de una billetera de confianza se aprueban solas. Las demás las revisas aquí.' + (OWN ? '' : ` Tu límite por aprobación: ${limLine(ME.perms, 'max_')}.`)),
      reqFilters, reqCnt, reqBox),
      OWN && card('Billeteras de confianza',
        el('div', { class: 'mut', style: 'margin-bottom:10px' }, 'Todo USDT que llegue a tu billetera desde una de estas direcciones se abona solo a su revendedor, con cualquier monto (desde 0.01) y sin que tenga que pegar el hash ni enviar comprobante. No pongas billeteras de exchanges (Binance, etc.): las comparten muchas personas.'),
        wallets.length ? el('div', { class: 'list' }, ...wallets.map(w => el('div', {},
          el('div', { class: 'l' }, el('div', {}, w.username || '?', w.auto ? ' ' : null, w.auto ? el('span', { class: 'tag trust' }, 'automática') : null), el('div', { class: 'mut addr-s' }, w.address)),
          el('div', { class: 'r' }, act('Quitar', async () => { if (!confirm(`¿Quitar la billetera de ${w.username || 'este revendedor'}?\nSus próximos pagos desde ella ya no se abonarán solos.`)) throw new Error('Cancelado'); await api('POST', '/api/admin/wallet-remove', { address: w.address }); }, 'red'))))) : el('div', { class: 'mut' }, 'Ninguna todavía. Agrega una abajo, o se registran al aprobar un pago y marcar "confiar".'),
        (() => {
          const wu = el('select', { 'aria-label': 'Revendedor' }, el('option', { value: '' }, 'Elige el revendedor…'), ...users.filter(u => !u.pending).map(u => el('option', { value: u.id }, u.username)));
          const wa = el('input', { placeholder: 'Su billetera USDT BEP20 (0x…)', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', 'aria-label': 'Dirección de la billetera' });
          const wm = el('div'), wb = el('button', {}, '＋ Agregar billetera');
          wb.onclick = async () => {
            if (!wu.value) return msg(wm, 'Elige el revendedor.', 'err');
            wb.disabled = true;
            try { await api('POST', '/api/admin/wallet-add', { user_id: wu.value, address: wa.value.trim() }); await adminView(); }
            catch (e) { msg(wm, e.message, 'err'); wb.disabled = false; }
          };
          const asc = el('input', { type: 'checkbox' }); asc.checked = Number(st.settings.usdt_autoscan ?? 1) === 1;
          asc.onchange = async () => { try { await api('POST', '/api/admin/settings', { usdt_autoscan: asc.checked ? 1 : 0 }); } catch (e) { alert(e.message); asc.checked = !asc.checked; } };
          return el('div', { style: 'margin-top:14px;border-top:1px solid var(--line);padding-top:12px' }, el('h3', { style: 'margin:0 0 8px' }, 'Agregar la billetera de un revendedor'),
            el('div', { class: 'row' }, wu), el('div', { class: 'row' }, wa), el('div', { class: 'acts' }, wb), wm,
            el('label', { class: 'chk', style: 'margin-top:14px' }, asc, el('span', {}, el('b', {}, 'Abonar solos los depósitos de estas billeteras'),
              el('small', { class: 'mut', style: 'display:block' }, 'El panel mira la blockchain cada 30 s y abona lo que llegue (con las mismas confirmaciones de siempre). Apágalo para volver a aprobar todo a mano.'))));
        })()));
    if (hasF(reqF)) reloadReqs(); else drawReqs(reqs);
  }

  if (tab === 'reportes' && rep) {
    const max = Math.max(0.01, ...rep.daily.map(d => d.profit));
    put(out, 
      el('div', { class: 'chips', style: 'margin-bottom:14px' }, ...[['day', 'Hoy'], ['week', 'Esta semana'], ['month', 'Este mes'], ['all', 'Todo']].map(([k, l]) =>
        el('button', { class: 'chip' + (k === period ? ' on' : ''), onclick: () => { period = k; adminView(); } }, l))),
      card('🏆 Quién vende más', el('div', { class: 'mut', style: 'margin-bottom:6px' }, 'Ordenado por cantidad de recargas completadas' + (period === 'all' ? ' (desde siempre)' : ' · desde ' + rep.from + ' UTC') + '.'),
        rep.ranking.length ? el('div', {}, ...rep.ranking.slice(0, 20).map((x, i) => el('div', { class: 'rank' },
          el('div', { class: i < 3 ? 'medal' : 'pos' }, ['🥇', '🥈', '🥉'][i] || String(i + 1)),
          el('div', { style: 'min-width:0' }, el('div', { class: 'rname' }, x.username), el('div', { class: 'mut' }, `${x.share}% de las recargas · vendió ${usdt(x.sold)}`),
            el('div', { class: 'bar' }, el('i', { style: `width:${Math.max(3, Math.round(x.count / rep.ranking[0].count * 100))}%` }))),
          el('div', { style: 'text-align:right' }, el('b', { style: 'font-size:1.2rem' }, String(x.count)), el('div', { class: 'mut' }, x.count === 1 ? 'recarga' : 'recargas')))))
          : el('div', { class: 'mut' }, 'Sin ventas en este periodo.'),
        rep.ranking.length > 20 ? el('div', { class: 'mut', style: 'margin-top:8px' }, `Se muestran los 20 primeros de ${rep.ranking.length}.`) : null),
      card('Ganancias', el('div', { class: 'mut' }, (period === 'all' ? 'Desde siempre' : 'Desde ' + rep.from + ' UTC') + ' · solo recargas completadas'),
        el('div', { class: 'stats', style: 'margin-top:10px' },
          el('div', { class: 'stat' }, el('span', { class: 'mut' }, 'Recargas'), el('b', {}, String(rep.count))),
          el('div', { class: 'stat' }, el('span', { class: 'mut' }, 'Vendido'), el('b', {}, usdt(rep.sold))),
          el('div', { class: 'stat' }, el('span', { class: 'mut' }, 'Costo Central One'), el('b', {}, usdt(rep.cost))),
          el('div', { class: 'stat' }, el('span', { class: 'mut' }, 'Ganancia'), el('b', { style: 'color:var(--ok)' }, usdt(rep.profit))))),
      card('Ganancia de los últimos 14 días',
        el('div', { class: 'bars' }, ...rep.daily.map(d => el('div', { style: `height:${Math.round(d.profit / max * 100)}%`, title: `${d.day}: ${usdt(d.profit)}` }))),
        el('div', { class: 'bars-l' }, ...rep.daily.map(d => el('span', {}, d.day.slice(8))))),
      card('Ganancia por revendedor', rep.resellers.length ? el('div', { class: 'list' }, ...rep.resellers.map(x => el('div', {},
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
    put(out, card('Catálogo de Central One',
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
    put(out, card('Lo que ven tus revendedores', mine.size ? el('div', {}, ...[...mine].map(([f, ps]) => el('div', {}, el('h3', {}, f),
      el('div', { class: 'list' }, ...ps.map(p => el('div', {},
        el('div', { class: 'l' }, el('div', {}, p.name), el('div', { class: 'mut' }, p.cost === null ? 'fuera del catálogo' : 'Costo US$ ' + p.cost + (p.in_stock ? '' : ' · agotado'))),
        el('div', { class: 'r' }, act('Tipo: ' + PTYPES.find(([k]) => k === typeOf(p))[1], async () => { const a = prompt('Tipo de oferta: diamantes, pases, membresias u otros.\nDéjalo vacío para que se detecte solo por el nombre:', p.ptype || ''); if (a === null) throw new Error('Cancelado'); await api('POST', '/api/admin/product-update', { id: p.id, ptype: a.trim().toLowerCase() }); }), act('Renombrar', async () => { const a = prompt('Nombre que verán tus revendedores:', p.name); if (a) await api('POST', '/api/admin/product-update', { id: p.id, name: a }); }))))))))
      : el('div', { class: 'mut' }, 'Todavía no vendes nada. Abre un juego arriba y pulsa "Vender todos por ID".')));
  }

  if (tab === 'revendedores') {
    const defM = OWN ? Number(st.settings.default_markup ?? 10) : 0;
    const nu = { u: el('input', { placeholder: 'Usuario', autocomplete: 'off', 'aria-label': 'Usuario' }), p: el('input', { placeholder: 'Contraseña (8+)', type: 'password', autocomplete: 'new-password', 'aria-label': 'Contraseña' }),
      m: el('input', { placeholder: 'Margen %', type: 'number', inputmode: 'decimal', step: 'any', value: String(defM), 'aria-label': 'Margen %' }) };
    const tw = el('input', { type: 'checkbox' }); tw.checked = !!Number(st.settings.trust_new_wallets);
    const create = el('button', {}, 'Crear cuenta');
    create.onclick = async () => {
      try { await api('POST', '/api/admin/users', { username: nu.u.value, password: nu.p.value, markup_pct: nu.m.value.replace(',', '.'), ...(OWN ? { trust_wallets: tw.checked } : {}) }); adminView(); }
      catch (e) { msg(note, e.message, 'err'); }
    };
    const usersBox = el('div');
    const balOf = u => u.balances || { usdt: u.balance };
    const hasBal = u => CURS.some(c => (balOf(u)[c] || 0) > 0);
    const matchU = r => !userQuery.trim() || String(r.username).toLowerCase().includes(userQuery.trim().toLowerCase());
    const FILT = { all: () => true, bal: hasBal, nobal: u => !hasBal(u), off: u => !u.active };
    const FL = [['all', 'Todos'], ['bal', 'Con saldo'], ['nobal', 'Sin saldo'], ['off', 'Desactivados']];
    /** Una tarjeta por revendedor: quién es, cuánto tiene en cada saldo y las acciones, sin amontonar botones. */
    const rbox = r => {
      const b = balOf(r);
      return el('div', { class: 'rbox' + (r.active ? '' : ' off') },
        el('div', { class: 'rhead' }, el('div', { class: 'av' }, String(r.username).trim().charAt(0) || '?'),
          el('div', { style: 'min-width:0;flex:1' }, el('div', { class: 'rname' }, r.username),
            el('div', { class: 'tags' }, r.active ? null : el('span', { class: 'tag off' }, 'Desactivado'),
              OWN ? el('span', { class: 'tag ' + (r.markup_manual ? 'manual' : 'auto') }, `Margen ${r.markup_pct}% · ${r.markup_manual ? '🔒 manual' : 'general'}`) : null,
              OWN && r.trust_wallets ? el('span', { class: 'tag trust' }, '🔓 billeteras de confianza') : null))),
        el('div', { class: 'tiles' }, ...CURS.map(c => el('div', { class: 'tile' + ((b[c] || 0) > 0 ? '' : ' zero') }, el('span', {}, CUR_ICON[c] + ' ' + CUR_S[c]),
          el('b', {}, c === 'usdt' ? Number(b[c] || 0).toFixed(2) : Math.round(b[c] || 0).toLocaleString('es'))))),
        el('div', { class: 'acts', style: 'margin-top:0' },
          can('ajustar') ? act('± Agregar / quitar saldo', () => adjust(r), '') : null,
          act(r.active ? 'Desactivar' : 'Activar', () => api('POST', '/api/admin/user-update', { user_id: r.id, active: !r.active }), r.active ? 'red' : 'sec')),
        OWN ? el('details', { class: 'regd', style: 'margin:10px 0 0' }, el('summary', {}, el('b', {}, 'Más opciones'), el('span', { class: 'chev', style: 'margin-left:auto' }, '›')),
          el('div', { class: 'acts', style: 'margin:0 0 10px' },
            act('Cambiar margen', async () => { const a = prompt(`Margen % para ${r.username}.\nQuedará como MANUAL 🔒: el cambio general ya no lo toca.`, r.markup_pct); if (a !== null && a.trim() !== '') await api('POST', '/api/admin/user-update', { user_id: r.id, markup_pct: a.replace(',', '.') }); }),
            r.markup_manual ? act('Margen: volver a automático', () => api('POST', '/api/admin/user-update', { user_id: r.id, markup_auto: true })) : null,
            act(r.trust_wallets ? '🔓 Quitar confianza en billeteras' : '🔒 Confiar en sus billeteras', async () => {
              if (!r.trust_wallets && !confirm(`¿Confiar en las billeteras de ${r.username}?\n\nSu primera billetera nueva se registra y se le abona sola, sin que la apruebes. No lo actives si paga desde un exchange o si no confías en esta persona.`)) throw new Error('Cancelado');
              await api('POST', '/api/admin/user-update', { user_id: r.id, trust_wallets: !r.trust_wallets });
            }),
            act('Cambiar clave', async () => { const a = prompt('Nueva contraseña (8+):'); if (a) await api('POST', '/api/admin/user-update', { user_id: r.id, password: a }); }))) : null);
    };
    const renderUsers = () => {
      const base = users.filter(u => !u.pending && matchU(u)), pU = users.filter(u => u.pending && matchU(u)), aU = base.filter(FILT[userFilter] || FILT.all);
      usersBox.replaceChildren();
      put(usersBox,
        pU.length ? card('Pendientes de aprobación', el('div', { class: 'list' }, ...pU.map(r => el('div', {},
          el('div', { class: 'l' }, el('div', {}, r.username), el('div', { class: 'mut' }, 'Se registró ' + r.created_at)),
          el('div', { class: 'r' }, act('Aprobar', () => api('POST', '/api/admin/user-update', { user_id: r.id, active: true }), ''), ' ',
            act('Borrar', async () => { if (!confirm('¿Borrar la cuenta ' + r.username + '?')) throw new Error('Cancelado'); await api('POST', '/api/admin/user-delete', { user_id: r.id }); }, 'red')))))) : null,
        card('Revendedores',
          el('div', { class: 'chips', style: 'margin-bottom:12px' }, ...FL.map(([k, l]) => el('button', { type: 'button', class: 'chip' + (userFilter === k ? ' on' : ''), onclick: () => { userFilter = k; renderUsers(); } }, `${l} (${base.filter(FILT[k]).length})`))),
          aU.length ? el('div', { class: 'rgrid' }, ...aU.map(rbox)) : el('div', { class: 'mut' }, userQuery.trim() || userFilter !== 'all' ? 'Ningún revendedor coincide con ese filtro.' : 'Aún no tienes revendedores.')));
    };
    const sq = el('input', { type: 'search', placeholder: 'Buscar por correo o usuario…', value: userQuery, autocomplete: 'off', 'aria-label': 'Buscar revendedor' });
    sq.addEventListener('input', () => { userQuery = sq.value; renderUsers(); });
    const searchBar = el('div', { class: 'search' }, el('span', { class: 'lupa', 'aria-hidden': 'true' }, '🔍'), sq,
      el('button', { type: 'button', class: 'ghost clr', title: 'Borrar', onclick: () => { sq.value = ''; userQuery = ''; renderUsers(); sq.focus(); } }, '✕'));
    put(out, el('details', { class: 'card newrev', open: users.length ? null : '' }, el('summary', {}, el('h2', { style: 'margin:0' }, '＋ Nuevo revendedor'), el('span', { class: 'chev', style: 'margin-left:auto' }, '›')),
      el('div', { style: 'margin-top:12px' }, el('div', { class: 'row' }, nu.u, nu.p),
        OWN ? el('div', { class: 'row' }, el('label', { class: 'fld' }, `Margen % (general: ${defM}%)`, nu.m)) : null,
        OWN ? el('label', { class: 'chk' }, tw, el('span', {}, el('b', {}, 'Confiar en sus billeteras'), el('small', { class: 'mut', style: 'display:block' }, 'Su primera billetera USDT se registra y se abona sola.'))) : null,
        el('div', { class: 'acts' }, create),
        el('div', { class: 'mut', style: 'margin-top:8px' }, OWN ? `Precio para él = costo de Central One + su margen %. Si dejas el margen general (${defM}%), la cuenta sigue los cambios generales; si pones otro, queda como manual 🔒.` : 'La cuenta se crea con el margen general que puso el dueño.'), note)),
      searchBar, usersBox);
    renderUsers();
  }

  if (tab === 'pedidos') {
    const box = el('div'), cnt = el('div', { class: 'mut', style: 'margin:6px 0' });
    const row = o => el('div', { style: 'display:block' },
      el('div', { style: 'display:flex;justify-content:space-between;gap:8px' },
        el('div', { class: 'l' }, el('div', {}, o.product_name), el('div', { class: 'mut' }, `#${o.id} · ${o.username} · ${o.target}`), el('div', { class: 'mut' }, o.created_at + (o.reference_code ? ' · Ref ' + o.reference_code : ''))),
        el('div', { class: 'r' }, el('div', {}, money(o.paid ?? o.price, o.currency)), OWN ? el('div', { class: 'mut' }, 'gana ' + Number(o.margin).toFixed(2) + ' USDT') : null, tag(o.status))),
      o.detail ? el('div', { class: 'mut', style: 'margin-top:4px' }, o.detail) : null,
      o.status === 'unknown' ? el('div', { class: 'acts' },
        act('Reintentar (seguro)', () => api('POST', '/api/admin/retry', { order_id: o.id })),
        act('Sí llegó', () => api('POST', '/api/admin/resolve', { order_id: o.id, outcome: 'completed' }), ''),
        act('No llegó (reembolsar)', () => api('POST', '/api/admin/resolve', { order_id: o.id, outcome: 'failed' }), 'red')) : null);
    const draw = list => {
      cnt.textContent = `${list.length} pedido${list.length === 1 ? '' : 's'}` + (list.length >= 300 ? ' (los 300 más recientes: afina el filtro para ver otros)' : '');
      box.replaceChildren(list.length ? el('div', { class: 'list' }, ...list.map(row)) : el('div', { class: 'mut' }, hasF(ordF) ? 'Ningún pedido coincide con ese filtro.' : 'Sin pedidos todavía.'));
    };
    const reload = async () => { box.replaceChildren(el('div', { class: 'mut' }, 'Buscando…')); try { draw(await api('GET', '/api/admin/orders?' + qs({ ...ordF, limit: 300 }))); } catch (e) { msg(box, e.message, 'err'); } };
    put(out, card('Pedidos', el('div', { class: 'mut', style: 'margin-bottom:10px' }, 'Los "Verificando" necesitan tu revisión: compruébalos en el portal de Central One con la referencia.'),
      filterBar(ordF, [['', 'Todos'], ['unknown', 'Para revisar'], ['active', 'En proceso'], ['completed', 'Completados'], ['failed', 'Fallidos']], reload), cnt, box));
    if (hasF(ordF)) reload(); else draw(orders);
  }

  /* ---------- Fondos: Central One + saldo de todos los revendedores ---------- */
  if (tab === 'fondos') {
    const f = await api('GET', '/api/admin/funds');
    const staff = OWN ? await api('GET', '/api/admin/staff') : [];
    let fq = '';
    const rowsBox = el('div');
    const sortBox = el('div', { class: 'chips', style: 'margin:12px 0' });
    const SORTS = [['usdt', '💲 Más USDT'], ['transfer', '🏦 Más CUP transf.'], ['mobile', '📱 Más CUP saldo'], ['az', 'A–Z']];
    const drawRows = () => {
      const q = fq.trim().toLowerCase();
      let list = f.resellers.filter(r => (!q || r.username.toLowerCase().includes(q)) && (!fundOnly || CURS.some(c => r.balances[c] > 0)));
      list = [...list].sort((a, b) => fundSort === 'az' ? a.username.localeCompare(b.username) : (b.balances[fundSort] - a.balances[fundSort]) || a.username.localeCompare(b.username));
      sortBox.replaceChildren(...SORTS.map(([k, l]) => el('button', { type: 'button', class: 'chip' + (fundSort === k ? ' on' : ''), onclick: () => { fundSort = k; drawRows(); } }, l)),
        el('button', { type: 'button', class: 'chip' + (fundOnly ? ' on' : ''), onclick: () => { fundOnly = !fundOnly; drawRows(); } }, 'Solo con saldo'));
      rowsBox.replaceChildren(el('div', { class: 'mut', style: 'margin-bottom:8px' }, `${list.length} de ${f.resellers.length} revendedores`),
        list.length ? el('div', { class: 'rgrid' }, ...list.map(r => el('div', { class: 'rbox' + (r.active ? '' : ' off') },
          el('div', { class: 'rhead' }, el('div', { class: 'av' }, String(r.username).trim().charAt(0) || '?'),
            el('div', { style: 'min-width:0;flex:1' }, el('div', { class: 'rname' }, r.username), r.pending || !r.active ? el('div', { class: 'tags' }, el('span', { class: 'tag off' }, r.pending ? 'Pendiente' : 'Desactivado')) : null),
            can('ajustar') ? act('± Saldo', () => adjust(r), 'sec') : null),
          el('div', { class: 'tiles', style: 'margin-bottom:0' }, ...CURS.map(c => el('div', { class: 'tile' + (r.balances[c] > 0 ? '' : ' zero') }, el('span', {}, CUR_ICON[c] + ' ' + CUR_S[c]),
            el('b', {}, c === 'usdt' ? Number(r.balances[c]).toFixed(2) : Math.round(r.balances[c]).toLocaleString('es'))))))))
          : el('div', { class: 'mut' }, 'Ningún revendedor coincide.'));
    };
    const sq = el('input', { type: 'search', placeholder: 'Buscar revendedor…', autocomplete: 'off', 'aria-label': 'Buscar revendedor' });
    sq.addEventListener('input', () => { fq = sq.value; drawRows(); });
    const P = f.provider, vend = f.totals.usdt;
    put(out,
      card('Saldo en Central One', P ? el('div', {}, el('div', { style: 'font-size:1.9rem;font-weight:800' }, usdt(P.available)),
          el('div', { class: 'mut' }, (P.held != null ? 'Retenido en pedidos en curso: ' + usdt(P.held) + ' · ' : '') + (P.live ? 'en vivo' : 'último dato conocido' + (P.at ? ' (' + P.at + ' UTC)' : ''))))
        : el('div', { class: 'mut' }, f.provider_error || 'Todavía no hay dato del saldo de Central One.'),
        P && Number(P.available) < vend ? el('div', { class: 'msg err', style: 'margin-top:10px' }, 'Tus revendedores tienen más USDT que lo que hay en Central One: si todos compraran a la vez, no alcanzaría.') : null),
      card('Lo que tienen tus revendedores', el('div', { class: 'stats' }, ...CURS.map(c => el('div', { class: 'stat' }, el('span', { class: 'mut' }, CUR_ICON[c] + ' ' + CUR_LONG[c]), el('b', {}, money(f.totals[c], c)), el('span', { class: 'mut' }, `${f.with_balance[c]} de ${f.count} con saldo`)))),
        P ? el('div', { class: 'mut', style: 'margin-top:10px' }, `USDT de revendedores: ${usdt(vend)} · en Central One: ${usdt(P.available)}.`) : null),
      card('Saldo por revendedor', el('div', { class: 'mut', style: 'margin-bottom:10px' }, 'El USDT, la transferencia CUP y el saldo móvil CUP de cada revendedor, cada uno por separado.'), el('div', { class: 'search', style: 'margin-bottom:0' }, el('span', { class: 'lupa', 'aria-hidden': 'true' }, '🔍'), sq), sortBox, rowsBox),
      OWN ? card('Límites de tus sub-administradores', staff.length ? el('div', { class: 'list' }, ...staff.map(m => el('div', { style: 'display:block' },
        el('div', {}, el('b', {}, m.username), ' ', m.active ? null : el('span', { class: 'tag off' }, 'Desactivado'),
          el('div', { class: 'mut' }, 'Aprobar saldo: ' + (m.perms.saldo ? `hasta ${limLine(m.perms, 'max_')} por aprobación` : 'sin permiso')),
          el('div', { class: 'mut' }, 'Ajustar saldo a mano: ' + (m.perms.ajustar ? `hasta ${limLine(m.perms, 'max_adj_')} por ajuste` : 'sin permiso')),
          m.perms.ajustar ? quotaBlock(m.quota) : null,
          el('div', { class: 'mut' }, 'Ver fondos: ' + (m.perms.saldos ? 'sí' : 'no') + ' · Pedidos: ' + (m.perms.pedidos ? 'sí' : 'no') + ' · Revendedores: ' + (m.perms.revendedores ? 'sí' : 'no') + ' · 2FA: ' + (m.totp ? 'activa' : 'no'))))))
        : el('div', { class: 'mut' }, 'Todavía no tienes sub-administradores.'), el('div', { class: 'acts' }, el('button', { class: 'sec sm', onclick: () => { tab = 'equipo'; adminView(); } }, 'Cambiar límites en Equipo'))) : null);
    drawRows();
  }

  /* ---------- Equipo: sub-administradores ---------- */
  if (tab === 'equipo') {
    const staff = await api('GET', '/api/admin/staff');
    const PL = [['saldo', 'Aprobar saldo', 'Ve y aprueba o rechaza solicitudes de saldo, con tope por aprobación.'], ['pedidos', 'Pedidos', 'Ve los pedidos (sin costos ni ganancias) y resuelve los \"Verificando\".'],
      ['revendedores', 'Revendedores', 'Crea cuentas, aprueba registros y activa o desactiva (sin tocar márgenes ni claves).'],
      ['ajustar', 'Ajustar saldo a mano', 'Agrega o quita saldo USDT/CUP a un revendedor, con tope por ajuste, cupo total (que tú restableces) y motivo obligatorio.'],
      ['saldos', 'Ver fondos', 'Ve el saldo de Central One y el USDT/CUP de todos los revendedores.']];
    const permEditor = p => {
      const boxes = {};
      const mk = ([k, t, h]) => { const i = el('input', { type: 'checkbox' }); i.checked = !!p[k]; boxes[k] = i; return el('label', { class: 'chk' }, i, el('span', {}, el('b', {}, t), el('small', { class: 'mut', style: 'display:block' }, h))); };
      // Tres límites por moneda, cada uno independiente: 💲 USDT · 🏦 CUP transferencia · 📱 CUP saldo móvil
      const lims = {};
      const numIn = (key, step) => (lims[key] = el('input', { type: 'number', min: '0', step, inputmode: 'numeric', value: String(p[key] ?? 0) }));
      const trio = (pre, label) => el('div', { class: 'row3' }, ...CURS.map(c => el('label', { class: 'fld' }, `${CUR_ICON[c]} ${CUR_S[c]}`, numIn(pre + c, c === 'usdt' ? '1' : '1000'))));
      const node = el('div', {}, ...PL.map(mk),
        el('div', { class: 'mut', style: 'margin:12px 0 4px' }, el('b', {}, 'Tope por aprobación'), ': lo que pase de aquí solo lo aprueba el dueño.'), trio('max_'),
        el('div', { class: 'mut', style: 'margin:12px 0 4px' }, el('b', {}, 'Tope por cada ajuste manual'), ' de saldo:'), trio('max_adj_'),
        el('div', { class: 'mut', style: 'margin:12px 0 4px' }, el('b', {}, 'Cupo TOTAL de ajustes manuales'), ': lo que agrega y lo que quita se va sumando, por separado en cada moneda. Al llegar al cupo de una moneda no puede mover más en ella hasta que tú lo restablezcas.'), trio('quota_'));
      return { node, get: () => ({ revendedores: boxes.revendedores.checked, saldo: boxes.saldo.checked, pedidos: boxes.pedidos.checked, ajustar: boxes.ajustar.checked, saldos: boxes.saldos.checked, ...Object.fromEntries(Object.entries(lims).map(([k, i]) => [k, i.value])) }) };
    };
    const nu = { u: el('input', { placeholder: 'Usuario', autocomplete: 'off' }), p: el('input', { type: 'password', placeholder: 'Contraseña (10+)', autocomplete: 'new-password' }) };
    const ed = permEditor({ revendedores: true, saldo: true, pedidos: true, ajustar: false, saldos: true, max_usdt: 50, max_transfer: 20000, max_mobile: 20000, max_adj_usdt: 20, max_adj_transfer: 10000, max_adj_mobile: 10000, quota_usdt: 100, quota_transfer: 50000, quota_mobile: 50000 });
    const team = await api('GET', '/api/admin/team-activity');
    const teamById = new Map(team.staff.map(m => [m.id, m]));
    const f2 = (v, c) => c === 'usdt' ? Number(v).toFixed(2) : Math.round(v).toLocaleString('es');
    const flow = (o, c) => (o.add || o.rem) ? `${c === 'usdt' ? '💲' : c === 'transfer' ? '🏦' : '📱'} +${f2(o.add, c)} / −${f2(o.rem, c)}` : null;
    const nb = el('button', {}, 'Crear sub-administrador'), nm = el('div');
    nb.onclick = async () => { try { await api('POST', '/api/admin/staff', { username: nu.u.value, password: nu.p.value, perms: ed.get() }); adminView(); } catch (e) { msg(nm, e.message, 'err'); } };
    put(out,
      sect('Control de saldo manual'),
      card('Lo que mueve tu equipo', el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Cada vez que un sub-administrador agrega o quita saldo a mano se descuenta de su cupo y lo ves aquí, con el desglose por revendedor desde el último restablecimiento. Cuando llega a 0 no puede mover más hasta que tú restablezcas el cupo.'),
        team.staff.filter(m => m.perms.ajustar).length ? el('div', { class: 'list' }, ...team.staff.filter(m => m.perms.ajustar).map(m => el('div', { style: 'display:block' },
          el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px' }, el('div', {}, el('b', {}, m.username), ' ', m.active ? null : el('span', { class: 'tag off' }, 'Desactivado')), act('Restablecer cupo', () => resetQuota(m), '')),
          quotaBlock(m.quota),
          el('details', { class: 'regd', style: 'margin-top:10px' }, el('summary', {}, el('b', {}, `Desglose por revendedor (${m.resellers.length})`), el('span', { class: 'chev', style: 'margin-left:auto' }, '›')),
            el('div', { class: 'mut', style: 'margin-bottom:6px' }, `Desde ${m.since} UTC · formato: +agregó / −quitó`),
            m.resellers.length ? el('div', { class: 'list' }, ...m.resellers.map(x => el('div', { style: 'display:block' }, el('b', {}, x.username),
              el('div', { class: 'mut' }, [flow(x.usdt, 'usdt'), flow(x.transfer, 'transfer'), flow(x.mobile, 'mobile')].filter(Boolean).join('  ·  ')), el('div', { class: 'mut', style: 'font-size:.76rem' }, 'Último movimiento: ' + (x.last || '—') + ' UTC'))))
              : el('div', { class: 'mut', style: 'padding-bottom:10px' }, 'No ha movido saldo a mano desde el último restablecimiento.'),
            (m.approved.usdt || m.approved.transfer || m.approved.mobile) ? el('div', { class: 'mut', style: 'margin:8px 0 10px' }, `Además aprobó solicitudes de saldo por: ${[flow({ add: m.approved.usdt, rem: 0 }, 'usdt'), flow({ add: m.approved.transfer, rem: 0 }, 'transfer'), flow({ add: m.approved.mobile, rem: 0 }, 'mobile')].filter(Boolean).map(s => s.replace(' / −0.00', '').replace(' / −0', '')).join('  ·  ')} (esto no gasta el cupo).`) : null))))
          : el('div', { class: 'mut' }, 'Ningún sub-administrador tiene el permiso "Ajustar saldo a mano". Actívalo abajo en su ficha.')),
      card('Últimos movimientos del equipo', team.recent.length ? el('div', { class: 'list' }, ...team.recent.slice(0, 20).map(r => el('div', { style: 'display:block' },
        el('div', { style: 'display:flex;justify-content:space-between;gap:8px' },
          el('div', { class: 'l' }, el('div', {}, el('b', {}, r.by), r.kind === 'approval' ? ' aprobó saldo a ' : (r.amount >= 0 ? ' agregó a ' : ' quitó de '), el('b', {}, r.reseller)), r.note ? el('div', { class: 'mut' }, r.note) : null),
          el('div', { class: 'r' }, el('div', { style: 'font-weight:800;color:' + (r.amount >= 0 ? 'var(--ok)' : '#fca5a5') }, (r.amount >= 0 ? '+' : '−') + money(Math.abs(r.amount), r.currency)), el('div', { class: 'mut', style: 'font-size:.76rem' }, r.at)))))) : el('div', { class: 'mut' }, 'Todavía no han movido saldo.'),
        el('div', { class: 'acts' }, el('button', { class: 'sec sm', onclick: () => { auditCat = 'money'; tab = 'registro'; adminView(); } }, 'Ver todo en Registro'))),
      sect('Sub-administradores'),
      card('Nuevo sub-administrador', el('div', { class: 'mut', style: 'margin-bottom:10px' }, 'Un ayudante con acceso limitado. Todo lo que haga queda en la pestaña Registro.'),
        el('div', { class: 'row' }, nu.u, nu.p), ed.node, el('div', { class: 'acts' }, nb), nm),
      card('Tu equipo', staff.length ? el('div', { class: 'list' }, ...staff.map(m => {
        const pe = permEditor(m.perms);
        return el('div', { style: 'display:block' },
          el('div', {}, el('b', {}, m.username), ' ', m.active ? null : el('span', { class: 'tag off' }, 'Desactivado'),
            el('div', { class: 'mut' }, 'Último acceso: ' + (m.last_login ? m.last_login + ' UTC' + (m.last_ip ? ' · ' + m.last_ip : '') : 'nunca')),
            el('div', { class: 'chips', style: 'margin-top:6px;gap:6px' }, ...PL.filter(([k]) => m.perms[k]).map(([, t]) => el('span', { class: 'tag code' }, t)),
              m.perms.saldo ? el('span', { class: 'tag code' }, `Aprobar hasta ${limLine(m.perms, 'max_')}`) : null,
              m.perms.ajustar ? el('span', { class: 'tag code' }, `Ajustar hasta ${limLine(m.perms, 'max_adj_')} por vez`) : null,
              m.perms.ajustar ? el('span', { class: 'tag code' }, `Cupo ${limLine(m.perms, 'quota_')}`) : null,
              el('span', { class: 'tag ' + (m.totp ? 'ok' : 'off') }, m.totp ? '2FA activa' : 'Sin 2FA'))),
          el('details', { class: 'regd' }, el('summary', {}, el('b', {}, 'Editar permisos'), el('span', { class: 'chev', style: 'margin-left:auto' }, '›')), pe.node,
            el('div', { class: 'acts', style: 'margin-bottom:10px' }, act('Guardar permisos', () => api('POST', '/api/admin/staff-update', { user_id: m.id, perms: pe.get() }), ''))),
          el('div', { class: 'acts' },
            act('Clave', async () => { const a = prompt('Nueva contraseña para ' + m.username + ' (10+):'); if (a) await api('POST', '/api/admin/staff-update', { user_id: m.id, password: a }); }),
            act('Cerrar sesiones', () => api('POST', '/api/admin/staff-update', { user_id: m.id, revoke: true })),
            m.totp ? act('Quitar 2FA', async () => { if (!confirm('¿Quitar la verificación en dos pasos de ' + m.username + '? Tendrá que activarla otra vez.')) throw new Error('Cancelado'); await api('POST', '/api/admin/staff-update', { user_id: m.id, reset_2fa: true }); }) : null,
            act(m.active ? 'Desactivar' : 'Activar', () => api('POST', '/api/admin/staff-update', { user_id: m.id, active: !m.active }), m.active ? 'red' : 'sec')));
      })) : el('div', { class: 'mut' }, 'Todavía no tienes sub-administradores.')),
      card('Qué NO puede hacer nunca un sub-administrador', el('div', { class: 'mut' }, 'Ver costos, ganancias, ventas o reportes · tocar el catálogo, los precios o los ajustes · ajustar saldos a mano más allá de su permiso, tope y cupo · cambiar márgenes (general o de una cuenta) o contraseñas de revendedores · confiar en billeteras · descargar respaldos · ver el registro o crear otros sub-admins. Si intenta algo que no puede, queda anotado como \"Negado\".')),
      (() => {
        const bx = el('input', { type: 'checkbox' }); bx.checked = !!Number(st.settings.require_2fa || 0);
        return card('Seguridad del equipo', el('label', { class: 'chk' }, bx, el('span', {}, el('b', {}, 'Exigir verificación en dos pasos a los sub-admins'), el('small', { class: 'mut', style: 'display:block' }, 'Quien no la tenga activa solo podrá entrar a "Mi cuenta" hasta activarla.'))),
          el('div', { class: 'acts' }, act('Guardar', () => api('POST', '/api/admin/settings', { require_2fa: bx.checked ? 1 : 0 }), '')));
      })(),
      ...accountCards(true));
  }

  /* ---------- Registro de actividad ---------- */
  if (tab === 'registro') {
    const rows = await api('GET', '/api/admin/audit?cat=' + auditCat + '&limit=500');
    const ROLE_L = { admin: 'Dueño', subadmin: 'Sub-admin', reseller: 'Revendedor', visitante: 'Visitante' };
    const KEY_L = { amount: 'monto', currency: 'moneda', markup_pct: 'margen %', min_margin: 'ganancia mín.', active: 'activo', approve: 'aprobar', trust_wallet: 'confiar billetera', note: 'nota', outcome: 'resultado',
      family: 'juego', variant: 'región', method: 'método', amount_cup: 'CUP', product_id: 'producto', username: 'usuario', hash: 'hash',
      markup_auto: 'margen vuelve a automático', trust_wallets: 'confiar billeteras', trust_new_wallets: 'confiar billeteras (cuentas nuevas)', reset_quota: 'cupo restablecido', default_markup: 'margen general' };
    const listBox = el('div');
    const renderAudit = () => {
      const q = auditQ.trim().toLowerCase();
      const f = rows.filter(r => !q || [r.actor, r.label, r.target, r.ip, JSON.stringify(r.detail)].join(' ').toLowerCase().includes(q));
      listBox.replaceChildren(f.length ? el('div', { class: 'list' }, ...f.map(r => el('div', { style: 'display:block' },
        el('div', { style: 'display:flex;justify-content:space-between;gap:10px' },
          el('div', { class: 'l' }, el('div', {}, r.actor + ' ', el('span', { class: 'tag role-' + r.role }, ROLE_L[r.role] || r.role)),
            el('div', { style: 'font-weight:500' }, r.label + (r.target ? ' · ' + r.target : '')),
            Object.keys(r.detail).length ? el('div', { class: 'mut' }, Object.entries(r.detail).map(([k, v]) => (KEY_L[k] || k) + ': ' + v).join(' · ')) : null),
          el('div', { class: 'r' }, el('div', { class: 'mut' }, r.at), el('div', { class: 'mut' }, r.ip || ''), r.ok ? null : el('span', { class: 'tag off' }, r.status === 403 ? 'Negado' : 'Falló'))))))
        : el('div', { class: 'mut' }, 'Sin registros con ese filtro.'));
    };
    const sq = el('input', { type: 'search', placeholder: 'Buscar persona, acción, IP…', value: auditQ, autocomplete: 'off', 'aria-label': 'Buscar en el registro' });
    sq.addEventListener('input', () => { auditQ = sq.value; renderAudit(); });
    put(out, card('Registro de actividad',
      el('div', { class: 'mut', style: 'margin-bottom:10px' }, 'Quién hizo qué y cuándo: accesos, saldos, pedidos, cambios de cuentas y ajustes. Se guarda 180 días. Muestra los últimos 500 movimientos.'),
      el('div', { class: 'chips', style: 'margin-bottom:12px' }, ...[['all', 'Todo'], ['staff', 'Equipo'], ['reseller', 'Revendedores'], ['login', 'Accesos'], ['money', 'Saldo del equipo'], ['fail', 'Fallidos / negados']].map(([k, l]) =>
        el('button', { class: 'chip' + (auditCat === k ? ' on' : ''), onclick: () => { auditCat = k; adminView(); } }, l))),
      el('div', { class: 'search' }, el('span', { class: 'lupa', 'aria-hidden': 'true' }, '🔍'), sq, el('button', { type: 'button', class: 'ghost clr', title: 'Borrar', onclick: () => { sq.value = ''; auditQ = ''; renderAudit(); sq.focus(); } }, '✕')),
      el('div', { class: 'acts', style: 'margin:0 0 6px' }, el('button', { class: 'sec sm', onclick: () => adminView() }, '↻ Actualizar'),
        el('a', { href: '/api/admin/audit.csv?cat=' + auditCat, download: '' }, el('button', { class: 'sec sm' }, '⬇ Descargar CSV'))),
      listBox));
    renderAudit();
  }

  /* ---------- Mi cuenta (sub-admin) ---------- */
  if (tab === 'cuenta' && !OWN) {
    const PN = { saldo: 'aprobar saldo', saldos: 'ver fondos', ajustar: 'ajustar saldo a mano', pedidos: 'ver pedidos', revendedores: 'gestionar revendedores' };
    put(out, card('Mi cuenta', el('div', {}, 'Usuario: ', el('b', {}, ME.username), ' · Sub-administrador'),
      el('div', { class: 'mut', style: 'margin-top:8px' }, 'Puedes: ' + (Object.keys(PN).filter(k => can(k)).map(k => PN[k]).join(', ') || 'nada por ahora') + '.'),
      can('saldo') ? el('div', { class: 'mut' }, `Tu límite por aprobación: ${limLine(ME.perms, 'max_')}.`) : null,
      can('ajustar') ? el('div', { class: 'mut' }, `Tu límite por ajuste manual: ${limLine(ME.perms, 'max_adj_')} por vez (con motivo obligatorio).`) : null,
      can('ajustar') && ME.quota ? el('div', { style: 'margin-top:10px' }, el('div', { class: 'mut' }, 'Tu cupo total de ajustes manuales (agregar y quitar suman; el dueño lo restablece):'), quotaBlock(ME.quota)) : null,
      el('div', { class: 'mut' }, 'Todo lo que haces queda registrado.')), ...accountCards(true));
  }

  if (orders.some(o => ['pending', 'processing'].includes(o.status)) && ['resumen', 'pedidos'].includes(tab) || (tab === 'saldo' && reqs.some(r => r.status === 'pending' && r.verify === 'wait'))) {
    // el admin tiene campos ya rellenos: solo se pausa si está escribiendo, mirando una foto o con una ventana abierta
    const busy = () => { const a = document.activeElement; return (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || Date.now() - lastTyping < 60000 || !!document.querySelector('.zoom, img.proof, .modal'); };
    const tick = () => { if (busy()) timer = setTimeout(tick, 10000); else adminView().catch(() => { timer = setTimeout(tick, 20000); }); };
    timer = setTimeout(tick, 10000);
  }
}
boot();
