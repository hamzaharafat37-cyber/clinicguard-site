// Shared server helpers: Neon database, password hashing, sessions.
// Files starting with "_" inside /api are not exposed as routes by Vercel.
// Env: DATABASE_URL (added automatically when you connect Neon in Vercel).

const crypto = require('crypto');

const DEMO_EMAIL = 'demo@demo.com';
const DEMO_PASSWORD = 'password123!';
const SESSION_DAYS = 30;
const COOKIE = 'cg_session';
const FREE_AI_PER_DAY = 3;

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
      // Demo account for graders: always exists, full paid access, no email verification.
      await q(
        `INSERT INTO users (email, password_hash, plan, paid_at) VALUES ($1, $2, 'personal', now())
         ON CONFLICT (email) DO UPDATE SET plan = 'personal', password_hash = EXCLUDED.password_hash`,
        [DEMO_EMAIL, hashPassword(DEMO_PASSWORD)]
      );
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
    `SELECT u.id, u.email, u.plan, u.ai_day, u.ai_count, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id
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
function publicUser(u) {
  if (!u) return null;
  const paid = u.plan === 'personal';
  return { email: u.email, plan: paid ? 'personal' : 'free', aiLeft: paid ? null : Math.max(0, FREE_AI_PER_DAY - aiUsedToday(u)) };
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
  publicUser, aiUsedToday, todayStr, body, clientIp, limited, siteOrigin, FREE_AI_PER_DAY, DEMO_EMAIL,
};
