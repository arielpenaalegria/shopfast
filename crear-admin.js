'use strict';
// Uso: node --env-file=.env scripts/crear-admin.js <usuario> <contraseña>
const { C, connect, nextId, isDup } = require('../db');
const { hashPassword } = require('../auth');
const [u, p] = process.argv.slice(2);
if (!u || !p || p.length < 8) { console.error('Uso: crear-admin <usuario> <contraseña de 8+ caracteres>'); process.exit(1); }
(async () => {
  await connect();
  try {
    await C.users.insertOne({ _id: await nextId('users'), username: u, username_lc: u.toLowerCase(), password_hash: hashPassword(p), role: 'admin',
      balance_cents: 0, markup_pct: 0, active: 1, created_at: new Date() });
    console.log('Admin creado:', u);
  } catch (e) { console.error(isDup(e) ? 'Ese usuario ya existe' : e.message); process.exitCode = 1; }
  process.exit();
})();
