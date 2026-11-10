// Accounts: POST /api/auth?action=signup|login|logout, GET /api/auth?action=me
// Stored in Neon Postgres. Passwords are hashed with scrypt; sessions are random tokens
// kept in an HttpOnly cookie (only a SHA-256 of the token is stored in the database).

const L = require('./_lib');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!L.getSql()) return res.status(503).json({ error: 'Accounts are not set up yet: connect a Neon database in Vercel.' });

  const action = String(req.query?.action || new URL(req.url, 'http://x').searchParams.get('action') || '');
  try {
    await L.ensureSchema();

    if (action === 'me') {
      return res.status(200).json({ user: L.publicUser(await L.currentUser(req)) });
    }

    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }

    if (action === 'logout') {
      await L.destroySession(req, res);
      return res.status(200).json({ user: null });
    }

    if (action === 'signup' || action === 'login') {
      if (L.limited(`auth:${L.clientIp(req)}`, 20, 10 * 60 * 1000)) {
        return res.status(429).json({ error: 'Too many attempts. Wait a few minutes and try again.' });
      }
      const b = L.body(req);
      const email = String(b.email || '').trim().toLowerCase().slice(0, 254);
      const password = String(b.password || '');
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
      if (password.length > 200) return res.status(400).json({ error: 'That password is too long.' });

      if (action === 'signup') {
        if (password.length < 8) return res.status(400).json({ error: 'Use at least 8 characters for your password.' });
        const exists = await L.q('SELECT 1 FROM users WHERE email = $1', [email]);
        if (exists.length) return res.status(409).json({ error: 'An account with that email already exists. Try logging in.' });
        const rows = await L.q('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id', [email, L.hashPassword(password)]);
        await L.createSession(req, res, rows[0].id);
      } else {
        const rows = await L.q('SELECT id, password_hash FROM users WHERE email = $1', [email]);
        if (!rows.length || !L.verifyPassword(password, rows[0].password_hash)) {
          return res.status(401).json({ error: 'Wrong email or password.' });
        }
        await L.createSession(req, res, rows[0].id);
      }
      const rows = await L.q('SELECT id, email, plan, ai_day, ai_count FROM users WHERE email = $1', [email]);
      return res.status(200).json({ user: L.publicUser(rows[0]) });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error('auth error:', err.message);
    return res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  }
};
