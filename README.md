# Comeback (formerly ClinicGuard Personal)

**Start what you're avoiding. Come back when you drift.**
Type the thing you keep putting off → get one tiny first step → do it in a short focus session → if you get distracted, one tap brings you back to the exact step.

Live: https://clinicguard-site.vercel.app

## What's in the app

- **Landing** (`/`): one promise, one input. Visitors can start without an account.
- **Now** (`#/now`): "What are you avoiding?" → editable steps (✨ AI with an account, quick rule-based steps without) → Start (5/10/25 min).
- **Focus mode**: one step on screen, timer, **I'm stuck** (makes the step smaller), **I got distracted** (pause + restart with 5 min), auto "welcome back" if you leave the tab for 45+ seconds or reload mid-session.
- **Still on your list / Resume**: unfinished tasks pick up at the exact step.
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
Runs the API tests against an in-memory Postgres with mocked Claude and Stripe (no keys needed): auth, demo account, AI validation, the parallel AI-limit check, refunds, events privacy, checkout ownership, account deletion.

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
