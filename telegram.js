'use strict';
/**
 * Avisos por Telegram (opcional). Si no está TELEGRAM_BOT_TOKEN, todo esto no hace nada.
 *  - Crea un bot con @BotFather, copia el token y ponlo en TELEGRAM_BOT_TOKEN.
 *  - Cada usuario (admin o revendedor) pulsa "Conectar Telegram" en el panel: abre el bot con un código de un solo uso
 *    y el panel guarda su chat. No hace falta webhook: el panel lee los mensajes del bot (long polling).
 */
const crypto = require('node:crypto');
const { C } = require('./db');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const BASE = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
let botName = null;

async function tg(method, body, timeoutMs = 15000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${BASE}/bot${TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: ctrl.signal });
    const d = await r.json();
    if (!d.ok) throw new Error(d.description || 'Telegram error');
    return d.result;
  } finally { clearTimeout(t); }
}

/** Envía un mensaje; nunca lanza error (un aviso fallido no debe romper un pedido). */
async function sendTo(chatId, text) {
  if (!TOKEN || !chatId) return;
  try { await tg('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true }); }
  catch (e) { console.error('Telegram:', e.message); }
}
async function notifyUser(userId, text) {
  const u = await C.users.findOne({ _id: userId });
  if (u && u.telegram_chat_id) await sendTo(u.telegram_chat_id, text);
}
async function notifyAdmins(text) {
  for (const a of await C.users.find({ role: 'admin', telegram_chat_id: { $ne: null } }).toArray()) await sendTo(a.telegram_chat_id, text);
}

/** Enlace para conectar: t.me/<bot>?start=<código>. El código caduca al usarlo. */
async function linkFor(userId) {
  if (!TOKEN || !botName) return null;
  const code = crypto.randomBytes(12).toString('hex');
  await C.users.updateOne({ _id: userId }, { $set: { tg_link_token: code } });
  return `https://t.me/${botName}?start=${code}`;
}

async function loop() {
  let offset = 0;
  try { const k = await C.kv.findOne({ _id: 'tg_offset' }); if (k) offset = Number(k.value) || 0; } catch {}
  for (;;) {
    try {
      const ups = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, 35000);
      for (const u of ups) {
        offset = u.update_id + 1;
        const m = u.message; if (!m || !m.text) continue;
        const code = (/^\/start\s+([a-f0-9]{24})$/.exec(m.text.trim()) || [])[1];
        if (code) {
          const r = await C.users.findOneAndUpdate({ tg_link_token: code }, { $set: { telegram_chat_id: m.chat.id, tg_link_token: null } }, { returnDocument: 'after' });
          await sendTo(m.chat.id, r ? `✅ Conectado como ${r.username}. Aquí te llegarán los avisos del panel.` : 'Código no válido o ya usado. Genera otro en el panel.');
        } else if (m.text.trim() === '/start') await sendTo(m.chat.id, 'Para conectar, pulsa "Conectar Telegram" dentro del panel.');
      }
      if (ups.length) await C.kv.updateOne({ _id: 'tg_offset' }, { $set: { value: String(offset) } }, { upsert: true });
    } catch (e) { console.error('Telegram poll:', e.message); await new Promise(r => setTimeout(r, 10000)); }
  }
}

async function start() {
  if (!TOKEN) return;
  try { botName = (await tg('getMe')).username; console.log('Telegram: bot @' + botName); loop(); }
  catch (e) { console.error('Telegram: el token no funciona:', e.message); }
}

module.exports = { start, sendTo, notifyUser, notifyAdmins, linkFor, enabled: () => !!(TOKEN && botName) };
