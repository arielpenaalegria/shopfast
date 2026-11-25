'use strict';
document.head.append(Object.assign(document.createElement('style'), { textContent: '.secban{display:flex;justify-content:space-between;align-items:center;gap:12px;background:linear-gradient(135deg,#3a1414,#2a1a0a);border:1px solid #ef444466;border-radius:16px;padding:12px 14px;margin-bottom:12px}.secban .mut{font-size:.85rem;margin-top:2px}.seclist{display:grid;gap:10px}.secitem{display:flex;gap:12px;align-items:flex-start}.secitem .mut{font-size:.85rem}.secdot{flex:0 0 26px;height:26px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:.85rem}.secdot.ok{background:#052e16;color:#86efac}.secdot.bad{background:#3a1414;color:#fca5a5}.tabsx{overflow-x:auto;display:flex;flex-wrap:nowrap}.paycard{border:1px solid #ff7a0055;background:linear-gradient(180deg,#201508,#17171c)}.paycard .ph{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.pill.wait{background:#ff7a0022;color:#ffb066;border-radius:999px;padding:4px 12px;font-size:.82rem;font-weight:700}.pl{font-size:.78rem;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--mut);margin-bottom:4px}.netrow{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 0}.netrow span{background:#ffffff0d;border:1px solid #ffffff14;border-radius:999px;padding:4px 10px;font-size:.78rem;color:#d4d4d8}.tip{margin-top:12px;background:#3b2a06;color:#fcd34d;border-radius:12px;padding:10px 12px;font-size:.85rem;line-height:1.4}.steps3{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:10px 0 12px}.steps3 span{background:#ffffff0a;border-radius:12px;padding:8px 4px;text-align:center;font-size:.78rem;color:#c9c9d1}.steps3 b{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#ff7a00;color:#fff;font-size:.75rem;margin-right:3px}.qa{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.payexact{font-size:2rem;font-weight:800;color:#ff9a3c;letter-spacing:.5px;margin:6px 0;overflow-wrap:anywhere}.payexact small{font-size:1rem;color:var(--mut)}.storelogo{width:56px;height:56px;border-radius:14px;object-fit:cover;border:1px solid var(--line)}.addr{font-family:ui-monospace,Menlo,monospace;font-size:.92rem;word-break:break-all;background:#000;border:1px dashed #ff7a0080;color:#ffd7b0;padding:12px;border-radius:10px;margin-top:6px}.addr-s{font-family:ui-monospace,monospace;word-break:break-all;font-size:.75rem}.msg a,.mut a{color:var(--pri)}.proof{display:block;max-width:100%;max-height:380px;border-radius:10px;margin-top:8px;border:1px solid var(--line);cursor:zoom-in}.payinfo{background:#000;border:1px dashed #ff7a0080;border-radius:10px;padding:6px 12px}.payinfo .pl{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #ffffff12;overflow-wrap:anywhere}.payinfo .pl:last-child{border:0}.payinfo .pl span{color:#ffd7b0}.steps{margin:0 0 10px;padding-left:20px;color:var(--mut);font-size:.88rem}.steps li{margin:3px 0}.big{font-size:1.05rem;padding:13px}.zoom{position:fixed;inset:0;background:#000e;z-index:50;display:flex;align-items:center;justify-content:center;padding:10px;cursor:zoom-out}.zoom img{max-width:100%;max-height:100%;border-radius:8px}.row3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:4px 0}.row3 .fld{font-size:.78rem;min-width:0}.row3 input{padding:10px 8px;font-size:.95rem}.bals{display:grid;gap:6px;margin:6px 0 4px}.bals>div{display:flex;justify-content:space-between;align-items:baseline;background:#0000002a;border-radius:10px;padding:8px 12px}.bals span{font-size:.88rem;color:#ffedd5}.bals b{font-size:1.35rem;font-weight:900}.bals small{font-size:.8rem;font-weight:700}.paych{display:flex;flex-direction:column;align-items:flex-start;border-radius:12px;text-align:left}.paych small{font-weight:500;font-size:.74rem;opacity:.8}.paych.low:not(.on){opacity:.55}' }));
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
/* Iconos del diseño neón (SVG embebidos, sin pedir nada a internet). */
const svgUri = x => 'data:image/svg+xml,' + encodeURIComponent(x);
const ICO = {
  shield: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M20 3 34 8v11c0 9-6 15-14 18C12 34 6 28 6 19V8z" fill="#22c55e" stroke="#bbf7d0" stroke-width="2" stroke-linejoin="round"/><path d="m13 20 5 5 9-10" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'),
  wallet: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc247"/><stop offset="1" stop-color="#f06a00"/></linearGradient></defs><rect x="4" y="11" width="38" height="30" rx="8" fill="url(#g)" stroke="#ffe0a3" stroke-width="1.5"/><path d="M8 11l26-6a4 4 0 0 1 5 4v2" fill="#d35400"/><rect x="26" y="21" width="20" height="12" rx="6" fill="#ffb347" stroke="#ffe0a3" stroke-width="1.5"/><circle cx="35" cy="27" r="2.6" fill="#7a3b00"/></svg>'),
  plane: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2.5 11 21.5 3 15 21l-3.6-6.6z" fill="#e9d5ff" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/><path d="M11.4 14.4 21.5 3" stroke="#7c3aed" stroke-width="1.6" stroke-linecap="round"/></svg>'),
  bigshield: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c084fc"/><stop offset="1" stop-color="#6d28d9"/></linearGradient><linearGradient id="b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff9a1f"/><stop offset="1" stop-color="#ec4899"/></linearGradient></defs><ellipse cx="60" cy="84" rx="54" ry="15" fill="none" stroke="url(#b)" stroke-width="4" transform="rotate(-12 60 84)" opacity=".6"/><path d="M60 8 96 22v34c0 24-16 40-36 50C40 96 24 80 24 56V22z" fill="url(#a)" stroke="#e9d5ff" stroke-width="2.5" stroke-linejoin="round"/><path d="m42 56 13 13 25-27" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 84a54 15 0 0 0 108 0" fill="none" stroke="url(#b)" stroke-width="4" transform="rotate(-12 60 84)"/></svg>')
};
const icon = (k, cls = '') => el('img', { src: ICO[k], alt: '', class: cls });
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
/** Tienda del revendedor: nombre + icono que aparecen en el comprobante y arriba del panel. */
function storeCard(extra) {
  let logo = extra.store_logo || '';
  const name = el('input', { maxlength: 40, placeholder: 'Nombre de tu tienda', value: extra.store_name || '' }), box = el('div');
  const prev = el('img', { class: 'storelogo', alt: '' }), setPrev = () => { prev.src = logo || 'logo.jpg'; };
  setPrev();
  const file = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  file.onchange = async () => {
    try {
      const f = file.files[0]; if (!f) return;
      const bmp = await createImageBitmap(f), c = document.createElement('canvas'); c.width = c.height = 256;
      const k = Math.max(256 / bmp.width, 256 / bmp.height), w = bmp.width * k, h = bmp.height * k, g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256); g.drawImage(bmp, (256 - w) / 2, (256 - h) / 2, w, h);
      logo = c.toDataURL('image/jpeg', 0.85); setPrev();
    } catch { msg(box, 'No se pudo leer esa imagen. Prueba con otra.', 'err'); }
  };
  const save = async b => {
    b.disabled = true;
    try { await api('POST', '/api/store', { name: name.value, logo }); storeInfo = { name: name.value.trim(), logo }; extra.store_name = storeInfo.name; extra.store_logo = logo; paintBrand(); msg(box, 'Guardado. Saldrá en tus comprobantes.', 'ok'); }
    catch (e) { msg(box, e.message, 'err'); } b.disabled = false;
  };
  return card('Mi tienda', el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Tu nombre e icono aparecen arriba del panel y en los comprobantes que le mandas a tus clientes.'),
    el('div', { class: 'row', style: 'align-items:center' }, prev, el('button', { class: 'sec sm', onclick: () => file.click() }, '🖼 Elegir icono'),
      el('button', { class: 'ghost sm', onclick: () => { logo = ''; setPrev(); } }, 'Quitar')), file,
    el('label', {}, 'Nombre de la tienda', name), el('div', { class: 'acts' }, el('button', { onclick: e => save(e.target) }, 'Guardar')), box);
}
/** Cambia el logo y el nombre de la cabecera por los de la tienda del revendedor. */
function paintBrand() {
  const b = document.querySelector('header .brand'); if (!b) return;
  const img = b.querySelector('img'), bn = b.querySelector('.bn'); if (!bn) return;
  if (img) img.src = storeInfo.logo || 'logo.jpg';
  const w = (storeInfo.name || 'Shop Fast').trim().split(/\s+/), last = w.length > 1 ? w.pop() : null;
  bn.replaceChildren(w.join(' ') + (last ? ' ' : ''), last ? el('em', {}, last) : '');
}
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
$('login').querySelector('h2').after(el('div', { class: 'sub' }, 'Entra para recargar, ver tu saldo y tu historial.'));
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
// Google: el script se carga una sola vez; cada botón registra su propia respuesta
let gsiP = null;
const gsiLoad = () => gsiP || (gsiP = new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.onload = ok; sc.onerror = () => no(new Error('No se pudo cargar Google')); document.head.append(sc); }));
async function gsiButton(box, clientId, onCred, text) {
  await gsiLoad();
  google.accounts.id.initialize({ client_id: clientId, ux_mode: 'popup', callback: r => onCred(r.credential) });
  google.accounts.id.renderButton(box, { theme: 'filled_black', size: 'large', shape: 'pill', text: text || 'continue_with', locale: 'es', width: Math.min(320, (box.parentElement && box.parentElement.clientWidth || 340) - 44) });
}
/** Botón flotante de WhatsApp: el dueño pone el enlace en Ajustes. Si existe public/whatsapp.png se usa como icono. */
function paintWhatsApp(url) {
  let a = document.getElementById('wafab');
  if (!url) { if (a) a.remove(); return; }
  if (!a) {
    const img = el('img', { src: 'whatsapp.png', alt: '' }); img.onerror = () => { img.replaceWith(el('span', { class: 'waic', 'aria-hidden': 'true' }, '💬')); };
    a = el('a', { id: 'wafab', class: 'wafab', target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Escríbenos por WhatsApp', title: 'WhatsApp' }, img, el('span', { class: 'wat' }, 'WhatsApp'));
    document.body.append(a);
  }
  a.href = url;
}
api('GET', '/api/public-config').then(cfg => paintWhatsApp(cfg.whatsapp_url)).catch(() => {});
// Inicio de sesión con Google (si el dueño puso GOOGLE_CLIENT_ID)
api('GET', '/api/public-config').then(cfg => {
  if (!cfg.google_client_id) return;
  const gbox = el('div', { class: 'gbox' }), gm = el('div');
  const gcode = el('input', { placeholder: 'Código de tu app de autenticación', inputmode: 'numeric', autocomplete: 'one-time-code', class: 'hidden' }), gb2 = el('button', { class: 'hidden' }, 'Confirmar código');
  const sep = el('div', { class: 'sep' }, el('span', {}, 'o con tu correo'));
  $('lu').before(gbox, gm, gcode, gb2, sep);
  let cred = null;
  const go = async () => {
    try {
      const d = await api('POST', '/api/google', { credential: cred, code: gcode.value });
      if (d.need_2fa) { gcode.classList.remove('hidden'); gb2.classList.remove('hidden'); gcode.focus(); return msg(gm, 'Escribe el código de tu app de autenticación.', 'ok'); }
      gm.replaceChildren(); gcode.value = ''; gcode.classList.add('hidden'); gb2.classList.add('hidden'); boot();
    } catch (e) { msg(gm, e.message, 'err'); }
  };
  gb2.onclick = go; gcode.addEventListener('keydown', e => e.key === 'Enter' && go());
  gsiButton(gbox, cfg.google_client_id, c => { cred = c; go(); }).catch(() => { gbox.remove(); sep.remove(); });
}).catch(() => {});
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
    $('who').replaceChildren(
      el('button', { class: 'acct', onclick: () => { if (me.role === 'admin' || me.role === 'subadmin') { tab = me.role === 'admin' ? 'seguridad' : 'cuenta'; adminView(); } else { rtab = 'cuenta'; resellerView(); } window.scrollTo(0, 0); } }, el('span', {}, '👤'), 'Mi cuenta'),
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
/** Vincular la cuenta del panel con una cuenta de Google (para entrar con un toque). Pide la contraseña (y el código 2FA si lo tienes). */
function googleCard() {
  const body = el('div', { class: 'mut' }, 'Cargando…'), box = el('div'), c = card('Cuenta de Google', body, box);
  api('GET', '/api/google-status').then(st => {
    if (!st.enabled) { c.remove(); return; }
    const pw = el('input', { type: 'password', placeholder: 'Tu contraseña actual', autocomplete: 'current-password' });
    const cd = st.needs_code ? el('input', { placeholder: 'Código de tu app de autenticación', inputmode: 'numeric', autocomplete: 'one-time-code' }) : null;
    const draw = (linked, email) => {
      body.replaceChildren(); box.replaceChildren();
      if (linked) {
        const off = el('button', { class: 'red sm' }, 'Desvincular Google');
        off.onclick = async () => { off.disabled = true; try { await api('POST', '/api/google-unlink', { password: pw.value, code: cd ? cd.value : '' }); pw.value = ''; if (cd) cd.value = ''; draw(false); msg(box, 'Google desvinculada.', 'ok'); } catch (e) { msg(box, e.message, 'err'); } off.disabled = false; };
        put(body, el('div', { class: 'msg ok', style: 'margin:0 0 10px' }, '✓ Vinculada' + (email ? ': ' + email : '') + '. Ya puedes entrar con el botón de Google en la pantalla de inicio.' + (st.needs_code ? ' Seguirá pidiéndote el código de dos pasos.' : '')),
          el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Para desvincular escribe tu contraseña' + (cd ? ' y el código' : '') + ':'), el('div', { class: 'row' }, pw), cd ? el('div', { class: 'row' }, cd) : null, el('div', { class: 'acts' }, off));
      } else {
        const gb = el('div', { class: 'gbox', style: 'justify-content:flex-start' });
        put(body, el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Vincula tu cuenta de Google para entrar con un toque. Por seguridad escribe tu contraseña' + (cd ? ' y el código de tu app' : '') + ' y luego elige tu cuenta de Google:'),
          el('div', { class: 'row' }, pw), cd ? el('div', { class: 'row' }, cd) : null, gb);
        gsiButton(gb, st.client_id, async cred => {
          try { const r = await api('POST', '/api/google-link', { credential: cred, password: pw.value, code: cd ? cd.value : '' }); pw.value = ''; if (cd) cd.value = ''; draw(true, r.email); msg(box, 'Cuenta de Google vinculada.', 'ok'); }
          catch (e) { msg(box, e.message, 'err'); }
        }, 'continue_with').catch(() => msg(box, 'No se pudo cargar Google. Revisa tu conexión.', 'err'));
      }
    };
    draw(st.linked, st.email);
  }).catch(() => c.remove());
  return c;
}
const accountCards = staff => [passwordCard(), staff ? twoFaCard() : null, googleCard(), sessionsCard()];

/* =================== COMPROBANTE + EFECTO DE ÉXITO (sin precio) =================== */
const fmtDur = ms => { const t = Math.max(0, Math.round(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = t % 60;
  return h ? `${h} h ${m} min` : m ? `${m} min ${sec} s` : `${sec} s`; };
const fmtWhen = ts => new Date(ts).toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const loadImg = src => new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
/** Dibuja el comprobante en un canvas. NUNCA incluye el precio ni el saldo usado. */
let storeInfo = { name: '', logo: '' };
async function receiptBlob(o) {
  const W = 720, H = 1100, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), F = 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif', OR = '#ff7a00', GR = '#22c55e';
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const fit = (t, max, size, w = 800) => { let z = size; do { g.font = `${w} ${z}px ${F}`; z -= 2; } while (g.measureText(t).width > max && z > 14); };
  // fondo
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#15100a'); bg.addColorStop(.5, '#0d0d10'); bg.addColorStop(1, '#0a0a0c'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const gl = g.createRadialGradient(W / 2, 0, 20, W / 2, 0, 560); gl.addColorStop(0, 'rgba(255,122,0,.30)'); gl.addColorStop(1, 'rgba(255,122,0,0)'); g.fillStyle = gl; g.fillRect(0, 0, W, H);
  // tarjeta principal
  const X = 36, Y = 36, CW = W - 72, CH = H - 72;
  g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 40; g.shadowOffsetY = 12; rr(X, Y, CW, CH, 32); g.fillStyle = '#17171c'; g.fill(); g.restore();
  g.save(); rr(X, Y, CW, CH, 32); g.clip();
  const hd = g.createLinearGradient(X, Y, X + CW, Y + 230); hd.addColorStop(0, '#ff8a1f'); hd.addColorStop(1, '#ff4d00'); g.fillStyle = hd; g.fillRect(X, Y, CW, 230);
  g.fillStyle = 'rgba(255,255,255,.07)'; g.beginPath(); g.arc(X + CW - 40, Y + 20, 150, 0, 7); g.fill(); g.beginPath(); g.arc(X + 30, Y + 230, 90, 0, 7); g.fill();
  g.restore();
  g.textAlign = 'center';
  // logo + tienda
  const logo = await loadImg(storeInfo.logo || 'logo.jpg'), cx = W / 2, ly = 96;
  g.beginPath(); g.arc(cx, ly, 54, 0, 7); g.fillStyle = '#fff'; g.fill();
  if (logo) { g.save(); g.beginPath(); g.arc(cx, ly, 50, 0, 7); g.clip(); g.drawImage(logo, cx - 50, ly - 50, 100, 100); g.restore(); }
  g.fillStyle = '#fff'; { const nm = (storeInfo.name || 'SHOP FAST').toUpperCase(); fit(nm, 560, 34, 800); g.fillText(nm, cx, 200); }
  // sello de éxito
  const sy = 300;
  g.beginPath(); g.arc(cx, sy, 62, 0, 7); g.fillStyle = 'rgba(34,197,94,.16)'; g.fill();
  g.beginPath(); g.arc(cx, sy, 46, 0, 7); g.fillStyle = GR; g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(cx - 19, sy + 2); g.lineTo(cx - 5, sy + 17); g.lineTo(cx + 22, sy - 14); g.stroke();
  g.fillStyle = '#f4f4f5'; g.font = `800 38px ${F}`; g.fillText('Recarga realizada con éxito', cx, 410);
  // píldora de estado
  rr(cx - 78, 430, 156, 36, 18); g.fillStyle = 'rgba(34,197,94,.15)'; g.fill(); g.fillStyle = '#4ade80'; g.font = `700 17px ${F}`; g.fillText('●  COMPLETADA', cx, 454);
  // paquete (con diamante dibujado)
  const px = X + 34, pw = CW - 68;
  rr(px, 496, pw, 120, 22); g.fillStyle = '#1f1f26'; g.fill(); g.strokeStyle = 'rgba(255,122,0,.45)'; g.lineWidth = 2; g.stroke();
  const dx = px + 56, dy = 556; g.fillStyle = '#38bdf8'; g.beginPath(); g.moveTo(dx - 26, dy - 8); g.lineTo(dx - 14, dy - 24); g.lineTo(dx + 14, dy - 24); g.lineTo(dx + 26, dy - 8); g.lineTo(dx, dy + 26); g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.moveTo(dx - 26, dy - 8); g.lineTo(dx + 26, dy - 8); g.lineTo(dx, dy + 26); g.closePath(); g.globalAlpha = .35; g.fill(); g.globalAlpha = 1;
  g.textAlign = 'left'; g.fillStyle = '#a1a1aa'; g.font = `600 18px ${F}`; g.fillText('PAQUETE', px + 104, 538);
  g.fillStyle = OR; fit(o.product_name, pw - 130, 32, 800); g.fillText(o.product_name, px + 104, 584); g.textAlign = 'center';
  // datos
  const rows = [['ID DEL JUGADOR', o.target, 1], ['NOMBRE DE LA CUENTA', o.player_name || 'No disponible', !!o.player_name], ['TIEMPO EN COMPLETARSE', o.done_ts && o.created_ts ? fmtDur(o.done_ts - o.created_ts) : '—', 1], ['FECHA Y HORA', o.done_ts ? fmtWhen(o.done_ts) : o.created_at, 1]];
  let y = 664;
  rows.forEach(([k, v, strong], i) => {
    g.textAlign = 'left'; g.fillStyle = '#8b8b95'; g.font = `700 17px ${F}`; g.fillText(k, px + 8, y + 18);
    g.textAlign = 'right'; g.fillStyle = strong ? '#f4f4f5' : '#8b8b95'; fit(String(v), pw - 270, 30, 700); g.fillText(String(v), px + pw - 8, y + 20);
    if (i < rows.length - 1) { g.fillStyle = '#2a2a33'; g.fillRect(px, y + 46, pw, 2); }
    y += 70;
  });
  // perforado tipo ticket
  const py = 972; g.fillStyle = '#0b0b0e'; g.beginPath(); g.arc(X, py, 16, 0, 7); g.fill(); g.beginPath(); g.arc(X + CW, py, 16, 0, 7); g.fill();
  g.strokeStyle = '#34343d'; g.lineWidth = 2; g.setLineDash([10, 9]); g.beginPath(); g.moveTo(X + 24, py); g.lineTo(X + CW - 24, py); g.stroke(); g.setLineDash([]);
  g.textAlign = 'center'; g.fillStyle = '#8b8b95'; g.font = `600 20px ${F}`; g.fillText(`Pedido #${o.id}`, cx, 1018);
  g.fillStyle = OR; g.font = `700 22px ${F}`; g.fillText('¡Gracias por tu compra!', cx, 1052);
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
/* ---- Carrito: varias ofertas (con su cantidad) y se envían todas juntas ---- */
const MAXQ = 20;
let cart = [];
const cartLoad = u => { try { cart = JSON.parse(localStorage.getItem('cart_' + u) || '[]').filter(i => i && i.pid && i.qty > 0 && i.target && i.cur); } catch { cart = []; } };
const cartSave = u => { try { localStorage.setItem('cart_' + u, JSON.stringify(cart)); } catch {} };
const mulP = (x, n, c) => c === 'usdt' ? Math.round(x * n * 100) / 100 : x * n;
let scrollTo3 = false, rtab = 'recargar';
async function resellerView() {
  clearTimeout(timer);
  const [me, products, orders, led, reqs, extra, dep] = await Promise.all([api('GET', '/api/me'), api('GET', '/api/products'), api('GET', '/api/orders'),
    api('GET', '/api/ledger'), api('GET', '/api/topup-requests'), api('GET', '/api/me-extra'), api('GET', '/api/deposit-info')]);
  const bal = me.balances || { usdt: me.balance, transfer: 0, mobile: 0 };
  cartLoad(me.username);
  checkNewlyCompleted(orders);
  storeInfo = { name: extra.store_name || '', logo: extra.store_logo || '' }; paintBrand();
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
      el('div', { class: 'grid' }, ...list.map(p => el('button', { class: 'pkg' + (p.id === pick.product ? ' on' : ''), onclick: () => { if (pick.product !== p.id) pick.qty = 1; pick.product = p.id; scrollTo3 = true; renderBuy(); } },
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
    let qty = Math.max(1, Math.min(MAXQ, Number(pick.qty) || 1));
    const qv = el('b', { class: 'qv' }, String(qty));
    const setQ = n => { qty = Math.max(1, Math.min(MAXQ, n)); pick.qty = qty; qv.textContent = String(qty); renderPay(); };
    const stepper = el('div', { class: 'qbox' }, el('div', {}, el('b', {}, '¿Cuántos?'), el('div', { class: 'mut' }, 'Puedes pedir más de uno')),
      el('div', { class: 'qstep' }, el('button', { type: 'button', class: 'qb', onclick: () => setQ(qty - 1) }, '−'), qv, el('button', { type: 'button', class: 'qb plus', onclick: () => setQ(qty + 1) }, '+')));
    const btn = el('button', { class: 'big' }), cbtn = el('button', { type: 'button', class: 'sec' }, '🛒 Agregar al carrito');
    const payBox = el('div');
    const totalNow = () => mulP(priceOf(payCur), qty, payCur);
    const renderPay = () => {
      const tot = totalNow(), enough = bal[payCur] >= tot;
      btn.textContent = qty > 1 ? `Enviar ${qty} · ${money(tot, payCur)}` : `Enviar · ${money(tot, payCur)}`;
      payBox.replaceChildren(); put(payBox, el('div', { class: 'paysum' + (enough ? '' : ' low') },
        el('span', {}, CUR_ICON[payCur] + ' Tu saldo disponible'), el('b', {}, money(bal[payCur], payCur))),
        enough ? null : el('div', { class: 'msg err', style: 'margin:8px 0 0' }, `No te alcanza el saldo ${CUR_LONG[payCur]}. Cambia el tipo de pago arriba o pide saldo.`));
    };
    renderPay();
    const readTarget = () => {
      const t = target();
      const empty = p.fields.find(f => !String(t[f.key] || '').trim());
      if (empty) { msg(vbox, `Falta: ${empty.label}`, 'err'); inputs[empty.key].focus(); return null; }
      for (const k of Object.keys(t)) t[k] = String(t[k]).trim();
      return t;
    };
    cbtn.onclick = () => {
      const t = readTarget(); if (!t) return;
      const key = JSON.stringify(t), ex = cart.find(i => i.pid === p.id && i.cur === payCur && JSON.stringify(i.target) === key);
      if (ex) ex.qty = Math.min(50, ex.qty + qty); else cart.push({ pid: p.id, target: t, qty, cur: payCur });
      cartSave(me.username); pick.qty = 1;
      flash = [`🛒 Agregado al carrito: ${qty} × ${shortName(p.name)} para ${Object.values(t).join(' · ')}. Puedes seguir agregando o abrir el carrito.`, 'ok'];
      resellerView();
    };
    btn.onclick = async () => {
      const t = readTarget(); if (!t) return;
      const tot = totalNow();
      if (bal[payCur] < tot) { msg(vbox, `Saldo ${CUR_LONG[payCur]} insuficiente. Elige otro saldo o pide saldo.`, 'err'); return; }
      if (!confirm(`¿Enviar ${qty > 1 ? qty + ' × ' : ''}${p.name}\na ${Object.values(t).join(' · ')}\n\nSe pagará con saldo ${CUR_LONG[payCur]}: ${money(tot, payCur)}?`)) return;
      btn.disabled = cbtn.disabled = true;
      let ok = 0, unk = 0, err = null;
      for (let k = 0; k < qty; k++) {
        btn.textContent = `Enviando ${k + 1} de ${qty}…`;
        try { const d = await api('POST', '/api/orders', { product_id: p.id, target: t, currency: payCur }); ok++; if (d.status === 'unknown') unk++; }
        catch (e) { err = e.message; break; }
      }
      if (err) flash = [ok ? `Se enviaron ${ok} de ${qty}. Se detuvo: ${err}` : err, 'err'];
      else flash = unk ? [`${ok} recarga${ok > 1 ? 's' : ''} enviada${ok > 1 ? 's' : ''}. ${unk} no se pudo confirmar todavía: se está verificando, no la repitas.`, 'warn']
        : [ok > 1 ? `${ok} recargas enviadas. Se están procesando; el estado se actualiza solo.` : 'Recarga enviada. Se está procesando; el estado se actualiza solo.', 'ok'];
      pick.product = null; pick.qty = 1;
      resellerView();
    };
    const step3 = el('h3', {}, (n + 1) + '. Datos del jugador · ' + shortName(p.name));
    put(buy, step3,
      recent.length ? el('div', { class: 'recents' }, el('span', { class: 'mut', style: 'align-self:center' }, 'Recientes:'),
        ...recent.map(t => el('button', { class: 'chip', onclick: () => fillWith(t) }, Object.values(t).join(' · ')))) : null,
      el('div', { class: 'row' }, ...fields), stepper, payBox, el('div', { class: 'row' }, vbtn, cbtn), btn, vbox);
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
      const amount = el('input', { type: 'number', inputmode: 'decimal', min: '0.01', step: '0.01', placeholder: 'Cuánto USDT vas a enviar (desde 0.01)' });
      const copyBtn = el('button', { class: 'sec sm' }, 'Copiar dirección');
      copyBtn.onclick = async () => { try { await navigator.clipboard.writeText(dep.wallet); copyBtn.textContent = '✓ Copiada'; } catch { prompt('Copia:', dep.wallet); } };
      const warn = el('div', { class: 'msg err', style: 'margin:0 0 10px' }, '⚠ Solo USDT por la red BSC (BEP20). Si envías por otra red el dinero se pierde.');
      const sendBtn = el('button', { class: 'big' }, dep.auto ? 'Generar mi monto exacto' : 'Enviar solicitud');
      sendBtn.onclick = () => {
        const av = Number(String(amount.value).replace(',', '.'));
        if (!(av >= 0.01)) return msg(reqBox, 'Escribe un monto de 0.01 USDT o más.', 'err');
        submit(sendBtn, { method: 'usdt', amount: amount.value.replace(',', '.') }, 'Generando…');
      };
      if (dep.auto) {
        const mine = reqs.filter(r => r.status === 'pending' && r.pay_amount && r.method === 'usdt');
        const copy = (txt, b, label) => async () => { try { await navigator.clipboard.writeText(txt); b.textContent = '✓ Copiado'; setTimeout(() => { b.textContent = label; }, 1800); } catch { prompt('Copia:', txt); } };
        const payCard = r => {
          const ca = el('button', { class: 'sec sm' }, '📋 Copiar monto'), cw = el('button', { class: 'sec sm' }, '📋 Copiar dirección');
          ca.onclick = copy(r.pay_amount, ca, '📋 Copiar monto'); cw.onclick = copy(dep.wallet, cw, '📋 Copiar dirección');
          return el('div', { class: 'card paycard' },
            el('div', { class: 'ph' }, el('span', { class: 'pill wait' }, '⏳ Esperando tu pago'), el('span', { class: 'mut' }, 'Pedido #' + r.id)),
            el('div', { class: 'pl' }, '1 · Envía exactamente'),
            el('div', { class: 'payexact' }, r.pay_amount, el('small', {}, ' USDT')), el('div', { class: 'acts', style: 'margin-top:0' }, ca),
            el('div', { class: 'pl', style: 'margin-top:16px' }, '2 · A esta dirección'),
            el('div', { class: 'addr' }, dep.wallet), el('div', { class: 'acts' }, cw),
            el('div', { class: 'netrow' }, el('span', {}, '🌐 Red BSC (BEP20)'), el('span', {}, '💲 Solo USDT')),
            el('div', { class: 'pl', style: 'margin-top:14px' }, '3 · Listo'),
            el('div', { class: 'mut' }, `Cuando llegue, se abonan solos los ${r.amount.toFixed(2)} USDT a tu saldo (1-2 min). Vence ${r.expires_at}.`),
            el('div', { class: 'tip' }, 'Si el monto no es exacto, no se reconoce solo. Si envías desde un exchange con comisión de retiro, asegúrate de que a la billetera le llegue ese monto.'));
        };
        const qa = el('div', { class: 'qa' }, ...[5, 10, 20, 50].map(v => el('button', { type: 'button', class: 'chip', onclick: () => { amount.value = v; } }, v + ' USDT')));
        return el('div', {}, ...mine.map(payCard),
          el('div', { class: 'card' }, el('h3', { style: 'margin:0 0 4px' }, mine.length ? 'Otro depósito' : 'Depositar USDT'),
            el('div', { class: 'steps3' }, el('span', {}, el('b', {}, '1'), ' Monto'), el('span', {}, el('b', {}, '2'), ' Envías'), el('span', {}, el('b', {}, '3'), ' Se abona solo')),
            el('div', { class: 'netrow', style: 'margin:0 0 10px' }, el('span', {}, '🌐 Red BSC (BEP20)'), el('span', {}, '💲 Solo USDT')),
            qa, el('div', { class: 'row' }, amount), el('div', { class: 'acts' }, sendBtn),
            el('div', { class: 'mut', style: 'margin-top:8px' }, 'Te damos un monto único (si pides 5 te toca, por ejemplo, 5.08). Se te abona completo, sin hash ni capturas.'), reqBox));
      }
      return el('div', {},
        card('1. Envía USDT a esta billetera', warn, el('div', { class: 'addr' }, dep.wallet), el('div', { class: 'acts' }, copyBtn)),
        card('2. Avisa tu envío', el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'El admin revisará el pago y te abonará el saldo.'),
          el('div', { class: 'row' }, amount), el('div', { class: 'row', style: 'margin-top:8px' }, note), proof.node, el('div', { class: 'acts' }, sendBtn), reqBox));
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

  const ASIS = !!extra.assistant_of, PAR = !ASIS && extra.assistants > 0;
  const tabs = [['recargar', '⚡', 'Recargar'], ['historial', '🧾', 'Historial'], ['ventas', '📈', 'Ventas'],
    ASIS ? null : ['saldo', '💰', 'Saldo' + (reqs.some(r => r.status === 'pending') ? ' •' : '')], ['cuenta', '👤', 'Cuenta']].filter(Boolean);
  if (!tabs.some(t => t[0] === rtab)) rtab = 'recargar';
  const CUR_NAME = { usdt: 'USDT', transfer: 'Transf.', mobile: 'Saldo móvil' };
  const CUR_IC = { usdt: el('i', { class: 'dl' }, '$'), transfer: el('i', { class: 'ic' }, '🏛️'), mobile: el('i', { class: 'ic' }, '📱') };
  put(out,
    me.maintenance ? (() => {
      const m = String(me.maintenance.msg || '').trim(), short = m.length <= 20;
      return el('div', { class: 'nb maint' }, el('div', { class: 'ni' }, '🛠️'),
        el('div', { class: 'nt' }, el('b', {}, short && m ? m : 'Recargas pausadas'), el('span', {}, short ? 'Las recargas están temporalmente pausadas.' : m)),
        el('div', { class: 'ni w' }, '⚠️'));
    })() : null,
    me.announcement ? (() => {
      const lines = String(me.announcement).split('\n').filter(l => l.trim()), long = lines.length > 2 || me.announcement.length > 140;
      if (!long) return el('div', { class: 'ann static' }, icon('shield', 'shield'), el('span', {}, me.announcement));
      return el('details', { class: 'ann' }, el('summary', {}, icon('shield', 'shield'), el('span', {}, lines[0]), el('em', {}, 'Ver todo')), el('div', { class: 'annb' }, me.announcement));
    })() : null,
    el('div', { class: 'card hero' }, el('div', { class: 'heroh' }, el('span', {}, icon('wallet'), 'Mis saldos'), ASIS ? el('span', { class: 'asistag' }, '🤝 Asistente de ' + extra.assistant_of) : el('button', { onclick: () => { rtab = 'saldo'; resellerView(); } }, icon('plane'), 'Pedir saldo')),
      ASIS && extra.bal_locked ? el('div', { class: 'msg err', style: 'margin:0 0 10px' }, '🔒 Tu saldo está bloqueado por tu revendedor. No puedes hacer recargas hasta que lo desbloquee.') : null,
      el('div', { class: 'bal3' }, ...CURS.map(c => el('div', { class: 't-' + c }, el('span', {}, CUR_IC[c].cloneNode(true), CUR_NAME[c]),
        el('b', {}, c === 'usdt' ? Number(bal[c]).toFixed(2) : Math.round(bal[c]).toLocaleString('es')), el('small', {}, c === 'usdt' ? 'USDT' : 'CUP'))))),
    el('div', { class: 'tabs tabs4' }, ...tabs.map(([k, ic, l]) => el('button', { class: k === rtab ? 'on' : '', onclick: () => { rtab = k; resellerView(); } }, el('span', { class: 'ti' }, ic), l))));

  const cartTotals = () => { const t = { usdt: 0, transfer: 0, mobile: 0 }; for (const i of cart) { const p = byId.get(i.pid); const pr = p ? priceIn(p, i.cur) : null; if (pr != null) t[i.cur] = mulP(pr, 1, i.cur) * i.qty + t[i.cur]; } for (const c of CURS) t[c] = c === 'usdt' ? Math.round(t[c] * 100) / 100 : t[c]; return t; };
  const totText = t => CURS.filter(c => t[c] > 0).map(c => money(t[c], c)).join(' + ') || '—';
  const openCart = () => {
    const m = el('div', { class: 'modal', onclick: e => { if (e.target === m) m.remove(); } }), body = el('div'), note2 = el('div');
    m.append(el('div', { class: 'sheet cartsheet' }, el('div', { class: 'cardh' }, el('h2', {}, '🛒 Tu carrito'), el('button', { class: 'sec sm', onclick: () => m.remove() }, '✕')), body));
    document.body.append(m);
    const draw = () => {
      cart = cart.filter(i => byId.has(i.pid) && priceIn(byId.get(i.pid), i.cur) != null); cartSave(me.username);
      body.replaceChildren();
      if (!cart.length) { put(body, el('div', { class: 'mut', style: 'padding:14px 0' }, 'El carrito está vacío.')); const bb = $('cartbar'); if (bb) bb.remove(); return; }
      const tot = cartTotals(), lack = CURS.filter(c => tot[c] > bal[c]), units = cart.reduce((a, i) => a + i.qty, 0);
      put(body, el('div', { class: 'cartlist' }, ...cart.map(i => { const p = byId.get(i.pid), pr = priceIn(p, i.cur);
        return el('div', { class: 'cartitem' }, gameBadge(p.family, 'sm'),
          el('div', { class: 'ci' }, el('b', {}, shortName(p.name)), el('div', { class: 'mut' }, Object.values(i.target).join(' · ') + ' · ' + CUR_S[i.cur]), el('b', { class: 'pr' }, money(mulP(pr, i.qty, i.cur), i.cur))),
          el('div', { class: 'qstep sm' }, el('button', { type: 'button', class: 'qb', onclick: () => { i.qty--; if (i.qty < 1) cart.splice(cart.indexOf(i), 1); cartSave(me.username); draw(); } }, i.qty > 1 ? '−' : '🗑'), el('b', { class: 'qv' }, String(i.qty)), el('button', { type: 'button', class: 'qb plus', onclick: () => { i.qty = Math.min(50, i.qty + 1); cartSave(me.username); draw(); } }, '+'))); })),
        el('div', { class: 'carttot' }, ...CURS.filter(c => tot[c] > 0).map(c => el('div', { class: tot[c] > bal[c] ? 'low' : '' }, el('span', {}, CUR_ICON[c] + ' ' + CUR_LONG[c]), el('b', {}, money(tot[c], c)), el('small', { class: 'mut' }, 'saldo: ' + money(bal[c], c))))),
        lack.length ? el('div', { class: 'msg err', style: 'margin:8px 0' }, `No te alcanza el saldo ${lack.map(c => CUR_LONG[c]).join(' ni ')}. Quita algo o pide saldo.`) : null,
        note2,
        el('div', { class: 'acts' }, (() => {
          const go = el('button', { class: 'big', disabled: lack.length ? '' : null }, `⚡ Comprar todo · ${units} recarga${units > 1 ? 's' : ''}`);
          go.onclick = async () => {
            if (!confirm(`¿Enviar ${units} recarga${units > 1 ? 's' : ''}?\n\n` + cart.map(i => `${i.qty} × ${byId.get(i.pid).name} → ${Object.values(i.target).join(' · ')}`).join('\n') + `\n\nTotal: ${totText(tot)}`)) return;
            go.disabled = true; let ok = 0, unk = 0, err = null;
            outer: for (const it of [...cart]) while (it.qty > 0) {
              go.textContent = `Enviando ${ok + 1} de ${units}…`;
              try { const d = await api('POST', '/api/orders', { product_id: it.pid, target: it.target, currency: it.cur }); ok++; if (d.status === 'unknown') unk++; it.qty--; cartSave(me.username); }
              catch (e) { err = e.message; break outer; }
            }
            cart = cart.filter(i => i.qty > 0); cartSave(me.username); m.remove();
            flash = err ? [`Se enviaron ${ok} de ${units}. Se detuvo: ${err} Lo que falta sigue en tu carrito.`, 'err']
              : unk ? [`${ok} recargas enviadas. ${unk} no se pudo confirmar todavía: se está verificando, no la repitas.`, 'warn'] : [`✅ ${ok} recarga${ok > 1 ? 's' : ''} enviada${ok > 1 ? 's' : ''}. Se están procesando; el estado se actualiza solo.`, 'ok'];
            resellerView();
          };
          return go; })(), el('button', { class: 'sec', onclick: () => { if (confirm('¿Vaciar el carrito?')) { cart = []; cartSave(me.username); m.remove(); resellerView(); } } }, 'Vaciar')));
    };
    draw();
  };
  if (cart.length) { cart = cart.filter(i => byId.has(i.pid) && priceIn(byId.get(i.pid), i.cur) != null); const units = cart.reduce((a, i) => a + i.qty, 0);
    if (units) put(out, el('div', { class: 'cartbar', id: 'cartbar' }, el('div', {}, el('span', { class: 'mut' }, `${units} recarga${units > 1 ? 's' : ''} en el carrito`), el('b', {}, totText(cartTotals()))), el('button', { class: 'cartbtn', onclick: openCart }, '🛒 Ver carrito'))); }
  if (rtab === 'recargar' && me.maintenance) put(out, el('div', { class: 'pausecard' }, el('div', { class: 'pi' }, el('div', { class: 'dot' }, 'i'), el('div', {}, el('h2', {}, 'Recargas en pausa'), el('p', {}, 'Mientras dure el mantenimiento no se pueden enviar recargas. Tus saldos están seguros y puedes seguir pidiendo saldo.'))), icon('bigshield', 'big-shield')));
  else if (rtab === 'recargar') {
    renderBuy();
    put(out, card('Nueva recarga', buy, box, el('div', { class: 'mut', style: 'margin-top:10px' }, 'Una recarga puede tardar desde minutos hasta un par de horas. No la repitas mientras esté "En proceso": podría llegar dos veces.')));
  }
  if (rtab === 'historial') {
    const isO = hsub === 'recargas', F = isO ? myOrdF : myLedF, base = isO ? '/api/orders' : '/api/ledger';
    const LT = { topup: 'Recarga de saldo', adjust: 'Ajuste', order: 'Compra', refund: 'Reembolso', assist: 'Asistente' };
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
          : [['', 'Todos'], ['topup', 'Recargas de saldo'], ['order', 'Compras'], ['refund', 'Reembolsos'], ['adjust', 'Ajustes'], ['assist', 'Asistentes']], reload, isO ? null : [['', 'Todas las monedas'], ['usdt', 'USDT'], ['transfer', 'CUP transf.'], ['mobile', 'CUP saldo']]),
        cnt, listBox, el('div', { class: 'acts' }, csv)));
    if (hasF(F)) reload(); else draw(isO ? orders : led);
  }
  if (rtab === 'ventas') {
    const sbox = el('div', {}, el('div', { class: 'mut' }, 'Cargando…'));
    put(out, box, card('Mis ventas', sbox));
    api('GET', '/api/stats').then(d => {
      const amt = x => CURS.filter(c => x[c] > 0).map(c => money(x[c], c)).join(' + ') || '—';
      const grid = S => el('div', { class: 'sgrid' }, ...[['today', 'Hoy'], ['yesterday', 'Ayer'], ['week', 'Esta semana'], ['month', 'Este mes']].map(([k, l]) =>
        el('div', { class: 'scell' }, el('span', {}, l), el('b', {}, String(S[k].count)), el('small', {}, S[k].count === 1 ? 'recarga' : 'recargas'), el('em', {}, amt(S[k])))));
      const total = (S, t) => el('div', { class: 'stotal' }, el('span', {}, t), el('b', {}, amt(S.total)), el('small', {}, `${S.total.count} recarga${S.total.count === 1 ? '' : 's'} completada${S.total.count === 1 ? '' : 's'}`));
      sbox.replaceChildren(grid(d.mine), total(d.mine, '💳 Crédito consumido desde que usas la página' + (d.since ? ` (${String(d.since).slice(0, 10)})` : '')),
        d.team ? el('div', { style: 'margin-top:16px' }, el('h2', {}, `🤝 Tus asistentes (${d.team.count})`), grid(d.team.sales), total(d.team.sales, '💳 Consumido por tus asistentes en total')) : null,
        el('div', { class: 'mut', style: 'margin-top:10px' }, 'Cuenta solo las recargas completadas, con el precio que pagaste. Días y semanas en hora de Cuba (la semana empieza el lunes).'));
    }).catch(e => msg(sbox, e.message, 'err'));
  }
  if (rtab === 'saldo' && PAR) {
    const abox = el('div', {}, el('div', { class: 'mut' }, 'Cargando…'));
    const reloadA = () => api('GET', '/api/assistants').then(list => {
      abox.replaceChildren(el('div', { class: 'mut', style: 'margin-bottom:10px' }, 'Pásales saldo de tu crédito o quítaselo. Compran al mismo precio que tú y no pueden pedir saldo por su cuenta.'),
        ...list.map(a => {
          const cur = el('select', { 'aria-label': 'Moneda' }, ...CURS.map(c => el('option', { value: c }, CUR_ICON[c] + ' ' + CUR_LONG[c])));
          const amt = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', placeholder: 'Monto', 'aria-label': 'Monto' }), am = el('div');
          const move = sign => async e => {
            const v = Number(String(amt.value).replace(',', '.')), c = cur.value;
            if (!(v > 0)) return msg(am, 'Escribe un monto mayor que 0.', 'err');
            if (c !== 'usdt' && !Number.isInteger(v)) return msg(am, 'En CUP el monto debe ser entero.', 'err');
            if (!confirm(`¿${sign > 0 ? 'Pasar' : 'Quitar'} ${money(v, c)} ${sign > 0 ? 'a' : 'de'} ${a.username}?`)) return;
            e.target.disabled = true;
            try { await api('POST', '/api/assistants/move', { assistant_id: a.id, currency: c, amount: String(sign * v) }); flash = [`Listo: ${sign > 0 ? 'pasaste' : 'quitaste'} ${money(v, c)} ${sign > 0 ? 'a' : 'de'} ${a.username}.`, 'ok']; resellerView(); }
            catch (err) { msg(am, err.message, 'err'); e.target.disabled = false; }
          };
          return el('div', { class: 'rbox asbox' + (a.bal_locked ? ' off' : '') },
            el('div', { class: 'rhead' }, avatar2(a.username, true), el('div', { style: 'min-width:0;flex:1' }, el('div', { class: 'rname' }, a.username),
              el('div', { class: 'stt ' + (a.bal_locked ? 'off' : 'on') }, a.bal_locked ? '🔒 Saldo bloqueado' : 'Activo'),
              el('div', { class: 'mut' }, `Hoy: ${a.today.count} recarga${a.today.count === 1 ? '' : 's'}` + (a.today.count ? ' · ' + CURS.filter(c => a.today[c] > 0).map(c => money(a.today[c], c)).join(' + ') : '')))),
            el('div', { class: 'tiles tiles2' }, ...CURS.map(c => el('div', { class: 'tile' + ((a.balances[c] || 0) > 0 ? '' : ' zero') }, el('span', {}, CURIC[c](), CURN[c]), el('b', {}, fmtC(a.balances[c], c))))),
            el('div', { class: 'row' }, cur, amt),
            el('div', { class: 'acts' }, el('button', { class: 'grn', onclick: move(1) }, '➕ Agregar'), el('button', { class: 'sec', onclick: move(-1) }, '➖ Quitar'),
              el('button', { class: a.bal_locked ? 'grn' : 'red', onclick: async e => {
                if (!a.bal_locked && !confirm(`¿Bloquear el saldo de ${a.username}? No podrá hacer recargas hasta que lo desbloquees.`)) return;
                e.target.disabled = true; try { await api('POST', '/api/assistants/lock', { assistant_id: a.id, locked: !a.bal_locked }); reloadA(); } catch (err) { msg(am, err.message, 'err'); e.target.disabled = false; } } }, a.bal_locked ? '🔓 Desbloquear' : '🔒 Bloquear saldo')), am);
        }));
    }).catch(e => msg(abox, e.message, 'err'));
    put(out, card('Mis asistentes', abox)); reloadA();
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
          r.status === 'pending' && r.pay_amount ? el('div', { class: 'mut' }, '⏳ Esperando tu envío de ' + r.pay_amount + ' USDT') : null,
          r.status === 'pending' && !r.pay_amount && r.verify === 'wait' ? el('div', { class: 'mut' }, '⏳ ' + (r.verify_msg || 'Confirmando en BSC…')) : null,
          r.status === 'pending' && !r.pay_amount && r.verify !== 'wait' ? el('div', { class: 'mut' }, 'En revisión por el administrador') : null,
          r.admin_note ? el('div', { class: 'mut' }, r.admin_note) : null),
        el('div', { class: 'r' }, el('div', {}, (r.approved ?? r.chain_amount ?? r.amount) == null ? '—' : money(r.approved ?? r.chain_amount ?? r.amount, r.currency)), tag(r.status, REQ))))) : el('div', { class: 'mut' }, 'No has pedido saldo todavía.')));
  }
  if (rtab === 'cuenta') {
    put(out, card('Mi cuenta', el('div', {}, 'Usuario: ', el('b', {}, me.username)), ASIS ? el('div', { class: 'mut', style: 'margin-top:6px' }, '🤝 Eres asistente de ' + extra.assistant_of + '. Él te pasa el saldo.') : null), ASIS ? null : storeCard(extra), googleCard(), telegramCard(extra, resellerView) || card('Avisos por Telegram', el('div', { class: 'mut' }, 'El administrador todavía no activó los avisos por Telegram.')), ...accountCards(false));
  }
  // Refresco automático mientras haya algo en curso, pero sin borrar lo que el revendedor está escribiendo
  if (orders.some(o => ['pending', 'processing', 'unknown'].includes(o.status)) || reqs.some(r => r.status === 'pending')) {
    const tick = () => { if (userBusy()) timer = setTimeout(tick, 10000); else resellerView().catch(() => { timer = setTimeout(tick, 20000); }); };
    timer = setTimeout(tick, rtab === 'saldo' ? 15000 : 10000);
  }
}

/* =================== ADMIN =================== */
/** Pone un icono delante de los títulos de cada tarjeta del panel (solo adorno). */
function decorate(root) {
  const MAP = [['hoy', '📅'], ['saldo en central', '🪙'], ['equipo', '🛡️'], ['sub-admin', '🛡️'], ['pedido', '📦'], ['revendedor', '👥'], ['cat', '🎮'], ['seguridad', '🔒'], ['registro', '📜'], ['ajuste', '⚙️'], ['venta', '📈'], ['fondo', '🏦'], ['cupo', '📊'], ['movimiento', '🕒'], ['usdt', '💲'], ['nuev', '➕'], ['telegram', '✈️'], ['google', '🔑'], ['tienda', '🏪'], ['depósit', '💳'], ['solicitud', '📝'], ['anuncio', '📢'], ['mantenimiento', '🛠️'], ['contraseña', '🔐'], ['cuenta', '👤'], ['ganancia', '💎'], ['reporte', '📈']];
  root.querySelectorAll('.card > h2, .rbox > h2').forEach(h => {
    if (h.querySelector('.h2i') || /^\p{Extended_Pictographic}/u.test(h.textContent.trim())) return;
    const t = h.textContent.toLowerCase(), m = MAP.find(([k]) => t.includes(k)); if (!m) return;
    h.prepend(el('span', { class: 'h2i' }, m[1]));
  });
}
const hue = x => { let h = 0; for (const c of String(x)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const avatar2 = (name, big) => el('div', { class: 'av2' + (big ? ' big' : ''), style: `--h:${hue(name)}` }, String(name).trim().charAt(0).toUpperCase() || '?');
const GAMEIC = [['free fire', '🔥'], ['mobile legends', '⚔️'], ['blood', '🩸'], ['call of duty', '🎯'], ['pubg', '🪖'], ['roblox', '🧱'], ['genshin', '✨'], ['clash', '🏰'], ['brawl', '💥'], ['fortnite', '🛡️'], ['honor', '👑'], ['netflix', '🎬'], ['spotify', '🎵']];
/** Icono de juego (no hay imágenes en el catálogo): color propio por juego + emoji. */
const gameBadge = (name, cls = '') => { const n = String(name).toLowerCase(), g = GAMEIC.find(([k]) => n.includes(k)); return el('div', { class: 'gb ' + cls, style: `--h:${hue(String(name).split(/[-–·]/)[0].trim())}` }, g ? g[1] : '💎'); };
const infoBar = (...kids) => el('div', { class: 'infobar' }, el('span', { class: 'ib' }, '!'), el('div', { class: 'ibt' }, ...kids), el('span', { class: 'brandchip' }, el('img', { src: 'logo.jpg', alt: '' }), el('b', {}, 'SHOP FAST')));
const infoY = (...kids) => el('div', { class: 'infoy' }, el('span', { class: 'ib' }, 'i'), el('div', { class: 'ibt' }, ...kids));
const CURIC = { usdt: () => el('i', { class: 'tcoin' }, '₮'), transfer: () => el('i', { class: 'ic' }, '🏛️'), mobile: () => el('i', { class: 'ic' }, '📱') };
const CURN = { usdt: 'USDT', transfer: 'CUP transf.', mobile: 'CUP SM' };
const fmtC = (v, c) => c === 'usdt' ? Number(v || 0).toFixed(2) : Math.round(v || 0).toLocaleString('es');
let tab = 'resumen', catQuery = '', period = 'day', navOpen = null;
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
  const tabs = OWN ? [['resumen', 'Resumen'], tSaldo, tFondos, tPed, ['reportes', 'Ventas'], tRev, ['catalogo', 'Catálogo'], ['equipo', 'Equipo'], ['registro', 'Registro'], ['seguridad', ME.totp ? '🔒 Seguridad' : '⚠️ Seguridad'], ['ajustes', 'Ajustes']]
    : [can('saldo') && tSaldo, can('saldos') && tFondos, can('pedidos') && tPed, can('revendedores') && tRev, ['cuenta', 'Mi cuenta']].filter(Boolean);
  if (!tabs.some(t => t[0] === tab)) { tab = tabs[0][0]; if (tab === 'cuenta' && can('saldo')) tab = 'saldo'; }
  { // Inicio: botones de 2 en 2. En cada sección: barra con su título y botón de casa para volver al menú.
    const IC = { resumen: '📊', saldo: '💰', fondos: '🏦', pedidos: '📦', reportes: '📈', revendedores: '👥', catalogo: '🎮', equipo: '🧑‍💼', registro: '📜', ajustes: '⚙️', cuenta: '👤' };
    const split = ([k, l]) => IC[k] ? [IC[k], l] : [String(l).split(' ')[0], String(l).split(' ').slice(1).join(' ')];
    const go = k => { tab = k; adminView(); window.scrollTo(0, 0); };
    if (tab === tabs[0][0]) put(out, el('div', { class: 'navgrid' }, ...tabs.map(t => { const [i, l] = split(t); return el('button', { class: t[0] === tab ? 'on' : '', onclick: () => go(t[0]) }, el('span', { class: 'ti' }, i), l); })));
    else { const [ci, cl] = split(tabs.find(t => t[0] === tab) || tabs[0]);
      put(out, el('div', { class: 'secbar' }, el('div', { class: 'st' }, el('span', { class: 'si2' }, ci), el('b', {}, cl)), el('button', { class: 'home', title: 'Menú', onclick: () => go(tabs[0][0]) }, '🏠'))); }
  }
  // Aviso fijo mientras el dueño no tenga la verificación en dos pasos
  if (OWN && !ME.totp && tab === tabs[0][0]) put(out, el('div', { class: 'secban' }, el('div', {}, el('b', {}, '🔒 Protege tu cuenta de dueño'), el('div', { class: 'mut' }, 'Activa la verificación en dos pasos: aunque alguien tenga tu contraseña, no podrá entrar sin tu celular.')),
    el('button', { class: 'sm', onclick: () => { tab = 'seguridad'; adminView(); } }, 'Activar ahora')));
  if (tab === 'seguridad' && OWN) {
    const item = (ok, t, d) => el('div', { class: 'secitem' }, el('span', { class: 'secdot ' + (ok ? 'ok' : 'bad') }, ok ? '✓' : '!'), el('div', {}, el('b', {}, t), el('div', { class: 'mut' }, d)));
    put(out, card('Estado de seguridad', el('div', { class: 'seclist' },
      item(!!ME.totp, 'Verificación en dos pasos', ME.totp ? 'Activa. Para entrar se pide tu contraseña y un código de tu celular.' : 'DESACTIVADA. Actívala abajo con Google Authenticator, Authy o similar.'),
      item(true, 'Bloqueo por intentos fallidos', 'Tras varios intentos fallidos se bloquea el acceso 15 minutos y recibes aviso por Telegram.'),
      item(true, 'Aviso de IP nueva', 'Si entras desde otra conexión, te avisamos por Telegram.'),
      item(true, 'Cerrar sesiones', 'Si crees que alguien entró, abajo puedes cerrar todas las sesiones y cambiar tu contraseña.'))),
      (() => {
        const box = el('div'), btn = el('button', {}, '🔍 Auditar depósitos USDT');
        btn.onclick = async () => {
          btn.disabled = true; btn.textContent = 'Revisando la blockchain…'; box.replaceChildren();
          try {
            const d = await api('GET', '/api/admin/audit-deposits');
            put(box, el('div', { class: 'msg ' + (d.suspicious ? 'err' : 'ok'), style: 'margin:10px 0' }, d.suspicious
              ? `⚠ ${d.suspicious} de ${d.checked} depósitos abonados son sospechosos: ${d.usdt.toFixed(2)} USDT en total.`
              : `✓ Revisados ${d.checked} depósitos abonados: ninguno parece un pago viejo.`),
              d.per_user.length ? el('div', { class: 'list' }, ...d.per_user.map(u => el('div', {}, el('div', { class: 'l' }, el('b', {}, u.user), el('div', { class: 'mut' }, u.count + ' depósito(s) sospechoso(s)')), el('div', { class: 'r' }, el('b', {}, u.usdt.toFixed(2) + ' USDT'))))) : null,
              d.items.length ? el('h3', { style: 'margin:14px 0 6px' }, 'Detalle') : null,
              ...d.items.map(x => el('div', { class: 'msg ' + (x.level === 'high' ? 'err' : 'warn'), style: 'margin:0 0 8px' },
                el('b', {}, `#${x.id} · ${x.user} · ${x.usdt.toFixed(2)} USDT`), el('div', {}, x.level === 'unknown' ? 'No se pudo leer la fecha del pago.' : `El pago es de ${x.tx_at}, ${x.age_h} h ANTES de la solicitud (${x.requested_at}).`),
                el('div', { class: 'mut' }, (x.auto ? 'Abonado automáticamente · ' : 'Aprobado a mano · ') + (x.user_created ? 'cuenta creada ' + x.user_created : '')),
                el('a', { href: 'https://bscscan.com/tx/' + x.tx, target: '_blank', rel: 'noopener' }, 'Ver en BscScan'))));
          } catch (e) { msg(box, e.message, 'err'); }
          btn.disabled = false; btn.textContent = '🔍 Auditar depósitos USDT';
        };
        return card('Auditar depósitos USDT', el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Compara la fecha real de cada pago en la blockchain con la fecha de la solicitud. Un pago muy anterior a su solicitud suele ser un hash viejo reclamado por otra persona. Revisa los últimos 300 depósitos abonados.'), el('div', { class: 'acts' }, btn), box);
      })(),
      ...accountCards(true));
  }
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
        return card('Registro de revendedores', el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Tus revendedores pueden crearse una cuenta con su correo en ' + location.origin + '. Las cuentas nuevas nacen con el margen general de arriba (' + S.default_markup + '%).'),
          el('div', { class: 'row' }, mode),
          el('div', { class: 'acts' }, act('Guardar', () => api('POST', '/api/admin/settings', { registration: mode.value }), '')));
      })(),
      (() => {
        const w = el('input', { type: 'url', inputmode: 'url', placeholder: 'https://wa.me/53XXXXXXXX o https://whatsapp.com/channel/…', value: st.settings.whatsapp_url || '', 'aria-label': 'Enlace de WhatsApp' });
        return card('Botón de WhatsApp', el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Sale como un botón flotante en toda la web (también en la pantalla de entrada). Pon el enlace de tu canal, grupo o número. Déjalo vacío para quitarlo.'), w,
          el('div', { class: 'acts' }, act('Guardar', async () => { await api('POST', '/api/admin/settings', { whatsapp_url: w.value.trim() }); paintWhatsApp(w.value.trim()); }, ''),
            st.settings.whatsapp_url ? act('Quitar', async () => { await api('POST', '/api/admin/settings', { whatsapp_url: '' }); paintWhatsApp(''); }, 'red') : null));
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
    const [dep, unmatched] = await Promise.all([api('GET', '/api/deposit-info'), api('GET', '/api/admin/usdt-unmatched').catch(() => [])]);
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
        const v = VER[r.verify] || VER.manual;
        const show = r.approved ?? r.chain_amount ?? r.amount;
        const mLabel = METHOD_L[r.method] || 'USDT';
        return el('div', { style: 'display:block' },
          el('div', { style: 'display:flex;justify-content:space-between;gap:8px' },
            el('div', { class: 'l' }, el('div', {}, `${r.username} · #${r.id} · ${mLabel}`), el('div', { class: 'mut' }, r.created_at + (r.note ? ' · ' + r.note : '')),
              r.tx_hash ? el('div', { class: 'mut' }, el('a', { href: 'https://bscscan.com/tx/' + r.tx_hash, target: '_blank', rel: 'noopener' }, 'Ver en BscScan: ' + r.tx_hash.slice(0, 12) + '…')) : null,
              r.chain_from ? el('div', { class: 'mut' }, 'Desde ' + r.chain_from.slice(0, 8) + '…' + r.chain_from.slice(-6) + '') : null,
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
              await api('POST', '/api/admin/topup-decide', { id: r.id, approve: true, amount: a.replace(',', '.') });
            }, ''),
            r.tx_hash && dep.auto ? act('Verificar otra vez', () => api('POST', '/api/admin/topup-recheck', { id: r.id })) : null,
            act('Rechazar', async () => {
              const m = prompt('Motivo (lo verá el revendedor):', ''); if (m === null) throw new Error('Cancelado');
              await api('POST', '/api/admin/topup-decide', { id: r.id, approve: false, note: m });
            }, 'red'),
            act('⛔ Rechazar y bloquear', async () => {
              if (!confirm(`¿Rechazar TODAS las solicitudes pendientes de ${r.username} y bloquear sus depósitos?\n\nNo podrá pedir más saldo hasta que tú se lo permitas (pestaña Revendedores).`)) throw new Error('Cancelado');
              await api('POST', '/api/admin/topup-decide', { id: r.id, approve: false, block: true, note: 'Depósitos bloqueados' });
            }, 'sec')) : null);
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
      card('Solicitudes de saldo', el('div', { class: 'mut' }, 'Los pagos USDT con monto exacto se abonan solos. Aquí revisas las transferencias CUP y saldo móvil.' + (OWN ? '' : ` Tu límite por aprobación: ${limLine(ME.perms, 'max_')}.`)),
      el('div', { class: 'acts', style: 'margin:8px 0' }, act('🧹 Limpiar spam', async () => {
        if (!confirm('Se rechazarán todos los pagos USDT que llevan más de 30 minutos esperando y son de cuentas que NUNCA han tenido un pago aprobado.\n\nNo toca a clientes que ya te han pagado antes. ¿Seguir?')) throw new Error('Cancelado');
        const d = await api('POST', '/api/admin/topup-reject-spam', {});
        alert(d.rejected ? `Se rechazaron ${d.rejected} solicitud${d.rejected === 1 ? '' : 'es'} de ${d.users} cuenta${d.users === 1 ? '' : 's'}.` : 'No había solicitudes para limpiar.');
      }, 'sec')),
      reqFilters, reqCnt, reqBox),
      unmatched.length ? card('❔ Pagos USDT sin identificar', el('div', { class: 'mut', style: 'margin-bottom:8px' }, 'Llegaron a tu billetera pero no coinciden con ningún pago pedido (monto distinto, sin solicitud…). Si el dueño es un cliente, pídele su comprobante y abónale a mano.'),
        el('div', { class: 'list' }, ...unmatched.slice(0, 15).map(x => el('div', {}, el('div', { class: 'l' }, el('div', {}, x.usdt.toFixed(4) + ' USDT'),
          el('div', { class: 'mut addr-s' }, 'desde ' + x.from), el('div', { class: 'mut' }, new Date(x.at).toLocaleString('es'))),
          el('div', { class: 'r' }, el('a', { href: 'https://bscscan.com/tx/' + x.tx, target: '_blank', rel: 'noopener' }, 'BscScan')))))) : null,
      null);
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
      el('div', { class: 'row catsearch' }, q, el('button', { onclick: () => { catQuery = q.value; adminView(); } }, '🔍 Buscar'),
        el('button', { class: 'sec wide', onclick: async () => { try { const r = await api('POST', '/api/admin/catalog-sync', {}); msg(note, `Catálogo actualizado: ${r.count} productos.`, 'ok'); setTimeout(adminView, 800); } catch (e) { msg(note, e.message, 'err'); } } }, '🔄 Actualizar catálogo')),
      el('div', { class: 'mut' }, `${cat.length} productos en ${fams.size} juegos. "Por ID" se puede vender; "Código" (gift card/PIN) todavía no.`), note,
      el('div', { style: 'margin-top:10px' }, ...[...fams].map(([f, items]) => {
        const byIdItems = items.filter(i => i.requires_target), on = byIdItems.filter(i => i.enabled).length;
        return el('details', { class: 'fam', open: catQuery ? '' : null },
          el('summary', {}, gameBadge(f, 'sm'), el('span', { class: 'fn' }, f, el('div', { class: 'mut', style: 'font-weight:400' }, `${byIdItems.length} por ID · ${items.length - byIdItems.length} con código`)),
            on ? el('span', { class: 'tag id' }, 'Activos: ' + on) : null, el('span', { class: 'chev' }, '›')),
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
                el('div', { class: 'list plist' }, ...vi.map(c => el('div', {},
                  el('span', { class: 'dm' }, '💎'),
                  el('div', { class: 'l' }, el('div', {}, shortName(c.name)), el('div', { class: c.in_stock ? 'okt' : 'badt' }, c.in_stock ? '✔ Disponible' : '✖ Agotado'), c.fields ? el('div', { class: 'mut' }, 'pide: ' + c.fields) : null),
                  c.price === null ? null : el('b', { class: 'pr' }, Number(c.price).toFixed(2) + ' USDT'),
                  el('div', { class: 'r' }, !c.requires_target ? el('span', { class: 'tag code' }, 'Código')
                    : c.enabled ? act('Quitar', () => api('POST', '/api/admin/product-update', { id: c.local_id, active: false }), 'red')
                      : act('🛒 Vender', () => api('POST', '/api/admin/products', { product_id: c.product_id }), ''))))));
            })));
      })),
      cat.length ? null : el('div', { class: 'mut' }, 'No hay productos. Pulsa "Actualizar" o revisa que tu llave tenga el permiso catalog:read.')));
    const mine = groupBy(prods.filter(p => p.active), p => p.family + ' · ' + regLabel(p.variant));
    put(out, card('Lo que ven tus revendedores', mine.size ? el('div', {}, ...[...mine].map(([f, ps]) => el('div', {}, el('h3', {}, f),
      el('div', { class: 'list pcards' }, ...ps.map(p => el('div', {},
        gameBadge(f, 'sm'),
        el('div', { class: 'l' }, el('div', {}, p.name), el('b', { class: 'pr' }, p.cost === null ? 'fuera del catálogo' : Number(p.cost).toFixed(2) + ' USDT'), el('div', { class: p.in_stock ? 'okt' : 'badt' }, p.cost === null ? '' : p.in_stock ? '✔ Disponible' : '✖ Agotado')),
        el('div', { class: 'r' }, act('Tipo: ' + PTYPES.find(([k]) => k === typeOf(p))[1], async () => { const a = prompt('Tipo de oferta: diamantes, pases, membresias u otros.\nDéjalo vacío para que se detecte solo por el nombre:', p.ptype || ''); if (a === null) throw new Error('Cancelado'); await api('POST', '/api/admin/product-update', { id: p.id, ptype: a.trim().toLowerCase() }); }), act('Renombrar', async () => { const a = prompt('Nombre que verán tus revendedores:', p.name); if (a) await api('POST', '/api/admin/product-update', { id: p.id, name: a }); }))))))))
      : el('div', { class: 'mut' }, 'Todavía no vendes nada. Abre un juego arriba y pulsa "Vender todos por ID".')),
      infoY(el('b', {}, 'Solo se pueden vender productos por ID.'), ' Los productos de tarjetas de regalo (PIN) aún no están disponibles.'));
  }

  if (tab === 'revendedores') {
    const defM = OWN ? Number(st.settings.default_markup ?? 10) : 0;
    const nu = { u: el('input', { placeholder: 'Usuario', autocomplete: 'off', 'aria-label': 'Usuario' }), p: el('input', { placeholder: 'Contraseña (8+)', type: 'password', autocomplete: 'new-password', 'aria-label': 'Contraseña' }),
      m: el('input', { placeholder: 'Margen %', type: 'number', inputmode: 'decimal', step: 'any', value: String(defM), 'aria-label': 'Margen %' }),
      par: el('select', { 'aria-label': 'Tipo de cuenta' }, el('option', { value: '' }, 'Revendedor normal'), ...users.filter(u => !u.parent_id && !u.pending).map(u => el('option', { value: String(u.id) }, '🤝 Asistente de ' + u.username))) };
    const create = el('button', {}, 'Crear cuenta');
    create.onclick = async () => {
      try { await api('POST', '/api/admin/users', { username: nu.u.value, password: nu.p.value, markup_pct: nu.m.value.replace(',', '.'), parent_id: OWN && nu.par.value ? Number(nu.par.value) : undefined }); adminView(); }
      catch (e) { msg(note, e.message, 'err'); }
    };
    const usersBox = el('div');
    const balOf = u => u.balances || { usdt: u.balance };
    const hasBal = u => CURS.some(c => (balOf(u)[c] || 0) > 0);
    const matchU = r => !userQuery.trim() || String(r.username).toLowerCase().includes(userQuery.trim().toLowerCase());
    const FILT = { all: () => true, bal: hasBal, nobal: u => !hasBal(u), off: u => !u.active };
    const FL = [['all', '👥 Todos'], ['bal', '✅ Con saldo'], ['nobal', '❌ Sin saldo'], ['off', '🚫 Desactivados']];
    /** Una tarjeta por revendedor: quién es, cuánto tiene en cada saldo y las acciones, sin amontonar botones. */
    const rbox = r => {
      const b = balOf(r);
      return el('div', { class: 'rbox' + (r.active ? '' : ' off') },
        el('div', { class: 'rhead' }, avatar2(r.username, true),
          el('div', { style: 'min-width:0;flex:1' }, el('div', { class: 'rname' }, r.username), el('div', { class: 'stt ' + (r.active ? 'on' : 'off') }, r.active ? 'Activo' : 'Desactivado'),
            el('div', { class: 'tags' }, r.parent ? el('span', { class: 'tag asis' }, '🤝 Asistente de ' + r.parent) : null, r.assistants ? el('span', { class: 'tag asis' }, `👥 ${r.assistants} asistente${r.assistants === 1 ? '' : 's'}`) : null, r.bal_locked ? el('span', { class: 'tag off' }, '🔒 Saldo bloqueado') : null, r.deposit_block ? el('span', { class: 'tag off' }, '⛔ Depósitos bloqueados') : null,
              OWN && !r.parent ? el('span', { class: 'tag ' + (r.markup_manual ? 'manual' : 'auto') }, `Margen ${r.markup_pct}% · ${r.markup_manual ? '🔒 manual' : 'general'}`) : null,
              null))),
        el('div', { class: 'tiles tiles2' }, ...CURS.map(c => el('div', { class: 'tile' + ((b[c] || 0) > 0 ? '' : ' zero') }, el('span', {}, CURIC[c](), CURN[c]),
          el('b', {}, fmtC(b[c], c))))),
        el('div', { class: 'acts', style: 'margin-top:0' },
          can('ajustar') ? act('± Agregar / quitar saldo', () => adjust(r), '') : null,
          act(r.deposit_block ? '✔ Permitir depósitos' : '⛔ Bloquear depósitos', () => api('POST', '/api/admin/user-update', { user_id: r.id, deposit_block: !r.deposit_block }), 'sec'),
          act(r.active ? '🚫 Desactivar' : '✔ Activar', () => api('POST', '/api/admin/user-update', { user_id: r.id, active: !r.active }), r.active ? 'sec' : 'grn')),
        OWN ? el('details', { class: 'regd', style: 'margin:10px 0 0' }, el('summary', {}, el('b', {}, 'Más opciones'), el('span', { class: 'chev', style: 'margin-left:auto' }, '›')),
          el('div', { class: 'acts', style: 'margin:0 0 10px' },
            act('Cambiar margen', async () => { const a = prompt(`Margen % para ${r.username}.\nQuedará como MANUAL 🔒: el cambio general ya no lo toca.`, r.markup_pct); if (a !== null && a.trim() !== '') await api('POST', '/api/admin/user-update', { user_id: r.id, markup_pct: a.replace(',', '.') }); }),
            r.markup_manual ? act('Margen: volver a automático', () => api('POST', '/api/admin/user-update', { user_id: r.id, markup_auto: true })) : null,
            act('Cambiar clave', async () => { const a = prompt('Nueva contraseña (8+):'); if (a) await api('POST', '/api/admin/user-update', { user_id: r.id, password: a }); }),
            r.parent ? act('Quitar de asistente', async () => { if (!confirm(`${r.username} dejará de ser asistente de ${r.parent} y será un revendedor normal (con su propio margen y pidiendo saldo). ¿Seguir?`)) throw new Error('Cancelado'); await api('POST', '/api/admin/user-update', { user_id: r.id, parent_id: 0 }); })
              : r.assistants ? null : act('🤝 Hacer asistente de…', async () => {
                const opts = users.filter(u => !u.parent_id && !u.pending && u.id !== r.id);
                const a = prompt(`¿De qué revendedor será asistente ${r.username}? Escribe su usuario o correo:\n\n` + opts.slice(0, 15).map(u => '• ' + u.username).join('\n'));
                if (a === null || !a.trim()) throw new Error('Cancelado');
                const p = opts.find(u => u.username.toLowerCase() === a.trim().toLowerCase()); if (!p) throw new Error('No encontré ese revendedor.');
                await api('POST', '/api/admin/user-update', { user_id: r.id, parent_id: p.id });
              }))) : null);
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
    put(out, el('details', { class: 'card newrev', open: users.length ? null : '' }, el('summary', {}, el('h2', { style: 'margin:0' }, '➕ Nuevo revendedor'), el('span', { class: 'chev', style: 'margin-left:auto' }, '›')),
      el('div', { style: 'margin-top:12px' }, el('div', { class: 'row' }, nu.u, nu.p),
        OWN ? el('div', { class: 'row' }, el('label', { class: 'fld' }, `Margen % (general: ${defM}%)`, nu.m)) : null,
        OWN ? el('div', { class: 'row' }, el('label', { class: 'fld' }, 'Tipo de cuenta (un asistente compra al precio de su revendedor y recibe saldo solo de él)', nu.par)) : null,
        el('div', { class: 'acts' }, create),
        el('div', { class: 'mut', style: 'margin-top:8px' }, OWN ? `Precio para él = costo de Central One + su margen %. Si dejas el margen general (${defM}%), la cuenta sigue los cambios generales; si pones otro, queda como manual 🔒.` : 'La cuenta se crea con el margen general que puso el dueño.'), note)),
      searchBar, usersBox, infoBar('Puedes crear revendedores con diferentes márgenes y gestionar sus saldos de forma rápida y segura.'));
    renderUsers();
  }

  if (tab === 'pedidos') {
    const box = el('div'), cnt = el('div', { class: 'mut', style: 'margin:6px 0' }), foot = el('div', { class: 'ofoot' });
    const row = o => el('div', { class: 'ocard ' + o.status },
      el('div', { class: 'otop' }, gameBadge(o.product_name),
        el('div', { class: 'oinfo' }, el('div', { class: 'on' }, o.product_name), el('div', { class: 'op' }, 'Pedido: ', el('b', {}, '#' + o.id)),
          el('div', {}, '👤 Revendedor: ' + o.username), el('div', {}, '🎮 ID: ' + o.target), el('div', {}, '📅 ' + o.created_at)),
        el('div', { class: 'ost' }, tag(o.status))),
      el('div', { class: 'omid' },
        el('div', { class: 'ocell' }, el('span', { class: 'mut' }, 'Referencia:'), o.reference_code ? el('code', { class: 'ref' }, o.reference_code) : el('span', { class: 'mut' }, '—')),
        el('div', { class: 'ocell' }, el('span', { class: 'mut' }, 'Pagado:'), el('b', { class: 'paid' }, ((o.currency || 'usdt') === 'usdt' ? '₮ ' : '') + money(o.paid ?? o.price, o.currency))),
        OWN ? el('div', { class: 'gana' }, el('span', {}, '👑 Gana'), el('b', {}, Number(o.margin).toFixed(2) + ' USDT')) : null),
      o.detail ? el('div', { class: 'mut', style: 'margin-top:8px' }, o.detail) : null,
      o.status === 'unknown' ? el('div', { class: 'acts oacts' },
        act('🔄 Reintentar (seguro)', () => api('POST', '/api/admin/retry', { order_id: o.id })),
        act('✔ Sí llegó', () => api('POST', '/api/admin/resolve', { order_id: o.id, outcome: 'completed' }), 'grn'),
        act('✖ No llegó (reembolsar)', () => api('POST', '/api/admin/resolve', { order_id: o.id, outcome: 'failed' }), 'red')) : null);
    const draw = list => {
      cnt.textContent = `${list.length} pedido${list.length === 1 ? '' : 's'}` + (list.length >= 300 ? ' (los 300 más recientes: afina el filtro para ver otros)' : '');
      box.replaceChildren(list.length ? el('div', { class: 'ocards' }, ...list.map(row)) : el('div', { class: 'mut' }, hasF(ordF) ? 'Ningún pedido coincide con ese filtro.' : 'Sin pedidos todavía.'));
      const gain = list.filter(o => o.status === 'completed').reduce((a, o) => a + Number(o.margin || 0), 0);
      foot.replaceChildren(el('span', {}, '📊 Total de pedidos: ', el('b', {}, String(list.length))), OWN ? el('span', {}, '👑 Ganancias: ', el('b', { class: 'gn' }, gain.toFixed(2) + ' USDT')) : null);
    };
    const reload = async () => { box.replaceChildren(el('div', { class: 'mut' }, 'Buscando…')); try { draw(await api('GET', '/api/admin/orders?' + qs({ ...ordF, limit: 300 }))); } catch (e) { msg(box, e.message, 'err'); } };
    put(out, infoY('Los pedidos ', el('b', {}, 'Verificando'), ' necesitan revisión en Central One con la referencia.'),
      card('', filterBar(ordF, [['', '▦ Todos'], ['unknown', '🕑 Para revisar'], ['active', '⏳ En proceso'], ['completed', '✅ Completados'], ['failed', '❌ Fallidos']], reload), cnt, box), foot);
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
        list.length ? el('div', { class: 'frows' }, ...list.map(r => el('div', { class: 'frow' + (r.active ? '' : ' off') },
          el('div', { class: 'fwho' }, avatar2(r.username), el('div', { style: 'min-width:0' }, el('div', { class: 'rname' }, r.username), el('div', { class: 'stt ' + (r.pending ? 'pend' : r.active ? 'on' : 'off') }, r.pending ? 'Pendiente' : r.active ? 'Activo' : 'Desactivado'))),
          can('ajustar') ? act('± Saldo', () => adjust(r), '') : null,
          el('div', { class: 'fbal' }, ...CURS.map(c => el('div', { class: r.balances[c] > 0 ? '' : 'zero' }, el('span', {}, CURIC[c](), CURN[c]), el('b', {}, fmtC(r.balances[c], c))))))))
          : el('div', { class: 'mut' }, 'Ningún revendedor coincide.'));
    };
    const sq = el('input', { type: 'search', placeholder: 'Buscar revendedor…', autocomplete: 'off', 'aria-label': 'Buscar revendedor' });
    sq.addEventListener('input', () => { fq = sq.value; drawRows(); });
    const P = f.provider, vend = f.totals.usdt;
    put(out,
      P ? el('div', { class: 'card fhero' }, el('div', { class: 'bigcoin' }, '₮'),
          el('div', { class: 'fh' }, el('div', { class: 'fhl' }, 'Saldo en Central One'), el('div', { class: 'fhv' }, usd(P.available)),
            P.held != null ? el('span', { class: 'fhp' }, '✓ En pedidos: ' + usd(P.held)) : null,
            el('div', { class: 'mut', style: 'margin-top:6px;font-size:.78rem' }, P.live ? 'en vivo' : 'último dato conocido' + (P.at ? ' (' + P.at + ' UTC)' : ''))), icon('wallet', 'fw'))
        : card('Saldo en Central One', el('div', { class: 'mut' }, f.provider_error || 'Todavía no hay dato del saldo de Central One.')),
      P && Number(P.available) < vend ? el('div', { class: 'msg err' }, 'Tus revendedores tienen más USDT que lo que hay en Central One: si todos compraran a la vez, no alcanzaría.') : null,
      card('Lo que tienen tus revendedores', el('div', { class: 'stats stats3' }, ...CURS.map(c => el('div', { class: 'stat sc' }, el('span', { class: 'mut' }, CURIC[c](), ({ usdt: 'USDT', transfer: 'CUP transf.', mobile: 'CUP saldo' })[c]), el('b', {}, fmtC(f.totals[c], c) + (c === 'usdt' ? '' : ' CUP')), el('span', { class: 'mut' }, `(${f.with_balance[c]} de ${f.count} con saldo)`)))),
        P ? el('div', { class: 'mut', style: 'margin-top:10px' }, `USDT de revendedores: ${usdt(vend)} · en Central One: ${usdt(P.available)}.`) : null),
      el('div', { class: 'card' }, el('div', { class: 'cardh' }, el('h2', {}, '👤➕ Saldo por revendedor'), el('button', { class: 'sec sm', onclick: () => adminView() }, '🔄 Actualizar')),
        el('div', { class: 'search' }, el('span', { class: 'lupa', 'aria-hidden': 'true' }, '🔍'), sq), sortBox, rowsBox),
      OWN ? card('Límites de tus sub-administradores', staff.length ? el('div', {}, ...staff.map(m => el('div', { class: 'lim' },
        el('div', { class: 'limh' }, avatar2(m.username), el('b', {}, m.username), m.active ? null : el('span', { class: 'tag off' }, 'Desactivado')),
        el('div', { class: 'lim3' },
          el('div', {}, el('span', {}, '✅ Límite de aprobaciones'), el('b', {}, m.perms.saldo ? 'Hasta ' + limLine(m.perms, 'max_') : 'Sin permiso')),
          el('div', {}, el('span', {}, '⚙️ Ajustes manuales'), el('b', {}, m.perms.ajustar ? 'Hasta ' + limLine(m.perms, 'max_adj_') : 'Sin permiso')),
          el('div', {}, el('span', {}, '🔐 Verificación 2FA'), el('b', {}, m.totp ? 'Activa' : 'No activa'))),
        m.perms.ajustar ? quotaBlock(m.quota) : null,
        el('div', { class: 'mut limp' }, '🔒 Permisos: ' + ([m.perms.saldo && 'aprobar pagos', m.perms.ajustar && 'ajustar saldos', m.perms.saldos && 'ver fondos', m.perms.pedidos && 'pedidos', m.perms.revendedores && 'revendedores'].filter(Boolean).join(', ') || 'ninguno'))))
        , el('div', { class: 'acts' }, el('button', { class: 'sec sm', onclick: () => { tab = 'equipo'; adminView(); } }, 'Cambiar límites en Equipo')))
        : el('div', { class: 'mut' }, 'Todavía no tienes sub-administradores.')) : null,
      infoBar('Mantén tus saldos actualizados y controla el estado de tus revendedores.'));
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
          el('div', { class: 'limh' }, avatar2(m.username, true), el('div', { style: 'flex:1;min-width:0' }, el('b', {}, m.username), el('div', { class: 'stt ' + (m.active ? 'on' : 'off') }, m.active ? 'Activo' : 'Desactivado')), act('🔄 Restablecer cupo', () => resetQuota(m), 'sec')),
          el('div', { class: 'tiles tiles2' }, ...CURS.map(c => el('div', { class: 'tile' }, el('span', {}, CURIC[c](), CURN[c]), el('b', {}, fmtC(m.quota[c].left, c)), el('span', { class: 'mut' }, 'quedan')))),
          quotaBlock(m.quota),
          el('details', { class: 'regd', style: 'margin-top:10px' }, el('summary', {}, el('b', {}, `Desglose por revendedor (${m.resellers.length})`), el('span', { class: 'chev', style: 'margin-left:auto' }, '›')),
            el('div', { class: 'mut', style: 'margin-bottom:6px' }, `Desde ${m.since} UTC · formato: +agregó / −quitó`),
            m.resellers.length ? el('div', { class: 'list' }, ...m.resellers.map(x => el('div', { style: 'display:block' }, el('b', {}, x.username),
              el('div', { class: 'mut' }, [flow(x.usdt, 'usdt'), flow(x.transfer, 'transfer'), flow(x.mobile, 'mobile')].filter(Boolean).join('  ·  ')), el('div', { class: 'mut', style: 'font-size:.76rem' }, 'Último movimiento: ' + (x.last || '—') + ' UTC'))))
              : el('div', { class: 'mut', style: 'padding-bottom:10px' }, 'No ha movido saldo a mano desde el último restablecimiento.'),
            (m.approved.usdt || m.approved.transfer || m.approved.mobile) ? el('div', { class: 'mut', style: 'margin:8px 0 10px' }, `Además aprobó solicitudes de saldo por: ${[flow({ add: m.approved.usdt, rem: 0 }, 'usdt'), flow({ add: m.approved.transfer, rem: 0 }, 'transfer'), flow({ add: m.approved.mobile, rem: 0 }, 'mobile')].filter(Boolean).map(s => s.replace(' / −0.00', '').replace(' / −0', '')).join('  ·  ')} (esto no gasta el cupo).`) : null))))
          : el('div', { class: 'mut' }, 'Ningún sub-administrador tiene el permiso "Ajustar saldo a mano". Actívalo abajo en su ficha.')),
      card('Últimos movimientos del equipo', team.recent.length ? el('div', { class: 'tscroll' }, el('table', { class: 'ntab' },
        el('thead', {}, el('tr', {}, ...['Fecha', 'Usuario', 'Tipo', 'Receptor', 'Monto'].map(h => el('th', {}, h)))),
        el('tbody', {}, ...team.recent.slice(0, 20).map(r => el('tr', {}, el('td', {}, r.at), el('td', {}, el('b', {}, r.by)),
          el('td', {}, el('span', { class: 'tp ' + (r.kind === 'approval' ? 'ap' : r.amount >= 0 ? 'ad' : 'rm') }, r.kind === 'approval' ? '✔ Aprobó' : r.amount >= 0 ? '➕ Añadió' : '➖ Retiró')),
          el('td', {}, r.reseller), el('td', { class: r.amount >= 0 ? 'pos' : 'neg' }, (r.amount >= 0 ? '+' : '−') + money(Math.abs(r.amount), r.currency))))))) : el('div', { class: 'mut' }, 'Todavía no han movido saldo.'),
        el('div', { class: 'acts' }, el('button', { class: 'sec sm', onclick: () => { auditCat = 'money'; tab = 'registro'; adminView(); } }, 'Ver todo en Registro'))),
      sect('Sub-administradores'),
      card('Nuevo sub-administrador', el('div', { class: 'mut', style: 'margin-bottom:10px' }, 'Un ayudante con acceso limitado. Todo lo que haga queda en la pestaña Registro.'),
        el('div', { class: 'row' }, nu.u, nu.p), ed.node, el('div', { class: 'acts' }, nb), nm),
      card('Tu equipo', staff.length ? el('div', { class: 'tscroll' }, el('table', { class: 'ntab' },
        el('thead', {}, el('tr', {}, ...['Usuario', 'Último acceso', 'Permisos', '2FA'].map(h => el('th', {}, h)))),
        el('tbody', {}, ...staff.map(m => el('tr', {}, el('td', {}, el('div', { class: 'tu' }, avatar2(m.username), el('b', {}, m.username))), el('td', {}, m.last_login || 'nunca'),
          el('td', {}, ...PL.filter(([k]) => m.perms[k]).map(([, t]) => el('span', { class: 'tp pm' }, t.split(' ')[0]))), el('td', {}, m.totp ? el('span', { class: 'okt' }, '✔ Sí') : el('span', { class: 'badt' }, '✖ No'))))))) : null,
        el('h3', {}, 'Gestionar'), staff.length ? el('div', { class: 'list' }, ...staff.map(m => {
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
      infoY(el('b', {}, 'Qué NO puede hacer nunca un sub-administrador: '), 'Ver costos, ganancias, ventas o reportes · tocar el catálogo, los precios o los ajustes · ajustar saldos a mano más allá de su permiso, tope y cupo · cambiar márgenes (general o de una cuenta) o contraseñas de revendedores · confiar en billeteras · descargar respaldos · ver el registro o crear otros sub-admins. Si intenta algo que no puede, queda anotado como \"Negado\".'),
      (() => {
        const bx = el('input', { type: 'checkbox', class: 'sw' }); bx.checked = !!Number(st.settings.require_2fa || 0);
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

  decorate(out);
  if (orders.some(o => ['pending', 'processing'].includes(o.status)) && ['resumen', 'pedidos'].includes(tab) || (tab === 'saldo' && reqs.some(r => r.status === 'pending' && r.verify === 'wait'))) {
    // el admin tiene campos ya rellenos: solo se pausa si está escribiendo, mirando una foto o con una ventana abierta
    const busy = () => { const a = document.activeElement; return (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || Date.now() - lastTyping < 60000 || !!document.querySelector('.zoom, img.proof, .modal'); };
    const tick = () => { if (busy()) timer = setTimeout(tick, 10000); else adminView().catch(() => { timer = setTimeout(tick, 20000); }); };
    timer = setTimeout(tick, 10000);
  }
}
boot();
