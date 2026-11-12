# Lumio (formerly ClinicGuard Personal)

**Lumio Together: starting is easier together.**

One small first step, a calm five-minute start, and (optionally) one trusted buddy who sees *that* you showed up, never *what* you're working on.
Type the thing you keep putting off → get one tiny first step → do it in a short focus session → if you get distracted, one tap brings you back to the exact step.

Live: https://clinicguard-site.vercel.app

## What's in the app

- **Landing** (`/`): one promise, one input. Visitors can start without an account.
- **Now** (`#/now`): "What are you avoiding?" → editable steps (✨ AI with an account, quick rule-based steps without) → Start (5/10/25 min).
- **Focus mode**: one step on screen, timer, **I'm stuck** (makes the step smaller), **I got distracted** (pause + restart with 5 min), auto "welcome back" if you leave the tab for 45+ seconds or reload mid-session.
- **Still on your list / Resume**: unfinished tasks pick up at the exact step.
- **Times without the fuss**: type "meeting with Sarah 3pm" or "lab report by Friday". Parsed on the device (`when.js`), no AI.
- **Missed list, nothing moves on its own**: when a time passes, the item waits in "Missed". Events: It happened / Reschedule with them (creates a ready-to-send first step) / Drop. Tasks: Do 5 min now / Tomorrow / No deadline / Drop.
- **Undo everywhere**: every move, drop, check-off and step change shows an Undo button for 6 seconds.
- **Reorder**: drag the ⋮⋮ handle (mouse or finger) or use arrow keys on it.
- **One finger on phones**: the add box sits at the bottom near your thumb, every tap target is at least 48px, short vibrations on Android.
- **Mouse and keyboard**: hover states, drag to reorder, `N` or `/` to add, and in focus mode `Enter` done, `Space` pause, `S` stuck, `D` distracted, `Esc` stop.
- **Works offline and installs like an app**: service worker (`sw.js`, network first, never caches `/api`) and `manifest.webmanifest`. On iPhone: Share → Add to Home Screen.
- **Progress**: started this week, finished, median time to start, comebacks.
- **Account** (`#/account`): sign up / log in (Neon), Stripe upgrade, your-data table, export, erase device data, delete account.
- **Labs** (`/legacy/`): the old planner + Guard (breach check, devices), kept for reference.

## Where data lives

| Where | What |
|---|---|
| Browser (localStorage `comeback:v1`) | Tasks, steps, sessions, recoveries |
| Neon (only with an account) | Email, scrypt password hash, plan, today's AI count, sessions |
| Neon `events` | Event name + random browser id + user id + time. Never task text |
| Neon `ai_usage` | Token counts per AI call, for cost tracking. Never content |
| Anthropic | Only the task/step text sent when the user taps an AI button |

## Limits and pricing

- Free account: 5 AI actions/day. Founding member ($19 once, Stripe): 100/day fair use.
- Limits are enforced on the server with one atomic SQL update (parallel requests can't exceed it). Failed AI calls are refunded.

## Environment variables (Vercel → Settings → Environment Variables)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon (added automatically when Neon is connected) |
| `ANTHROPIC_API_KEY` | Claude for AI steps |
| `STRIPE_SECRET_KEY` | Stripe Checkout (`sk_test_...` for testing) |
| `PRICE_CENTS` | Optional, default `1900`. Set `100` for the $1 live test |

Tables are created automatically. Demo account `demo@demo.com` / `password123!` is created automatically with paid access and can't be deleted.

## Tests

```
npm install
npm test
```
Runs the API tests (including 12 buddy privacy/consent/cooldown tests) against an in-memory Postgres with mocked Claude and Stripe (no keys needed): auth, demo account, AI validation, the parallel AI-limit check, refunds, events privacy, checkout ownership, account deletion.

## Useful Neon queries (validation metrics)

```sql
-- funnel, last 7 days (unique browsers)
SELECT name, COUNT(DISTINCT anon_id) FROM events WHERE created_at > now() - interval '7 days' GROUP BY name ORDER BY 2 DESC;
-- AI cost estimate, last 30 days (Haiku 5.5: $0.10 in / $0.50 out per million tokens)
SELECT COUNT(*) calls, ROUND((SUM(input_tokens)*0.10 + SUM(output_tokens)*0.50)/1e6, 4) AS usd FROM ai_usage WHERE created_at > now() - interval '30 days';
-- users for the class screenshot
SELECT id, email, plan, created_at FROM users ORDER BY id;
```

## Known limits

- No password reset yet (needs an email service).
- No Stripe webhook yet: payment is confirmed when the buyer returns to the site.
- The web app can't see or block other apps or sites. The browser extension is the next step.
- Tasks don't sync across devices yet.

## Lumio Together (buddy system)

- **Invite** (`#/together`): creates a private, single-use link (`#/join/<token>`), valid 7 days. Only a SHA-256 hash of the token is stored.
- **Join** (`#/join/<token>`): shows who invited you and exactly what each person can and can't see. Sharing is off unless you tick it.
- **Sharing**: when on, your buddy sees "started" / "focusing now" / "showed up today". Turning it off deletes your focus status immediately. "Go solo" turns off sharing and encouragement.
- **Encouragement**: "Still there? You've got this." and "Start together" are limited to one per 30 minutes per person, **enforced on the server**, and blocked if the receiver turned them off.
- **"Someone saw you show up today."**: your buddy can acknowledge a session once.
- **Disconnect** at any time; one buddy at a time.
- Updates arrive by polling every 20 seconds (no live websocket).

API: `api/together.js` (actions: status, preview, invite, revoke, accept, decline, disconnect, prefs, focus, ack, nudge, together, seen). Tables: `buddy_invites`, `buddy_links`, `focus_status`, `buddy_signals`, plus `users.display_name`, `users.share_status`, `users.allow_nudges` (all created automatically, additive only).

## The experience

- **Start** (`#/now`): "What's one thing you want to start?" → **Help me begin** (AI or quick first step) or **I already know my first step**.
- **First step card**: Start now · Make it smaller · Try another step · Edit this step, plus the whole plan (editable, with times).
- **Five-minute start**: calm animated orb that shifts color as time passes, pause/resume, end early (never punished), keep going, "I'm stuck", "I got distracted", buddy indicator.
- **"You started. That counts."**: Keep going / Take a break / Finish for now, with an optional private "What helped you start today?".
- **Progress** (`#/progress`): sentences instead of streaks, a 4-week constellation, things you're proud of, reflections, and a daily reminder you add to your own calendar (.ics). No push notifications.
- First-launch intro (3 slides, skippable), dark mode (toggle or system), reduced-motion support, keyboard shortcuts, mobile bottom tabs.
