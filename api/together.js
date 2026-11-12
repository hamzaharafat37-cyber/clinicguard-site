// Comeback Together: one trusted buddy who can see THAT you started (never WHAT).
//   GET  /api/together?action=status            -> your prefs, your buddy's shared status, pending invite, inbox
//   GET  /api/together?action=preview&token=... -> inviter's first name only (for the invite page)
//   POST /api/together?action=invite             -> creates a private link (token shown once, only its hash is stored)
//   POST /api/together?action=revoke | accept | decline | disconnect | prefs | focus | ack | nudge | together | seen
//
// Privacy rules enforced here:
// - Tasks, steps, notes and AI text never reach this server, so they can't be shared.
// - Your focus status is stored ONLY while you have a buddy AND sharing is on. Turning sharing off clears it.
// - A buddy is always derived from the caller's own active link. You can't query anyone else.
// - Nudges and "start together" requests: max one per 30 minutes per person (checked here, not in the browser),
//   and never if the receiver turned them off.

const crypto = require('crypto');
const L = require('./_lib');

const INVITE_DAYS = 7;
const NUDGE_COOLDOWN_MIN = 30;
const STALE_MIN = 10; // a session that should have ended this long ago is no longer "focusing"

const nameOf = u => (u && u.display_name) || 'Your buddy';
const cleanName = v => String(v || '').replace(/[<>\n\r\t]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);

async function activeLink(userId) {
  const rows = await L.q(
    `SELECT id, user_a, user_b, created_at FROM buddy_links WHERE ended_at IS NULL AND (user_a = $1 OR user_b = $1) ORDER BY id DESC LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}
async function buddyOf(userId) {
  const link = await activeLink(userId);
  if (!link) return null;
  const otherId = link.user_a === userId ? link.user_b : link.user_a;
  const rows = await L.q('SELECT id, display_name, share_status, allow_nudges FROM users WHERE id = $1', [otherId]);
  return rows[0] ? { ...rows[0], linkId: link.id, connectedAt: link.created_at } : null;
}
async function lastSignal(from, to, kinds) {
  const rows = await L.q(`SELECT created_at FROM buddy_signals WHERE from_user = $1 AND to_user = $2 AND kind = ANY($3) ORDER BY created_at DESC LIMIT 1`, [from, to, kinds]);
  return rows[0] ? new Date(rows[0].created_at).getTime() : 0;
}
const isToday = ts => ts && new Date(ts).toDateString() === new Date().toDateString();

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!L.getSql()) return res.status(503).json({ error: 'Accounts are not set up yet.' });
  const url = new URL(req.url, 'http://x');
  const action = String(req.query?.action || url.searchParams.get('action') || '');
  const b = L.body(req);

  try {
    await L.ensureSchema();

    /* ---------- public: invite preview ---------- */
    if (action === 'preview') {
      if (L.limited(`tp:${L.clientIp(req)}`, 30, 10 * 60 * 1000)) return res.status(429).json({ error: 'Too many requests.' });
      const token = String(req.query?.token || url.searchParams.get('token') || '');
      if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return res.status(200).json({ valid: false });
      const rows = await L.q(
        `SELECT i.status, i.expires_at, u.display_name FROM buddy_invites i JOIN users u ON u.id = i.inviter_id WHERE i.token_hash = $1`,
        [L.sha(token)]
      );
      const inv = rows[0];
      if (!inv) return res.status(200).json({ valid: false });
      const expired = new Date(inv.expires_at).getTime() < Date.now();
      return res.status(200).json({ valid: inv.status === 'pending' && !expired, status: expired ? 'expired' : inv.status, inviterName: inv.display_name || 'Someone' });
    }

    /* ---------- public: decline (token is the proof) ---------- */
    if (action === 'decline') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
      const token = String(b.token || '');
      if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return res.status(400).json({ error: 'Invalid invite.' });
      await L.q(`UPDATE buddy_invites SET status = 'declined', responded_at = now() WHERE token_hash = $1 AND status = 'pending'`, [L.sha(token)]);
      return res.status(200).json({ ok: true });
    }

    /* ---------- everything else needs an account ---------- */
    const me = await L.currentUser(req);
    if (!me) return res.status(401).json({ error: 'Log in to use Comeback Together.', needLogin: true });

    if (action === 'status') {
      const buddy = await buddyOf(me.id);
      const invites = await L.q(`SELECT created_at, expires_at FROM buddy_invites WHERE inviter_id = $1 AND status = 'pending' AND expires_at > now() ORDER BY id DESC LIMIT 1`, [me.id]);
      const inbox = await L.q(
        `SELECT s.id, s.kind, s.created_at, u.display_name FROM buddy_signals s JOIN users u ON u.id = s.from_user
         WHERE s.to_user = $1 AND s.seen_at IS NULL AND s.created_at > now() - interval '24 hours' ORDER BY s.created_at ASC LIMIT 10`,
        [me.id]
      );
      let buddyOut = null;
      if (buddy) {
        let focusing = false, startedAt = null, endsAt = null, showedUpToday = false, acked = false;
        if (buddy.share_status) {
          const fs = (await L.q('SELECT focusing, session_id, started_at, ends_at, ended_at FROM focus_status WHERE user_id = $1', [buddy.id]))[0];
          if (fs) {
            const ends = fs.ends_at ? new Date(fs.ends_at).getTime() : 0;
            focusing = fs.focusing && ends + STALE_MIN * 60000 > Date.now();
            startedAt = fs.started_at; endsAt = focusing ? fs.ends_at : null;
            showedUpToday = isToday(fs.started_at);
            if (fs.session_id) {
              acked = (await L.q(`SELECT 1 FROM buddy_signals WHERE kind = 'ack' AND from_user = $1 AND to_user = $2 AND session_id = $3`, [me.id, buddy.id, fs.session_id])).length > 0;
            }
          }
        }
        const last = await lastSignal(me.id, buddy.id, ['nudge', 'together']);
        const nextAt = last ? last + NUDGE_COOLDOWN_MIN * 60000 : 0;
        buddyOut = {
          name: nameOf(buddy), connectedAt: buddy.connectedAt, sharing: !!buddy.share_status,
          focusing, startedAt: buddy.share_status ? startedAt : null, endsAt, showedUpToday, acked,
          acceptsNudges: !!buddy.allow_nudges, nudgeAvailableAt: nextAt > Date.now() ? new Date(nextAt).toISOString() : null,
        };
      }
      return res.status(200).json({
        me: { name: me.display_name || null, shareStatus: !!me.share_status, allowNudges: !!me.allow_nudges },
        buddy: buddyOut,
        invite: invites[0] ? { createdAt: invites[0].created_at, expiresAt: invites[0].expires_at } : null,
        inbox: inbox.map(s => ({ id: String(s.id), kind: s.kind, from: s.display_name || 'Your buddy', at: s.created_at })),
      });
    }

    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }

    if (action === 'prefs') {
      const sets = []; const vals = [];
      if (b.name !== undefined) { const n = cleanName(b.name); if (n.length < 1) return res.status(400).json({ error: 'Add a first name or nickname.' }); vals.push(n); sets.push(`display_name = $${vals.length}`); }
      if (b.shareStatus !== undefined) { vals.push(!!b.shareStatus); sets.push(`share_status = $${vals.length}`); }
      if (b.allowNudges !== undefined) { vals.push(!!b.allowNudges); sets.push(`allow_nudges = $${vals.length}`); }
      if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });
      vals.push(me.id);
      await L.q(`UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
      if (b.shareStatus === false) await L.q('DELETE FROM focus_status WHERE user_id = $1', [me.id]); // stop sharing = forget status
      return res.status(200).json({ ok: true });
    }

    if (action === 'invite') {
      if (L.limited(`ti:${me.id}`, 10, 60 * 60 * 1000)) return res.status(429).json({ error: 'Too many invites. Try again later.' });
      if (!me.display_name) return res.status(400).json({ error: 'Add your first name first, so your buddy knows who invited them.', needName: true });
      if (await activeLink(me.id)) return res.status(409).json({ error: 'You already have a buddy. Disconnect first to invite someone else.' });
      await L.q(`UPDATE buddy_invites SET status = 'revoked', responded_at = now() WHERE inviter_id = $1 AND status = 'pending'`, [me.id]);
      const token = crypto.randomBytes(24).toString('base64url');
      await L.q(`INSERT INTO buddy_invites (token_hash, inviter_id, expires_at) VALUES ($1, $2, now() + interval '${INVITE_DAYS} days')`, [L.sha(token), me.id]);
      return res.status(200).json({ url: `${L.siteOrigin(req)}/#/join/${token}`, expiresInDays: INVITE_DAYS });
    }

    if (action === 'revoke') {
      await L.q(`UPDATE buddy_invites SET status = 'revoked', responded_at = now() WHERE inviter_id = $1 AND status = 'pending'`, [me.id]);
      return res.status(200).json({ ok: true });
    }

    if (action === 'accept') {
      const token = String(b.token || '');
      if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return res.status(400).json({ error: 'Invalid invite.' });
      if (L.limited(`ta:${L.clientIp(req)}`, 20, 10 * 60 * 1000)) return res.status(429).json({ error: 'Too many attempts.' });
      const inv = (await L.q(`SELECT id, inviter_id, status, expires_at FROM buddy_invites WHERE token_hash = $1`, [L.sha(token)]))[0];
      if (!inv || inv.status !== 'pending' || new Date(inv.expires_at).getTime() < Date.now()) return res.status(410).json({ error: 'This invite is no longer valid. Ask for a new link.' });
      if (inv.inviter_id === me.id) return res.status(400).json({ error: 'That\'s your own invite. Send it to someone you trust.' });
      if (await activeLink(me.id)) return res.status(409).json({ error: 'You already have a buddy. Disconnect first to accept this one.' });
      if (await activeLink(inv.inviter_id)) return res.status(409).json({ error: 'They already connected with someone else.' });
      const name = cleanName(b.name);
      if (name) await L.q('UPDATE users SET display_name = $1 WHERE id = $2', [name, me.id]);
      else if (!me.display_name) return res.status(400).json({ error: 'Add your first name so they know it\'s you.', needName: true });
      // claim the invite atomically (only one person can accept it)
      const claimed = await L.q(`UPDATE buddy_invites SET status = 'accepted', responded_at = now(), accepted_by = $1 WHERE id = $2 AND status = 'pending' RETURNING id`, [me.id, inv.id]);
      if (!claimed.length) return res.status(410).json({ error: 'This invite was already used.' });
      await L.q(`INSERT INTO buddy_links (user_a, user_b) VALUES ($1, $2)`, [inv.inviter_id, me.id]);
      await L.q('UPDATE users SET share_status = $1 WHERE id = $2', [b.shareStatus !== false, me.id]);
      await L.q(`INSERT INTO buddy_signals (kind, from_user, to_user) VALUES ('joined', $1, $2)`, [me.id, inv.inviter_id]);
      return res.status(200).json({ ok: true });
    }

    if (action === 'disconnect') {
      const link = await activeLink(me.id);
      if (link) await L.q('UPDATE buddy_links SET ended_at = now() WHERE id = $1', [link.id]);
      await L.q('DELETE FROM focus_status WHERE user_id = $1', [me.id]);
      return res.status(200).json({ ok: true });
    }

    if (action === 'focus') {
      const state = b.state === 'end' ? 'end' : 'start';
      const buddy = await buddyOf(me.id);
      if (!buddy || !me.share_status) return res.status(200).json({ shared: false }); // nothing stored
      if (state === 'start') {
        const minutes = Math.max(1, Math.min(120, parseInt(b.minutes, 10) || 5));
        const sid = crypto.randomBytes(9).toString('base64url');
        await L.q(
          `INSERT INTO focus_status (user_id, focusing, session_id, started_at, ends_at, ended_at, updated_at)
           VALUES ($1, true, $2, now(), now() + ($3 || ' minutes')::interval, NULL, now())
           ON CONFLICT (user_id) DO UPDATE SET focusing = true, session_id = EXCLUDED.session_id, started_at = now(), ends_at = EXCLUDED.ends_at, ended_at = NULL, updated_at = now()`,
          [me.id, sid, String(minutes)]
        );
      } else if (b.extend) {
        const minutes = Math.max(1, Math.min(120, parseInt(b.minutes, 10) || 5));
        await L.q(`UPDATE focus_status SET ends_at = now() + ($2 || ' minutes')::interval, focusing = true, updated_at = now() WHERE user_id = $1`, [me.id, String(minutes)]);
      } else {
        await L.q(`UPDATE focus_status SET focusing = false, ended_at = now(), updated_at = now() WHERE user_id = $1`, [me.id]);
      }
      return res.status(200).json({ shared: true, buddyName: nameOf(buddy) });
    }

    if (action === 'ack') {
      const buddy = await buddyOf(me.id);
      if (!buddy) return res.status(404).json({ error: 'No buddy connected.' });
      if (!buddy.share_status) return res.status(403).json({ error: 'Your buddy isn\'t sharing right now.' });
      const fs = (await L.q('SELECT session_id, started_at FROM focus_status WHERE user_id = $1', [buddy.id]))[0];
      if (!fs || !fs.session_id || !isToday(fs.started_at)) return res.status(409).json({ error: 'Nothing to acknowledge yet.' });
      const dup = await L.q(`SELECT 1 FROM buddy_signals WHERE kind = 'ack' AND from_user = $1 AND to_user = $2 AND session_id = $3`, [me.id, buddy.id, fs.session_id]);
      if (!dup.length) await L.q(`INSERT INTO buddy_signals (kind, from_user, to_user, session_id) VALUES ('ack', $1, $2, $3)`, [me.id, buddy.id, fs.session_id]);
      return res.status(200).json({ ok: true });
    }

    if (action === 'nudge' || action === 'together') {
      const buddy = await buddyOf(me.id);
      if (!buddy) return res.status(404).json({ error: 'No buddy connected.' });
      if (!buddy.allow_nudges) return res.status(403).json({ error: `${nameOf(buddy)} has encouragement turned off right now.` });
      const last = await lastSignal(me.id, buddy.id, ['nudge', 'together']);
      const wait = last + NUDGE_COOLDOWN_MIN * 60000 - Date.now();
      if (wait > 0) return res.status(429).json({ error: `You can send another in ${Math.ceil(wait / 60000)} min.`, retryAfterMin: Math.ceil(wait / 60000) });
      await L.q(`INSERT INTO buddy_signals (kind, from_user, to_user) VALUES ($1, $2, $3)`, [action, me.id, buddy.id]);
      return res.status(200).json({ ok: true });
    }

    if (action === 'seen') {
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(x => parseInt(x, 10)).filter(Number.isFinite).slice(0, 20);
      if (ids.length) await L.q('UPDATE buddy_signals SET seen_at = now() WHERE to_user = $1 AND id = ANY($2) AND seen_at IS NULL', [me.id, ids]);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error('together error:', err.message);
    return res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  }
};
