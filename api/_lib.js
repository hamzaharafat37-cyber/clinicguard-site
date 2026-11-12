// Shared server helpers: Neon database, password hashing, sessions.
// Files starting with "_" inside /api are not exposed as routes by Vercel.
// Env: DATABASE_URL (added automatically when you connect Neon in Vercel).

const crypto = require('crypto');

const DEMO_EMAIL = 'demo@demo.com';
const DEMO_PASSWORD = 'password123!';
const SESSION_DAYS = 30;
const COOKIE = 'cg_session';
const FREE_AI_PER_DAY = 5;
const PAID_AI_PER_DAY = 100; // fair use for founding members
const MODEL = 'claude-haiku-5-5';

let sqlClient = null;
function getSql() {
  if (global.__cgTestSql) return global.__cgTestSql; // local tests only
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return null;
  if (!sqlClient) {
    const { neon } = require('@neondatabase/serverless');
    sqlClient = neon(url);
  }
  return sqlClient;
}

const q = async (text, params = []) => getSql().query(text, params);

// ---------- passwords (scrypt, built into Node) ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const got = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, got);
}

// ---------- schema + demo account (runs once per server instance) ----------
let ready = null;
function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      await q(`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'free',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_login TIMESTAMPTZ,
        ai_day DATE,
        ai_count INT NOT NULL DEFAULT 0,
        paid_at TIMESTAMPTZ,
        stripe_session TEXT
      )`);
      await q(`CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL
      )`);
      await q(`CREATE TABLE IF NOT EXISTS events (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        anon_id TEXT,
        user_id INT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await q(`CREATE TABLE IF NOT EXISTS ai_usage (
        id BIGSERIAL PRIMARY KEY,
        user_id INT,
        kind TEXT NOT NULL,
        input_tokens INT,
        output_tokens INT,
        ok BOOLEAN NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await q(`DELETE FROM sessions WHERE expires_at < now()`);
      // Comeback Together (buddy system). Additive changes only.
      await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT`);
      await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS share_status BOOLEAN NOT NULL DEFAULT false`);
      await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS allow_nudges BOOLEAN NOT NULL DEFAULT true`);
      await q(`CREATE TABLE IF NOT EXISTS buddy_invites (
        id BIGSERIAL PRIMARY KEY,
        token_hash TEXT UNIQUE NOT NULL,
        inviter_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        responded_at TIMESTAMPTZ,
        accepted_by INT REFERENCES users(id) ON DELETE SET NULL
      )`);
      await q(`CREATE TABLE IF NOT EXISTS buddy_links (
        id BIGSERIAL PRIMARY KEY,
        user_a INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_b INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ended_at TIMESTAMPTZ
      )`);
      await q(`CREATE TABLE IF NOT EXISTS focus_status (
        user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        focusing BOOLEAN NOT NULL DEFAULT false,
        session_id TEXT,
        started_at TIMESTAMPTZ,
        ends_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await q(`CREATE TABLE IF NOT EXISTS buddy_signals (
        id BIGSERIAL PRIMARY KEY,
        kind TEXT NOT NULL,
        from_user INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        to_user INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        seen_at TIMESTAMPTZ
      )`);
      // Demo account for graders: always exists, full paid access, no email verification.
      await q(
        `INSERT INTO users (email, password_hash, plan, paid_at) VALUES ($1, $2, 'personal', now())
         ON CONFLICT (email) DO UPDATE SET plan = 'personal', password_hash = EXCLUDED.password_hash`,
        [DEMO_EMAIL, hashPassword(DEMO_PASSWORD)]
      );
      await q(`UPDATE users SET display_name = 'Demo' WHERE email = $1 AND display_name IS NULL`, [DEMO_EMAIL]);
    })().catch(err => { ready = null; throw err; });
  }
  return ready;
}

// ---------- sessions ----------
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function isLocal(req) {
  const host = String(req.headers.host || '');
  return host.startsWith('localhost') || host.startsWith('127.0.0.1');
}

function setSessionCookie(req, res, token, maxAge) {
  const secure = isLocal(req) ? '' : '; Secure';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

async function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await q(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [sha(token), userId]);
  await q('UPDATE users SET last_login = now() WHERE id = $1', [userId]);
  setSessionCookie(req, res, token, SESSION_DAYS * 86400);
}

async function destroySession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await q('DELETE FROM sessions WHERE token_hash = $1', [sha(token)]);
  setSessionCookie(req, res, '', 0);
}

async function currentUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const rows = await q(
    `SELECT u.id, u.email, u.plan, u.ai_day, u.ai_count, u.created_at, u.display_name, u.share_status, u.allow_nudges FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha(token)]
  );
  return rows[0] || null;
}

const todayStr = () => new Date().toISOString().slice(0, 10);
function aiUsedToday(u) {
  const day = u.ai_day ? new Date(u.ai_day).toISOString().slice(0, 10) : null;
  return day === todayStr() ? u.ai_count : 0;
}
const aiLimit = u => (u.plan === 'personal' ? PAID_AI_PER_DAY : FREE_AI_PER_DAY);
function publicUser(u) {
  if (!u) return null;
  const paid = u.plan === 'personal';
  return { email: u.email, name: u.display_name || null, plan: paid ? 'personal' : 'free', aiLimit: aiLimit(u), aiLeft: Math.max(0, aiLimit(u) - aiUsedToday(u)) };
}

// Atomically reserve one AI action for today. Returns remaining count, or null if the daily limit is reached.
// One UPDATE statement, so parallel requests can't slip past the limit.
async function reserveAi(u) {
  const today = todayStr();
  const rows = await q(
    `UPDATE users SET ai_count = CASE WHEN ai_day = $1::date THEN ai_count + 1 ELSE 1 END, ai_day = $1::date
     WHERE id = $2 AND (ai_day IS DISTINCT FROM $1::date OR ai_count < $3)
     RETURNING ai_count`,
    [today, u.id, aiLimit(u)]
  );
  return rows.length ? aiLimit(u) - rows[0].ai_count : null;
}
async function refundAi(u) {
  await q(`UPDATE users SET ai_count = GREATEST(ai_count - 1, 0) WHERE id = $1 AND ai_day = $2::date`, [u.id, todayStr()]);
}

// Call Claude and return the text. Records token usage (never the content).
async function callClaude({ system, user, maxTokens = 1500, kind, userId }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { const e = new Error('AI is not set up yet: ANTHROPIC_API_KEY is missing on the server.'); e.status = 503; throw e; }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  const data = await r.json().catch(() => ({}));
  const usage = data.usage || {};
  q('INSERT INTO ai_usage (user_id, kind, input_tokens, output_tokens, ok) VALUES ($1, $2, $3, $4, $5)',
    [userId || null, kind, usage.input_tokens || null, usage.output_tokens || null, r.ok]).catch(() => {});
  if (!r.ok) {
    console.error('Anthropic API error:', r.status, data?.error?.type || '');
    const e = new Error(r.status === 401 ? "The server's AI key is invalid." : 'The AI service returned an error. Please try again.');
    e.status = 502; throw e;
  }
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

function extractJson(text) {
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON in model output');
  return JSON.parse(text.slice(start, end + 1));
}

function body(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  return b || {};
}

function clientIp(req) {
  return String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || 'unknown').slice(0, 64);
}

// simple per-instance limiter
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const list = (buckets.get(key) || []).filter(t => now - t < windowMs);
  if (list.length >= max) return true;
  list.push(now); buckets.set(key, list); return false;
}

function siteOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (isLocal(req) ? 'http' : 'https');
  return `${proto}://${host}`;
}

module.exports = {
  getSql, q, ensureSchema, hashPassword, verifyPassword, createSession, destroySession, currentUser,
  sha, publicUser, aiUsedToday, todayStr, reserveAi, refundAi, callClaude, extractJson, aiLimit, PAID_AI_PER_DAY, body, clientIp, limited, siteOrigin, FREE_AI_PER_DAY, DEMO_EMAIL,
};
