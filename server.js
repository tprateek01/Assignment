const express = require('express'), crypto = require('crypto'), path = require('path');
const { MongoClient } = require('mongodb');
const E = process.env, PORT = E.PORT || 3000;
for (const k of ['MONGODB_URI', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'SESSION_SECRET'])
  if (!E[k]) { console.error('Missing environment variable: ' + k); process.exit(1); }

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use((q, s, n) => { s.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' }); n(); });

/* ---- admin sessions (signed token, 30 days) ---- */
const sign = p => crypto.createHmac('sha256', E.SESSION_SECRET).update(p).digest('base64url');
const hash = v => crypto.createHash('sha256').update(String(v)).digest();
const same = (a, b) => crypto.timingSafeEqual(hash(a), hash(b));
const makeToken = () => { const p = Buffer.from(JSON.stringify({ e: Date.now() + 30 * 864e5 })).toString('base64url'); return p + '.' + sign(p); };
function isAdmin(q) {
  const [p, s] = (q.headers.authorization || '').replace('Bearer ', '').split('.');
  if (!p || !s || !same(s, sign(p))) return false;
  try { return JSON.parse(Buffer.from(p, 'base64url')).e > Date.now(); } catch { return false; }
}
const admin = (q, s, n) => isAdmin(q) ? n() : s.status(401).json({ error: 'Not allowed' });

/* ---- simple rate limit per IP (skipped for the admin) ---- */
const hits = new Map();
setInterval(() => hits.clear(), 36e5);
const limit = (name, max, ms) => (q, s, n) => {
  if (isAdmin(q)) return n();
  const k = name + q.ip, now = Date.now(), h = (hits.get(k) || []).filter(t => now - t < ms);
  if (h.length >= max) return s.status(429).json({ error: 'Too many requests, try later' });
  h.push(now); hits.set(k, h); n();
};

const wrap = f => (q, s) => f(q, s).catch(e => { console.error(e); s.status(500).json({ error: 'Server error' }); });
const ID = /^[a-z0-9]{24}$/, KEY = /^[a-z0-9]{1,16}$/, MANUAL = ['In progress', 'Delivered', 'Paid', 'Cancelled'];
const str = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';
let db;
const col = n => db.collection(n);
const getOrder = id => ID.test(id) ? col('orders').findOne({ _id: id }) : null;
const chatObj = ms => { const c = {}; ms.forEach(m => c[m._id.toHexString()] = { who: m.who, text: m.text, img: m.img, t: m.t }); return c; };
const view = (o, chat) => ({ info: o.info, quote: o.quote || null, decision: o.decision || null, status: o.status || null, chat });

app.get('/api/config', (q, s) => s.json({ whatsapp: E.WHATSAPP || '918595938353' }));

app.post('/api/admin/login', limit('login', 10, 9e5), (q, s) => {
  const b = q.body || {};
  if (same(str(b.email, 200).toLowerCase(), E.ADMIN_EMAIL.toLowerCase()) && same(b.password || '', E.ADMIN_PASSWORD)) return s.json({ token: makeToken() });
  s.status(401).json({ error: 'Wrong email or password' });
});

app.get('/api/settings', wrap(async (q, s) => { const d = (await col('settings').findOne({ _id: 'main' })) || {}; delete d._id; s.json(d); }));
app.put('/api/settings', admin, wrap(async (q, s) => {
  const n = v => Math.max(0, Math.min(100000, +v || 0)), b = q.body || {};
  const d = { rateH: n(b.rateH), rateT: n(b.rateT), rush2: n(b.rush2), rush5: n(b.rush5) };
  await col('settings').updateOne({ _id: 'main' }, { $set: d }, { upsert: true }); s.json(d);
}));

/* ---- customer: create request, read own chat ---- */
app.post('/api/orders', limit('new', 15, 36e5), wrap(async (q, s) => {
  const b = q.body || {}, pages = Math.round(+b.pages);
  if (!ID.test(b.id) || !str(b.name, 80) || !str(b.subject, 120) || !(pages >= 1 && pages <= 200)) return s.status(400).json({ error: 'Invalid request' });
  const info = {
    name: str(b.name, 80), subject: str(b.subject, 120), details: str(b.details, 3000),
    type: b.type === 'Handwritten' ? 'Handwritten' : 'Typed (Word/PDF)', pages,
    deadline: /^\d{4}-\d\d-\d\d$/.test(b.deadline) ? b.deadline : '', est: str(b.est, 30),
    imgs: (Array.isArray(b.imgs) ? b.imgs : []).filter(k => /^i[0-3]$/.test(k)).slice(0, 4), created: Date.now()
  };
  try { await col('orders').insertOne({ _id: b.id, info }); } catch (e) { return s.status(e.code === 11000 ? 409 : 500).json({ error: 'Could not save' }); }
  s.json(info);
}));
app.get('/api/orders/:id', wrap(async (q, s) => {
  const o = await getOrder(q.params.id); if (!o) return s.json(null);
  s.json(view(o, chatObj(await col('messages').find({ oid: o._id }).sort({ _id: 1 }).limit(500).toArray())));
}));
app.post('/api/orders/:id/chat', limit('chat', 150, 36e5), wrap(async (q, s) => {
  const o = await getOrder(q.params.id), b = q.body || {};
  if (!o) return s.status(404).json({ error: 'No such request' });
  const text = str(b.text, 2000), img = typeof b.img === 'string' && KEY.test(b.img) ? b.img : null;
  if (!text && !img) return s.status(400).json({ error: 'Empty message' });
  const r = await col('messages').insertOne({ oid: o._id, who: isAdmin(q) ? 'admin' : 'cust', text, img, t: Date.now() });
  s.json({ name: r.insertedId.toHexString() });
}));
app.put('/api/orders/:id/decision', limit('dec', 60, 36e5), wrap(async (q, s) => {
  const o = await getOrder(q.params.id), v = (q.body || {}).v, adm = isAdmin(q);
  if (!o) return s.status(404).json({ error: 'No such request' });
  if (!(v === 'accepted' || v === 'declined' || (v === null && adm))) return s.status(400).json({ error: 'Bad value' });
  if (!adm && !o.quote) return s.status(403).json({ error: 'No offer yet' });
  await col('orders').updateOne({ _id: o._id }, v === null ? { $unset: { decision: 1 } } : { $set: { decision: v } }); s.json(v);
}));

/* ---- images (stored as small JPEG data URLs) ---- */
app.put('/api/images/:id/:k', limit('img', 80, 36e5), wrap(async (q, s) => {
  const o = await getOrder(q.params.id), { k } = q.params, d = (q.body || {}).d;
  if (!o) return s.status(404).json({ error: 'No such request' });
  if (!KEY.test(k) || typeof d !== 'string' || d.length > 400000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(d)) return s.status(400).json({ error: 'Bad image' });
  if (!isAdmin(q) && (await col('images').countDocuments({ oid: o._id })) >= 60) return s.status(429).json({ error: 'Too many photos' });
  try { await col('images').insertOne({ _id: o._id + '/' + k, oid: o._id, d }); } catch (e) { return s.status(e.code === 11000 ? 409 : 500).json({ error: 'Could not save' }); }
  s.json({ ok: true });
}));
app.get('/api/images/:id/:k', wrap(async (q, s) => {
  const d = ID.test(q.params.id) && KEY.test(q.params.k) ? await col('images').findOne({ _id: q.params.id + '/' + q.params.k }) : null;
  s.json(d ? d.d : null);
}));

/* ---- admin only ---- */
app.get('/api/admin/orders', admin, wrap(async (q, s) => {
  const os = await col('orders').find().sort({ 'info.created': -1 }).limit(200).toArray(), out = {};
  os.forEach(o => out[o._id] = view(o, {}));
  const ms = await col('messages').find({ oid: { $in: os.map(o => o._id) } }).sort({ _id: 1 }).toArray();
  ms.forEach(m => { if (out[m.oid]) out[m.oid].chat[m._id.toHexString()] = { who: m.who, text: m.text, img: m.img, t: m.t }; });
  s.json(out);
}));
app.put('/api/orders/:id/quote', admin, wrap(async (q, s) => {
  const o = await getOrder(q.params.id), b = q.body || {}, p = +b.ppp, x = +b.extra || 0;
  if (!o) return s.status(404).json({ error: 'No such request' });
  if (!(p > 0 && p < 100000) || Math.abs(x) > 1e6) return s.status(400).json({ error: 'Bad price' });
  const quote = { ppp: p, extra: x, pages: o.info.pages, total: o.info.pages * p + x, t: Date.now() };
  await col('orders').updateOne({ _id: o._id }, { $set: { quote } }); s.json(quote);
}));
app.put('/api/orders/:id/status', admin, wrap(async (q, s) => {
  const o = await getOrder(q.params.id), v = (q.body || {}).v;
  if (!o) return s.status(404).json({ error: 'No such request' });
  if (v !== null && !MANUAL.includes(v)) return s.status(400).json({ error: 'Bad status' });
  await col('orders').updateOne({ _id: o._id }, v === null ? { $unset: { status: 1 } } : { $set: { status: v } }); s.json(v);
}));
app.delete('/api/orders/:id', admin, wrap(async (q, s) => {
  if (!ID.test(q.params.id)) return s.status(400).json({});
  await col('orders').deleteOne({ _id: q.params.id }); await col('messages').deleteMany({ oid: q.params.id }); await col('images').deleteMany({ oid: q.params.id }); s.json({});
}));
app.delete('/api/images/:id', admin, wrap(async (q, s) => { await col('images').deleteMany({ oid: q.params.id }); s.json({}); }));

app.use('/api', (q, s) => s.status(404).json({ error: 'Not found' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], dotfiles: 'deny' }));

MongoClient.connect(E.MONGODB_URI).then(async c => {
  db = c.db();
  await col('messages').createIndex({ oid: 1, _id: 1 }); await col('images').createIndex({ oid: 1 }); await col('orders').createIndex({ 'info.created': -1 });
  app.listen(PORT, () => console.log('Assignment Desk running on port ' + PORT));
}).catch(e => { console.error('Could not connect to MongoDB:', e.message); process.exit(1); });
