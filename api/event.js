// Privacy-respecting product analytics: POST /api/event { name, anonId }
// Stores only an event name from a fixed list, a random per-browser id, the user id if logged in,
// and a timestamp. Never task text, titles, URLs or anything typed by the user.

const L = require('./_lib');

const ALLOWED = new Set([
  'visit', 'task_created', 'ai_breakdown', 'quick_steps', 'session_started', 'step_done', 'stuck',
  'distracted', 'recovered', 'task_finished', 'signup', 'login', 'checkout_started', 'paid',
  'own_step', 'another_step', 'session_ended_early', 'kept_going', 'reflection', 'onboarded',
  'buddy_invite', 'buddy_joined', 'nudge_sent', 'ack_sent', 'together_started', 'calendar_reminder',
]);

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
  if (!L.getSql()) return res.status(204).end();
  const b = L.body(req);
  const name = String(b.name || '');
  const anonId = String(b.anonId || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || null;
  if (!ALLOWED.has(name)) return res.status(400).json({ error: 'Unknown event.' });
  if (L.limited(`ev:${L.clientIp(req)}`, 300, 60 * 60 * 1000)) return res.status(429).json({ error: 'Slow down.' });
  try {
    await L.ensureSchema();
    const user = await L.currentUser(req).catch(() => null);
    await L.q('INSERT INTO events (name, anon_id, user_id) VALUES ($1, $2, $3)', [name, anonId, user ? user.id : null]);
    return res.status(204).end();
  } catch (e) {
    console.error('event error:', e.message);
    return res.status(204).end(); // analytics must never break the app
  }
};
