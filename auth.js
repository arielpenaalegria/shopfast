'use strict';
const crypto = require('node:crypto');
const { C } = require('./db');

const SECRET = process.env.SESSION_SECRET || '';
if (SECRET.length < 32) {
  console.error('ERROR: SESSION_SECRET debe tener al menos 32 caracteres (ver .env.example).');
  process.exit(1);
}
const COOKIE = 'sid';
const TTL_MS = 12 * 3600 * 1000;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return salt.toString('hex') + ':' + h.toString('hex');
}
function verifyPassword(pw, stored) {
  const [s, h] = stored.split(':');
  const calc = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
  return crypto.timingSafeEqual(calc, Buffer.from(h, 'hex'));
}
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');

// La sesión lleva la "versión" (sv) de la cuenta: al subirla (cambio de clave, "cerrar todas las sesiones", etc.) todas las cookies anteriores dejan de valer.
function makeSession(userId, sv = 0) {
  const payload = `${userId}.${Date.now() + TTL_MS}.${sv}`;
  return `${payload}.${sign(payload)}`;
}
async function readSession(req) {
  const m = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 3 && parts.length !== 4) return null;   // 3 = cookie vieja (sv 0)
  const payload = parts.slice(0, -1).join('.');
  const a = Buffer.from(sign(payload)), b = Buffer.from(parts[parts.length - 1]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(parts[1]) < Date.now()) return null;
  const sv = parts.length === 4 ? Number(parts[2]) : 0;
  const d = await C.users.findOne({ _id: Number(parts[0]) });
  if (!d || !d.active || (d.sv || 0) !== sv) return null;
  return { id: d._id, username: d.username, role: d.role, perms: d.perms || null, sv, totp_on: !!d.totp_on, balance_cents: d.balance_cents, bal_transfer_cents: d.bal_transfer_cents || 0, bal_mobile_cents: d.bal_mobile_cents || 0, markup_pct: d.markup_pct, min_margin_cents: d.min_margin_cents || 0, active: d.active,
    adj_used_usdt_c: d.adj_used_usdt_c || 0, adj_used_cup_c: d.adj_used_cup_c || 0, quota_reset_at: d.quota_reset_at || null };
}

// ---------- Verificación en dos pasos (TOTP, RFC 6238: la que usan Google Authenticator, Authy, etc.) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32enc = buf => { let bits = '', out = ''; for (const x of buf) bits += x.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out; };
const b32dec = str => { let bits = ''; for (const c of String(str).replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(c); if (i >= 0) bits += i.toString(2).padStart(5, '0'); } const by = []; for (let i = 0; i + 8 <= bits.length; i += 8) by.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(by); };
function hotp(key, counter) {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(b).digest(), o = h[19] & 15;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000).padStart(6, '0');
}
const newSecret = () => b32enc(crypto.randomBytes(20));
/** Devuelve el paso de 30 s en que el código es válido (±1 paso) o null. lastStep evita reutilizar un código ya usado. */
function totpCheck(secret, code, lastStep = 0) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const key = b32dec(secret), cur = Math.floor(Date.now() / 30000);
  for (let d = -1; d <= 1; d++) { const st = cur + d; if (st > lastStep && crypto.timingSafeEqual(Buffer.from(hotp(key, st)), Buffer.from(c))) return st; }
  return null;
}
// El secreto TOTP se guarda cifrado (AES-256-GCM) con una llave derivada de SESSION_SECRET: si alguien copia la base de datos, no le sirve.
const SEAL_KEY = crypto.createHash('sha256').update('totp-v1|' + SECRET).digest();
function seal(txt) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', SEAL_KEY, iv); const e = Buffer.concat([c.update(txt, 'utf8'), c.final()]); return [iv, c.getAuthTag(), e].map(x => x.toString('hex')).join(':'); }
function unseal(s) { try { const [i, t, e] = String(s).split(':'); const d = crypto.createDecipheriv('aes-256-gcm', SEAL_KEY, Buffer.from(i, 'hex')); d.setAuthTag(Buffer.from(t, 'hex')); return Buffer.concat([d.update(Buffer.from(e, 'hex')), d.final()]).toString('utf8'); } catch { return null; } }
const hashRecovery = c => crypto.createHmac('sha256', SECRET).update('rec|' + String(c).toLowerCase().replace(/[^a-f0-9]/g, '')).digest('hex');
function newRecovery() { const plain = Array.from({ length: 8 }, () => { const h = crypto.randomBytes(5).toString('hex'); return h.slice(0, 5) + '-' + h.slice(5); }); return { plain, hashes: plain.map(hashRecovery) }; }

function cookieHeader(value, maxAge) {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

// IP del cliente. Detrás de Render (proxy) la IP real viene en X-Forwarded-For: solo se usa con TRUST_PROXY=true.
function clientIp(req) {
  if (process.env.TRUST_PROXY === 'true') {
    const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (f) return f;
  }
  return req.socket.remoteAddress;
}

// Límite simple de intentos de login por IP+usuario
const fails = new Map();
function loginBlocked(key) {
  const f = fails.get(key);
  return f && f.n >= 5 && Date.now() - f.t < 15 * 60 * 1000;
}
function loginFail(key) {
  const f = fails.get(key), n = (f && Date.now() - f.t < 15 * 60 * 1000 ? f.n : 0) + 1;
  fails.set(key, { n, t: Date.now() });
  return n;
}
function loginOk(key) { fails.delete(key); }

module.exports = { newSecret, totpCheck, seal, unseal, hashRecovery, newRecovery, clientIp, hashPassword, verifyPassword, makeSession, readSession, cookieHeader, loginBlocked, loginFail, loginOk };
