// API tests: run with `npm test`. Uses an in-memory Postgres (PGlite) and mocked Anthropic/Stripe, so no keys or network needed.
const test = require('node:test');
const assert = require('node:assert');

let db;
const mock = { aiFail: false, calls: 0 };
global.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('https://api.anthropic.com')) {
    mock.calls++;
    if (mock.aiFail) return new Response('{"error":{"type":"overloaded"}}', { status: 529 });
    const sys = JSON.parse(opts.body).system;
    const text = /stuck/.test(sys)
      ? '{"steps":["Open the doc.","Type one sentence."]}'
      : 'Sure! {"title":"Essay","steps":["Open the prompt","Write 3 bullets","  ","Write 3 bullets","Draft intro"],"estMinutes":9999,"tip":"You got this."}';
    return new Response(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 100, output_tokens: 50 } }), { status: 200 });
  }
  if (url.startsWith('https://api.stripe.com')) return new Response(JSON.stringify({ id: 'cs_test_1', client_reference_id: '999', payment_status: 'paid' }), { status: 200 });
  throw new Error('unexpected fetch ' + url);
};

function call(handler, { method = 'POST', query = {}, body = {}, cookie = '', ip = '1.2.3.4' } = {}) {
  return new Promise((resolve, reject) => {
    const req = { method, query, body, headers: { cookie, host: 'localhost:3000', 'x-forwarded-for': ip }, url: '/api', socket: {} };
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: o, cookie: this.headers['set-cookie'] }); return this; }, end() { resolve({ status: this.statusCode, body: null }); return this; } };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}
const cookieOf = r => (r.cookie || '').split(';')[0];

test.before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  global.__cgTestSql = { query: async (t, p) => (await db.query(t, p)).rows };
  process.env.ANTHROPIC_API_KEY = 'test'; process.env.STRIPE_SECRET_KEY = 'sk_test_x';
});

const auth = () => require('../api/auth');
const step = () => require('../api/step');
const event = () => require('../api/event');
const checkout = () => require('../api/checkout');

test('signup, me, wrong password, login', async () => {
  const s = await call(auth(), { query: { action: 'signup' }, body: { email: 'A@psu.edu', password: 'supersecret1' } });
  assert.equal(s.status, 200); assert.equal(s.body.user.email, 'a@psu.edu'); assert.match(s.cookie, /HttpOnly/);
  const me = await call(auth(), { method: 'GET', query: { action: 'me' }, cookie: cookieOf(s) });
  assert.equal(me.body.user.plan, 'free'); assert.equal(me.body.user.aiLeft, 5);
  assert.equal((await call(auth(), { query: { action: 'signup' }, body: { email: 'a@psu.edu', password: 'supersecret1' } })).status, 409);
  assert.equal((await call(auth(), { query: { action: 'login' }, body: { email: 'a@psu.edu', password: 'nope-nope' } })).status, 401);
  assert.equal((await call(auth(), { query: { action: 'login' }, body: { email: 'a@psu.edu', password: 'supersecret1' } })).status, 200);
  const rows = await db.query("select password_hash from users where email='a@psu.edu'");
  assert.match(rows.rows[0].password_hash, /^scrypt\$/); // never plaintext
});

test('demo account exists with paid access and cannot be deleted', async () => {
  const r = await call(auth(), { query: { action: 'login' }, body: { email: 'demo@demo.com', password: 'password123!' } });
  assert.equal(r.status, 200); assert.equal(r.body.user.plan, 'personal');
  const d = await call(auth(), { query: { action: 'delete' }, body: { password: 'password123!' }, cookie: cookieOf(r) });
  assert.equal(d.status, 403);
});

test('AI breakdown requires login and returns validated steps', async () => {
  assert.equal((await call(step(), { body: { task: 'essay' } })).status, 401);
  const s = await call(auth(), { query: { action: 'signup' }, body: { email: 'b@psu.edu', password: 'supersecret1' } });
  const r = await call(step(), { body: { action: 'breakdown', task: 'write my essay' }, cookie: cookieOf(s), ip: '9.9.9.1' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.steps, ['Open the prompt', 'Write 3 bullets', 'Draft intro']); // blanks + duplicates removed
  assert.equal(r.body.estMinutes, 600); // clamped
  assert.equal(r.body.aiLeft, 4);
  const sm = await call(step(), { body: { action: 'smaller', task: 'essay', step: 'Draft intro' }, cookie: cookieOf(s), ip: '9.9.9.1' });
  assert.equal(sm.body.steps.length, 2);
  const usage = await db.query('select count(*)::int c from ai_usage');
  assert.ok(usage.rows[0].c >= 2);
});

test('free AI limit holds under parallel requests', async () => {
  const s = await call(auth(), { query: { action: 'signup' }, body: { email: 'c@psu.edu', password: 'supersecret1' } });
  const results = await Promise.all(Array.from({ length: 12 }, () => call(step(), { body: { action: 'breakdown', task: 'study' }, cookie: cookieOf(s), ip: '9.9.9.2' })));
  assert.equal(results.filter(r => r.status === 200).length, 5);
  assert.equal(results.filter(r => r.status === 402).length, 7);
});

test('failed AI call refunds the AI action', async () => {
  const s = await call(auth(), { query: { action: 'signup' }, body: { email: 'd@psu.edu', password: 'supersecret1' } });
  mock.aiFail = true;
  const r = await call(step(), { body: { action: 'breakdown', task: 'study' }, cookie: cookieOf(s), ip: '9.9.9.3' });
  mock.aiFail = false;
  assert.equal(r.status, 502);
  const me = await call(auth(), { method: 'GET', query: { action: 'me' }, cookie: cookieOf(s) });
  assert.equal(me.body.user.aiLeft, 5);
});

test('events accept only known names and store no content', async () => {
  assert.equal((await call(event(), { body: { name: 'session_started', anonId: 'abc-123' } })).status, 204);
  assert.equal((await call(event(), { body: { name: 'my secret essay text', anonId: 'abc' } })).status, 400);
  const cols = (await db.query("select column_name from information_schema.columns where table_name='events'")).rows.map(r => r.column_name);
  assert.deepEqual(cols.sort(), ['anon_id', 'created_at', 'id', 'name', 'user_id']);
});

test('checkout verify rejects a payment from another account', async () => {
  const s = await call(auth(), { query: { action: 'signup' }, body: { email: 'e@psu.edu', password: 'supersecret1' } });
  const r = await call(checkout(), { query: { action: 'verify' }, body: { sessionId: 'cs_test_1' }, cookie: cookieOf(s) });
  assert.equal(r.status, 403);
});

test('account delete needs the right password', async () => {
  const s = await call(auth(), { query: { action: 'signup' }, body: { email: 'f@psu.edu', password: 'supersecret1' } });
  assert.equal((await call(auth(), { query: { action: 'delete' }, body: { password: 'wrong' }, cookie: cookieOf(s) })).status, 401);
  assert.equal((await call(auth(), { query: { action: 'delete' }, body: { password: 'supersecret1' }, cookie: cookieOf(s) })).status, 200);
  assert.equal((await db.query("select count(*)::int c from users where email='f@psu.edu'")).rows[0].c, 0);
});
