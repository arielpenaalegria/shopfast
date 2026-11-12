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

function makeSession(userId) {
  const payload = `${userId}.${Date.now() + TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}
async function readSession(req) {
  const m = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 3) return null;
  const payload = parts[0] + '.' + parts[1];
  const a = Buffer.from(sign(payload)), b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(parts[1]) < Date.now()) return null;
  const d = await C.users.findOne({ _id: Number(parts[0]) });
  return d && d.active ? { id: d._id, username: d.username, role: d.role, balance_cents: d.balance_cents, markup_pct: d.markup_pct, min_margin_cents: d.min_margin_cents || 0, active: d.active } : null;
}
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
  const f = fails.get(key);
  fails.set(key, { n: (f && Date.now() - f.t < 15 * 60 * 1000 ? f.n : 0) + 1, t: Date.now() });
}
function loginOk(key) { fails.delete(key); }

module.exports = { clientIp, hashPassword, verifyPassword, makeSession, readSession, cookieHeader, loginBlocked, loginFail, loginOk };
