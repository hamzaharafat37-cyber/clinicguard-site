// Stripe Checkout: POST /api/checkout?action=create  -> { url } to redirect to Stripe
//                  POST /api/checkout?action=verify  { sessionId } -> marks the account as paid
// Env: STRIPE_SECRET_KEY (sk_test_... while testing, sk_live_... for real money)
//      PRICE_CENTS (optional, default 1900 = $19.00; set to 100 for the $1 live test)

const L = require('./_lib');

async function stripe(path, method, params) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data?.error?.message || `Stripe ${r.status}`); e.status = r.status; throw e; }
  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
  if (!L.getSql()) return res.status(503).json({ error: 'Accounts are not set up yet.' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Payments are not set up yet: STRIPE_SECRET_KEY is missing on the server.' });

  const action = String(req.query?.action || new URL(req.url, 'http://x').searchParams.get('action') || '');
  try {
    await L.ensureSchema();
    const user = await L.currentUser(req);
    if (!user) return res.status(401).json({ error: 'Log in first so we can attach Personal to your account.' });

    if (action === 'create') {
      if (user.plan === 'personal') return res.status(200).json({ already: true });
      const cents = Math.max(50, parseInt(process.env.PRICE_CENTS || '1900', 10) || 1900);
      const origin = L.siteOrigin(req);
      const session = await stripe('checkout/sessions', 'POST', {
        mode: 'payment',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': String(cents),
        'line_items[0][price_data][product_data][name]': 'Comeback · Founding member',
        'line_items[0][price_data][product_data][description]': 'One-time purchase. 100 AI actions a day (fair use), every v1 update.',
        customer_email: user.email,
        client_reference_id: String(user.id),
        'metadata[user_id]': String(user.id),
        success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}#/account`,
        cancel_url: `${origin}/?checkout=cancel#/account`,
      });
      return res.status(200).json({ url: session.url });
    }

    if (action === 'verify') {
      const sessionId = String(L.body(req).sessionId || '');
      if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return res.status(400).json({ error: 'Invalid checkout session.' });
      const s = await stripe(`checkout/sessions/${sessionId}`, 'GET');
      if (String(s.client_reference_id) !== String(user.id)) return res.status(403).json({ error: 'That payment belongs to a different account.' });
      if (s.payment_status !== 'paid') return res.status(402).json({ error: 'Payment not completed yet.' });
      await L.q(`UPDATE users SET plan = 'personal', paid_at = now(), stripe_session = $1 WHERE id = $2`, [sessionId, user.id]);
      const rows = await L.q('SELECT id, email, plan, ai_day, ai_count, display_name FROM users WHERE id = $1', [user.id]);
      return res.status(200).json({ user: L.publicUser(rows[0]) });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error('checkout error:', err.message);
    return res.status(502).json({ error: err.status === 401 ? 'The server\'s Stripe key is invalid.' : 'Payment service error. Please try again.' });
  }
};
