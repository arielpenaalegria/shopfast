'use strict';
/**
 * Mini-MongoDB en memoria con la misma interfaz del driver oficial (solo lo que usa este panel).
 * ÚNICAMENTE para desarrollo y pruebas locales (MEMORY_DB=1). No sustituye a una base real.
 */
const clone = v => structuredClone(v);
const val = x => (x instanceof Date ? x.valueOf() : x);
const eq = (a, b) => val(a) === val(b);
const isOps = c => c !== null && typeof c === 'object' && !(c instanceof Date) && !Array.isArray(c) && Object.keys(c).some(k => k.startsWith('$'));

function matchField(v, cond, whole) {
  if (isOps(cond)) {
    return Object.entries(cond).every(([op, arg]) => {
      switch (op) {
        case '$gte': return v != null && val(v) >= val(arg);
        case '$gt': return v != null && val(v) > val(arg);
        case '$lte': return v != null && val(v) <= val(arg);
        case '$lt': return v != null && val(v) < val(arg);
        case '$ne': return arg === null ? v != null : !eq(v, arg);
        case '$in': return arg.some(a => (a === null ? v == null : eq(v, a)));
        case '$nin': return !arg.some(a => (a === null ? v == null : eq(v, a)));
        case '$exists': return (v !== undefined) === arg;
        case '$regex': return typeof v === 'string' && new RegExp(arg instanceof RegExp ? arg.source : arg, whole.$options || '').test(v);
        case '$options': return true;
        default: throw new Error('Operador no soportado por el mini-mongo: ' + op);
      }
    });
  }
  return cond === null ? v == null : eq(v, cond);
}
function match(doc, f) {
  return Object.entries(f || {}).every(([k, c]) => {
    if (k === '$or') return c.some(x => match(doc, x));
    if (k === '$and') return c.every(x => match(doc, x));
    return matchField(doc[k], c, c);
  });
}
function applyUpdate(doc, upd, inserting) {
  for (const [op, f] of Object.entries(upd)) {
    if (op === '$set') Object.assign(doc, clone(f));
    else if (op === '$inc') for (const [k, n] of Object.entries(f)) doc[k] = (doc[k] || 0) + n;
    else if (op === '$unset') for (const k of Object.keys(f)) delete doc[k];
    else if (op === '$setOnInsert') { if (inserting) Object.assign(doc, clone(f)); }
    else throw new Error('Operador de update no soportado: ' + op);
  }
}
const dupErr = () => Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
const sortDocs = (docs, spec) => {
  const keys = Object.entries(spec || {});
  if (!keys.length) return docs;
  return [...docs].sort((a, b) => {
    for (const [k, dir] of keys) {
      const x = val(a[k]), y = val(b[k]);
      if (x === y || (x == null && y == null)) continue;
      if (x == null) return -dir; if (y == null) return dir;
      return (x < y ? -1 : 1) * dir;
    }
    return 0;
  });
};

class Collection {
  constructor() { this.docs = []; this.uniques = []; }
  _checkUnique(doc, self) {
    for (const f of ['_id', ...this.uniques])
      if (doc[f] !== undefined && this.docs.some(d => d !== self && eq(d[f], doc[f]))) throw dupErr();
  }
  _log(session, undo) { if (session && session._undo) session._undo.push(undo); }
  async createIndex(spec, opts) { if (opts && opts.unique) this.uniques.push(Object.keys(spec)[0]); }
  async insertOne(doc, { session } = {}) {
    const d = clone(doc); if (d._id === undefined) d._id = Math.random().toString(36).slice(2);
    this._checkUnique(d, null); this.docs.push(d);
    this._log(session, () => { this.docs = this.docs.filter(x => x !== d); });
    return { insertedId: d._id };
  }
  async findOne(f, { session, sort } = {}) { const r = sortDocs(this.docs.filter(d => match(d, f)), sort)[0]; return r ? clone(r) : null; }
  find(f) {
    const self = this; let spec = null, lim = 0;
    const cur = { sort(s) { spec = s; return cur; }, limit(n) { lim = n; return cur; },
      async toArray() { let r = sortDocs(self.docs.filter(d => match(d, f)), spec); if (lim) r = r.slice(0, lim); return r.map(clone); } };
    return cur;
  }
  async countDocuments(f) { return this.docs.filter(d => match(d, f)).length; }
  async _update(f, upd, { upsert, session } = {}, many = false) {
    const hits = this.docs.filter(d => match(d, f)); let modified = 0;
    const targets = many ? hits : hits.slice(0, 1);
    for (const d of targets) {
      const before = clone(d); applyUpdate(d, upd, false); this._checkUnique(d, d);
      if (JSON.stringify(before) !== JSON.stringify(d)) modified++;
      this._log(session, () => { Object.keys(d).forEach(k => delete d[k]); Object.assign(d, before); });
    }
    if (!hits.length && upsert) {
      const d = {}; for (const [k, c] of Object.entries(f)) if (!k.startsWith('$') && !isOps(c)) d[k] = clone(c);
      applyUpdate(d, upd, true); if (d._id === undefined) d._id = Math.random().toString(36).slice(2);
      this._checkUnique(d, null); this.docs.push(d);
      this._log(session, () => { this.docs = this.docs.filter(x => x !== d); });
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, doc: d };
    }
    return { matchedCount: hits.length, modifiedCount: modified, upsertedCount: 0, doc: targets[0] };
  }
  async updateOne(f, u, o) { const r = await this._update(f, u, o); return { matchedCount: r.matchedCount, modifiedCount: r.modifiedCount, upsertedCount: r.upsertedCount }; }
  async updateMany(f, u, o) { const r = await this._update(f, u, o, true); return { matchedCount: r.matchedCount, modifiedCount: r.modifiedCount }; }
  async findOneAndUpdate(f, u, o = {}) {
    const before = this.docs.find(d => match(d, f)); const prev = before ? clone(before) : null;
    const r = await this._update(f, u, o); const after = r.doc ? clone(r.doc) : null;
    return o.returnDocument === 'after' ? after : prev;
  }
  async deleteOne(fl) { const i = this.docs.findIndex(d => match(d, fl)); if (i >= 0) this.docs.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; }
  async bulkWrite(ops, o = {}) { for (const op of ops) { const x = op.updateOne; await this._update(x.filter, x.update, { upsert: x.upsert, session: o.session }); } return {}; }
}
class Db { constructor() { this.cols = new Map(); } collection(n) { if (!this.cols.has(n)) this.cols.set(n, new Collection()); return this.cols.get(n); } }
class MongoClient {
  constructor() { this.dbs = new Map(); }
  async connect() { return this; }
  db(n) { if (!this.dbs.has(n)) this.dbs.set(n, new Db()); return this.dbs.get(n); }
  startSession() {
    const s = { _undo: null,
      async withTransaction(fn) {
        s._undo = [];
        try { await fn(); } catch (e) { for (const u of s._undo.reverse()) u(); throw e; } finally { s._undo = null; }
      },
      async endSession() {} };
    return s;
  }
  async close() {}
}
module.exports = { MongoClient };
