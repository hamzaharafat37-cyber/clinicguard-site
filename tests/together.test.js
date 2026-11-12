// Comeback Together: privacy, consent, authorization and cooldown tests (in-memory Postgres, no network).
const test = require('node:test');
const assert = require('node:assert');

let db;
global.fetch = async () => { throw new Error('no network in tests'); };

function call(handler, { method = 'POST', query = {}, body = {}, cookie = '', ip = '1.2.3.4' } = {}) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(query).toString();
    const req = { method, query, body, headers: { cookie, host: 'localhost:3000', 'x-forwarded-for': ip }, url: `/api/together?${qs}`, socket: {} };
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: o, cookie: this.headers['set-cookie'] }); return this; }, end() { resolve({ status: this.statusCode, body: null }); return this; } };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}
const auth = () => require('../api/auth');
const T = () => require('../api/together');
const signup = async email => { const r = await call(auth(), { query: { action: 'signup' }, body: { email, password: 'supersecret1' } }); return r.cookie.split(';')[0]; };
const tg = (action, cookie, body = {}, method = 'POST', extra = {}) => call(T(), { method, query: { action, ...extra }, body, cookie });

let A, B, C, token;

test.before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  global.__cgTestSql = { query: async (t, p) => (await db.query(t, p)).rows };
  A = await signup('a@psu.edu'); B = await signup('b@psu.edu'); C = await signup('c@psu.edu');
});

test('requires login', async () => {
  assert.equal((await tg('status', '', {}, 'GET')).status, 401);
});

test('invite needs a name, link token is only stored hashed', async () => {
  const r0 = await tg('invite', A); assert.equal(r0.status, 400); assert.equal(r0.body.needName, true);
  assert.equal((await tg('prefs', A, { name: '  Hamzah <b>  ' })).status, 200);
  const r = await tg('invite', A); assert.equal(r.status, 200);
  token = r.body.url.split('#/join/')[1];
  assert.ok(token.length >= 20);
  const stored = (await db.query('select token_hash from buddy_invites')).rows;
  assert.ok(stored.every(x => x.token_hash !== token));
  const p = await tg('preview', '', {}, 'GET', { token });
  assert.deepEqual(p.body, { valid: true, status: 'pending', inviterName: 'Hamzah b' });
});

test('cannot accept your own invite; invite is single-use', async () => {
  assert.equal((await tg('accept', A, { token })).status, 400);
  const ok = await tg('accept', B, { token, name: 'Sam', shareStatus: true });
  assert.equal(ok.status, 200);
  assert.equal((await tg('accept', C, { token, name: 'Cara' })).status, 410);
});

test('a stranger sees nothing', async () => {
  const s = await tg('status', C, {}, 'GET');
  assert.equal(s.body.buddy, null);
  assert.equal((await tg('ack', C)).status, 404);
  assert.equal((await tg('nudge', C)).status, 404);
});

test('nothing is stored or shared until the user opts in', async () => {
  const f = await tg('focus', A, { state: 'start', minutes: 5 });
  assert.equal(f.body.shared, false); // A never turned sharing on
  assert.equal((await db.query('select count(*)::int c from focus_status')).rows[0].c, 0);
  const sb = await tg('status', B, {}, 'GET');
  assert.equal(sb.body.buddy.name, 'Hamzah b'); assert.equal(sb.body.buddy.sharing, false); assert.equal(sb.body.buddy.focusing, false);
});

test('with sharing on, buddy sees THAT you started, never what', async () => {
  await tg('prefs', A, { shareStatus: true });
  const f = await tg('focus', A, { state: 'start', minutes: 5, task: 'secret essay' });
  assert.equal(f.body.shared, true);
  const sb = await tg('status', B, {}, 'GET');
  assert.equal(sb.body.buddy.focusing, true); assert.equal(sb.body.buddy.showedUpToday, true);
  assert.ok(!JSON.stringify(sb.body).includes('secret'));
  assert.deepEqual(Object.keys(sb.body.buddy).sort(), ['acceptsNudges', 'acked', 'connectedAt', 'endsAt', 'focusing', 'name', 'nudgeAvailableAt', 'sharing', 'showedUpToday', 'startedAt'].sort());
  const cols = (await db.query("select column_name from information_schema.columns where table_name='focus_status'")).rows.map(r => r.column_name);
  assert.ok(!cols.some(c => /task|note|title|step/.test(c)));
});

test('acknowledgment reaches the other person once per session', async () => {
  assert.equal((await tg('ack', B)).status, 200);
  assert.equal((await tg('ack', B)).status, 200); // idempotent
  const sa = await tg('status', A, {}, 'GET');
  const acks = sa.body.inbox.filter(x => x.kind === 'ack');
  assert.equal(acks.length, 1); assert.equal(acks[0].from, 'Sam');
  await tg('seen', A, { ids: sa.body.inbox.map(x => x.id) });
  assert.equal((await tg('status', A, {}, 'GET')).body.inbox.length, 0);
  assert.equal((await tg('status', B, {}, 'GET')).body.buddy.acked, true);
});

test('encouragement: one per 30 minutes, enforced on the server, and can be turned off', async () => {
  assert.equal((await tg('nudge', B)).status, 200);
  const again = await tg('nudge', B); assert.equal(again.status, 429); assert.ok(again.body.retryAfterMin > 0);
  assert.equal((await tg('together', B)).status, 429); // shares the same cooldown
  assert.ok((await tg('status', B, {}, 'GET')).body.buddy.nudgeAvailableAt);
  await tg('prefs', A, { allowNudges: false });
  await db.query("update buddy_signals set created_at = now() - interval '31 minutes'");
  assert.equal((await tg('nudge', B)).status, 403);
  await tg('prefs', A, { allowNudges: true });
  assert.equal((await tg('nudge', B)).status, 200);
});

test('pausing sharing forgets your status immediately', async () => {
  await tg('prefs', A, { shareStatus: false });
  assert.equal((await db.query('select count(*)::int c from focus_status where user_id = (select id from users where email=$1)', ['a@psu.edu'])).rows[0].c, 0);
  const sb = await tg('status', B, {}, 'GET');
  assert.equal(sb.body.buddy.sharing, false); assert.equal(sb.body.buddy.focusing, false); assert.equal(sb.body.buddy.startedAt, null);
  assert.equal((await tg('ack', B)).status, 403);
});

test('only one buddy at a time', async () => {
  await tg('prefs', C, { name: 'Cara' });
  const r = await tg('invite', A); assert.equal(r.status, 409);
});

test('disconnect ends it for both people', async () => {
  assert.equal((await tg('disconnect', B)).status, 200);
  assert.equal((await tg('status', A, {}, 'GET')).body.buddy, null);
  assert.equal((await tg('status', B, {}, 'GET')).body.buddy, null);
  assert.equal((await tg('nudge', A)).status, 404);
});

test('decline and revoke', async () => {
  const r = await tg('invite', A); const t2 = r.body.url.split('#/join/')[1];
  assert.equal((await tg('decline', '', { token: t2 })).status, 200);
  assert.equal((await tg('preview', '', {}, 'GET', { token: t2 })).body.status, 'declined');
  const r3 = await tg('invite', A); const t3 = r3.body.url.split('#/join/')[1];
  await tg('revoke', A);
  assert.equal((await tg('accept', C, { token: t3 })).status, 410);
  assert.equal((await tg('preview', '', {}, 'GET', { token: 'not-a-real-token-at-all-xx' })).body.valid, false);
});
