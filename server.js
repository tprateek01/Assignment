const express = require('express'), crypto = require('crypto'), path = require('path');
const { MongoClient } = require('mongodb');
const E = process.env, PORT = E.PORT || 3000;
for (const k of ['MONGODB_URI', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'SESSION_SECRET', 'BREVO_API_KEY', 'BREVO_SENDER_EMAIL'])
  if (!E[k]) { console.error('Missing environment variable: ' + k); process.exit(1); }

const app = express();
app.set('trust proxy', 1);
const jsonSmall = express.json({ limit: '1mb' });
app.use((q, s, n) => (q.method === 'PUT' && /^\/api\/orders\/[a-z0-9]{24}\/pdf$/.test(q.path)) ? n() : jsonSmall(q, s, n));
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

/* ---- customer login: email OTP (sent with Brevo) + signed 30-day token ----
   Customer tokens use a DIFFERENT signing key and header from admin tokens, so they can never act as admin. */
const csign = p => crypto.createHmac('sha256', E.SESSION_SECRET + ':customer').update(p).digest('base64url');
const makeCustToken = m => { const p = Buffer.from(JSON.stringify({ m, e: Date.now() + 30 * 864e5 })).toString('base64url'); return p + '.' + csign(p); };
function custEmail(q) {
  const [p, s] = String(q.headers['x-customer-token'] || '').split('.');
  if (!p || !s || !same(s, csign(p))) return null;
  try { const d = JSON.parse(Buffer.from(p, 'base64url')); return d.e > Date.now() && typeof d.m === 'string' ? d.m : null; } catch { return null; }
}
const cust = (q, s, n) => { const m = custEmail(q); if (!m) return s.status(401).json({ error: 'Please log in' }); q.email = m; n(); };
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,120}\.[^\s@]{2,}$/;
const otpHash = (m, c) => crypto.createHmac('sha256', E.SESSION_SECRET + ':otp').update(m + ':' + c).digest('base64url');
async function sendOtpMail(to, code) {
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': E.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: E.BREVO_SENDER_NAME || 'Scribble', email: E.BREVO_SENDER_EMAIL },
      to: [{ email: to }],
      subject: 'Your Scribble login code: ' + code,
      textContent: 'Your login code is ' + code + '. It is valid for 10 minutes. If you did not ask for it, ignore this email.',
      htmlContent: '<div style="font-family:Arial,sans-serif;max-width:420px"><p>Your Scribble login code:</p>' +
        '<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:12px 0">' + code + '</p>' +
        '<p style="color:#555">Valid for 10 minutes. If you did not ask for it, you can ignore this email.</p></div>'
    })
  });
  if (!r.ok) throw new Error('Brevo ' + r.status + ' ' + (await r.text()));
}

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
const phoneNorm = x => {
  const m = /^\+(\d{1,4})(\d{10})$/.exec(str(x, 20));   // +<country code><exactly 10 digits>
  if (!m || (m[1] === '91' && !/^[6-9]/.test(m[2]))) return '';
  return m[1] + m[2];
};
let db;
const col = n => db.collection(n);
const getOrder = id => ID.test(id) ? col('orders').findOne({ _id: id }) : null;
const chatObj = ms => { const c = {}; ms.forEach(m => c[m._id.toHexString()] = { who: m.who, text: m.text, img: m.img, t: m.t }); return c; };
const view = (o, chat) => ({ info: o.info, quote: o.quote || null, decision: o.decision || null, status: o.status || null, progress: o.progress || null, pdfs: o.pdfs || [], proof: o.proof || [], chat });

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

/* ---- customer login routes ---- */
app.post('/api/auth/send-otp', limit('otp', 8, 9e5), wrap(async (q, s) => {
  const m = str((q.body || {}).email, 150).toLowerCase();
  if (!EMAIL.test(m)) return s.status(400).json({ error: 'Please enter a valid email address' });
  const old = await col('otps').findOne({ _id: m });
  if (old && Date.now() - old.last < 60000) return s.status(429).json({ error: 'Please wait a minute before asking for a new code' });
  const code = String(crypto.randomInt(100000, 1000000));
  await col('otps').updateOne({ _id: m }, { $set: { h: otpHash(m, code), exp: new Date(Date.now() + 6e5), tries: 0, last: Date.now() } }, { upsert: true });
  try { await sendOtpMail(m, code); } catch (e) { console.error(e.message); await col('otps').deleteOne({ _id: m }); return s.status(502).json({ error: 'Could not send the email. Try again.' }); }
  s.json({ ok: true });
}));
app.post('/api/auth/verify', limit('otpv', 20, 9e5), wrap(async (q, s) => {
  const b = q.body || {}, m = str(b.email, 150).toLowerCase(), c = str(b.code, 10);
  const d = EMAIL.test(m) ? await col('otps').findOne({ _id: m }) : null;
  if (!d || d.exp < new Date()) return s.status(400).json({ error: 'Code expired. Ask for a new one.' });
  if (d.tries >= 5) { await col('otps').deleteOne({ _id: m }); return s.status(429).json({ error: 'Too many wrong attempts. Ask for a new code.' }); }
  if (!/^\d{6}$/.test(c) || !same(otpHash(m, c), d.h)) { await col('otps').updateOne({ _id: m }, { $inc: { tries: 1 } }); return s.status(400).json({ error: 'Wrong code' }); }
  await col('otps').deleteOne({ _id: m });
  s.json({ token: makeCustToken(m), email: m });
}));
app.get('/api/my/orders', cust, wrap(async (q, s) => {
  const os = await col('orders').find({ 'info.email': q.email }).sort({ 'info.created': -1 }).limit(50).toArray();
  s.json(os.map(o => ({ id: o._id, t: o.info.subject + ' · ' + o.info.pages + ' pages' })));
}));

/* ---- customer: create request, read own chat ---- */
app.post('/api/orders', limit('new', 15, 36e5), cust, wrap(async (q, s) => {
  const b = q.body || {}, pages = Math.round(+b.pages);
  if (!ID.test(b.id) || !phoneNorm(b.phone) || !str(b.name, 80) || !str(b.subject, 120) || !(pages >= 1 && pages <= 200)) return s.status(400).json({ error: 'Invalid request' });
  const info = {
    name: str(b.name, 80), email: q.email, phone: phoneNorm(b.phone), subject: str(b.subject, 120), details: str(b.details, 3000),
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
app.put('/api/orders/:id/phone', limit('phone', 30, 36e5), wrap(async (q, s) => {
  const o = await getOrder(q.params.id), ph = phoneNorm((q.body || {}).phone);
  if (!o) return s.status(404).json({ error: 'No such request' });
  if (!ph) return s.status(400).json({ error: 'Please enter a valid mobile number' });
  await col('orders').updateOne({ _id: o._id }, { $set: { 'info.phone': ph } }); s.json({ phone: ph });
}));
app.put('/api/orders/:id/decision', limit('dec', 60, 36e5), wrap(async (q, s) => {
  const o = await getOrder(q.params.id), v = (q.body || {}).v, adm = isAdmin(q);
  if (!o) return s.status(404).json({ error: 'No such request' });
  if (!(v === 'accepted' || v === 'declined' || (v === null && adm))) return s.status(400).json({ error: 'Bad value' });
  if (!adm && !o.quote) return s.status(403).json({ error: 'No offer yet' });
  await col('orders').updateOne({ _id: o._id }, v === null ? { $unset: { decision: 1 } } : { $set: { decision: v } }); s.json(v);
}));


/* ---- PDFs the customer wants written (max 8 MB, up to 3 per request, customer only) ---- */
const MAX_PDF = 8 * 1048576, parsePdf = express.json({ limit: '12mb' });
app.put('/api/orders/:id/pdf', limit('pdf', 20, 36e5), parsePdf, wrap(async (q, s) => {
  if (isAdmin(q)) return s.status(403).json({ error: 'Only the customer can attach files' });
  const o = await getOrder(q.params.id), b = q.body || {};
  if (!o) return s.status(404).json({ error: 'No such request' });
  const m = typeof b.d === 'string' ? /^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/.exec(b.d) : null;
  const buf = m ? Buffer.from(m[1], 'base64') : null;
  if (!buf || buf.length > MAX_PDF) return s.status(413).json({ error: 'That PDF is larger than 8 MB.' });
  if (buf.slice(0, 5).toString('latin1') !== '%PDF-') return s.status(400).json({ error: 'That file is not a real PDF.' });
  if ((o.pdfs || []).length >= 3) return s.status(429).json({ error: 'You can attach up to 3 PDFs per request.' });
  const k = crypto.randomBytes(6).toString('hex'), name = str(b.name, 100).replace(/[\r\n"\\/]/g, '_') || 'file.pdf';
  await col('pdfs').insertOne({ _id: o._id + '/' + k, oid: o._id, data: buf });
  const f = { k, name, size: buf.length, t: Date.now() };
  await col('orders').updateOne({ _id: o._id }, { $push: { pdfs: f } }); s.json(f);
}));
app.get('/api/orders/:id/pdf/:k', wrap(async (q, s) => {
  const d = ID.test(q.params.id) && /^[a-f0-9]{12}$/.test(q.params.k) ? await col('pdfs').findOne({ _id: q.params.id + '/' + q.params.k }) : null;
  const o = d ? await getOrder(q.params.id) : null, f = o && (o.pdfs || []).find(x => x.k === q.params.k);
  if (!d || !f) return s.status(404).json({ error: 'Not found' });
  s.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + f.name.replace(/[^\w.\- ]/g, '_') + '"' });
  s.send(Buffer.isBuffer(d.data) ? d.data : Buffer.from(d.data.read(0, d.data.length())));  // MongoDB returns a Binary object
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
  // market-price items (copy, register, drawing sheets, special paper...): each has a name (what it is for) and its actual cost
  const rawM = Array.isArray(b.materials) ? b.materials : [];
  if (rawM.length > 12) return s.status(400).json({ error: 'Maximum 12 extra items' });
  const materials = [];
  for (const m of rawM) {
    const name = str(m && m.name, 60), amount = Math.round((+(m && m.amount) || 0) * 100) / 100;
    if (!name && !amount) continue;
    if (!name || !(amount > 0 && amount <= 1e6)) return s.status(400).json({ error: 'Each extra item needs a name and an amount above 0' });
    materials.push({ name, amount });
  }
  const matTotal = Math.round(materials.reduce((a, m) => a + m.amount, 0) * 100) / 100;
  const rushOn = b.rushOn === true, rushPct = Math.max(0, Math.min(300, Math.round(+b.rushPct || 0)));
  const sub = o.info.pages * p, rush = rushOn ? Math.round(sub * rushPct / 100) : 0;
  const quote = { ppp: p, extra: x, pages: o.info.pages, rushOn, rushPct, rush, materials, matTotal, total: Math.round((sub + rush + matTotal + x) * 100) / 100, t: Date.now() };
  // a new offer clears the customer's earlier answer, so they must accept the new total
  await col('orders').updateOne({ _id: o._id }, { $set: { quote }, $unset: { decision: 1 } }); s.json(quote);
}));
app.put('/api/orders/:id/progress', admin, wrap(async (q, s) => {
  const o = await getOrder(q.params.id), b = q.body || {}, done = Math.round(+b.done);
  if (!o) return s.status(404).json({ error: 'No such request' });
  if (!(done >= 0 && done <= o.info.pages)) return s.status(400).json({ error: 'Enter a number from 0 to ' + o.info.pages + '.' });
  const progress = { done, note: str(b.note, 200), t: Date.now() };
  await col('orders').updateOne({ _id: o._id }, { $set: { progress } }); s.json(progress);
}));
/* ---- completed-work photos: only the admin uploads them, the customer only views them ---- */
const MAX_PROOF = 30;
app.put('/api/orders/:id/proof', admin, wrap(async (q, s) => {
  const o = await getOrder(q.params.id), b = q.body || {}, d = b.d;
  if (!o) return s.status(404).json({ error: 'No such request' });
  if (typeof d !== 'string' || d.length > 400000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(d)) return s.status(400).json({ error: 'Bad image' });
  if ((o.proof || []).length >= MAX_PROOF) return s.status(429).json({ error: 'Maximum ' + MAX_PROOF + ' work photos per request. Delete some first.' });
  const k = 'w' + crypto.randomBytes(5).toString('hex'), f = { k, note: str(b.note, 140), t: Date.now() };
  await col('images').insertOne({ _id: o._id + '/' + k, oid: o._id, d });
  await col('orders').updateOne({ _id: o._id }, { $push: { proof: f } }); s.json(f);
}));
app.delete('/api/orders/:id/proof/:k', admin, wrap(async (q, s) => {
  const o = await getOrder(q.params.id), k = q.params.k;
  if (!o || !/^w[a-f0-9]{10}$/.test(k)) return s.status(404).json({ error: 'Not found' });
  await col('images').deleteOne({ _id: o._id + '/' + k });
  await col('orders').updateOne({ _id: o._id }, { $pull: { proof: { k } } }); s.json({});
}));
app.put('/api/orders/:id/status', admin, wrap(async (q, s) => {
  const o = await getOrder(q.params.id), v = (q.body || {}).v;
  if (!o) return s.status(404).json({ error: 'No such request' });
  if (v !== null && !MANUAL.includes(v)) return s.status(400).json({ error: 'Bad status' });
  await col('orders').updateOne({ _id: o._id }, v === null ? { $unset: { status: 1 } } : { $set: { status: v } }); s.json(v);
}));
app.delete('/api/orders/:id', admin, wrap(async (q, s) => {
  if (!ID.test(q.params.id)) return s.status(400).json({});
  await col('orders').deleteOne({ _id: q.params.id }); await col('messages').deleteMany({ oid: q.params.id }); await col('images').deleteMany({ oid: q.params.id }); await col('pdfs').deleteMany({ oid: q.params.id }); s.json({});
}));
app.delete('/api/images/:id', admin, wrap(async (q, s) => { await col('images').deleteMany({ oid: q.params.id }); s.json({}); }));

app.use('/api', (q, s) => s.status(404).json({ error: 'Not found' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], dotfiles: 'deny' }));

MongoClient.connect(E.MONGODB_URI).then(async c => {
  db = c.db();
  await col('messages').createIndex({ oid: 1, _id: 1 }); await col('images').createIndex({ oid: 1 }); await col('pdfs').createIndex({ oid: 1 }); await col('orders').createIndex({ 'info.created': -1 }); await col('orders').createIndex({ 'info.email': 1 }); await col('otps').createIndex({ exp: 1 }, { expireAfterSeconds: 0 });
  app.listen(PORT, () => console.log('Scribble running on port ' + PORT));
}).catch(e => { console.error('Could not connect to MongoDB:', e.message); process.exit(1); });