'use strict';
/**
 * Capa de datos: MongoDB (Atlas gratis sirve). Dinero siempre en enteros (centavos / x10000), nunca floats.
 *  - MONGODB_URI: cadena de conexión de Atlas (obligatoria en producción).
 *  - MEMORY_DB=1: base en memoria SOLO para probar en local (se pierde al reiniciar). Nunca en producción.
 */
const C = {}; // colecciones, se llenan en connect()
let client = null;

async function connect() {
  let MongoClient;
  const uri = process.env.MONGODB_URI;
  if (uri) ({ MongoClient } = require('mongodb'));
  else if (process.env.MEMORY_DB === '1') {
    ({ MongoClient } = require('./fakemongo'));
    console.warn('⚠ MODO MEMORIA: los datos se pierden al reiniciar. Solo para pruebas.');
  } else {
    console.error('ERROR: falta MONGODB_URI (cadena de conexión de MongoDB Atlas).');
    process.exit(1);
  }
  client = new MongoClient(uri || 'memory://', { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'panel');
  for (const n of ['users', 'ledger', 'catalog', 'products', 'orders', 'kv', 'webhook_events', 'counters', 'topup_requests']) C[n] = db.collection(n);

  await C.users.createIndex({ username_lc: 1 }, { unique: true });
  await C.products.createIndex({ catalog_item_id: 1 }, { unique: true });
  await C.orders.createIndex({ user_id: 1, _id: -1 });
  await C.orders.createIndex({ status: 1 });
  await C.ledger.createIndex({ user_id: 1, _id: -1 });
  await C.topup_requests.createIndex({ user_id: 1, _id: -1 });
  for (const n of ['users', 'ledger', 'products', 'orders', 'topup_requests'])
    await C.counters.updateOne({ _id: n }, { $setOnInsert: { seq: 0 } }, { upsert: true });
}

/** Siguiente id entero (1, 2, 3...) para una colección. */
async function nextId(name, session) {
  const d = await C.counters.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session });
  return d.seq;
}

/** Ejecuta fn dentro de una transacción (todo o nada). fn recibe la sesión y debe pasarla a cada operación. */
async function withTx(fn) {
  const session = client.startSession();
  let result;
  try {
    await session.withTransaction(async () => { result = await fn(session); });
  } finally { await session.endSession(); }
  return result;
}

const fmt = d => (d ? new Date(d).toISOString().slice(0, 19).replace('T', ' ') : null);
const isDup = e => e && e.code === 11000;

module.exports = { C, connect, nextId, withTx, fmt, isDup };
