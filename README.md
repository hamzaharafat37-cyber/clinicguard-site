# ClinicGuard Personal

A private daily planner with a built-in security "Guard" and an opt-in AI Planner. Static site plus one Vercel serverless function (`api/plan.js`).

## Run locally

Without AI (everything except the AI Planner):

```bash
python3 -m http.server 8000
```

With AI (needs the Vercel CLI and an Anthropic API key):

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local   # never commit this file
vercel dev
```

## Deploy the AI Planner

1. Get an API key at console.anthropic.com (add billing credits).
2. Vercel → this project → Settings → Environment Variables → add `ANTHROPIC_API_KEY` (Production).
3. Redeploy. The key only lives on the server; the browser never sees it.

## Pages

- **Home** (`/`): one scrolling page: hero, how it works, a live demo of the app, why, privacy, pricing, FAQ.
- **Plan your day** (`#/app`): the same app (Today, Guard, Devices, My data) as a full page. Your tasks are the same in both places.
- **AI Planner** (`#/ai`): paste a messy list, Claude turns it into a plan for today (requires a free account).
- **Account** (`#/account`): sign up, log in, upgrade to Personal with Stripe.

On phones, a bottom bar switches between Home, Plan and AI.

## What works (real, not mocked)

- **Today:** add tasks, quick-add suggestions, offline "first step" for every task, 2-minute start timer, progress ring, day streak.
- **Guard:** private password breach check using the Have I Been Pwned Pwned Passwords range API (k-anonymity). Only the first 5 characters of the SHA-1 hash are sent; the password is never stored. Guard score combines password check recency, unresolved leaks, and device update status. Issues can be added to Today as tasks.
- **Devices:** detects the current device/browser, tracks last update dates, flags devices overdue (>30 days check soon, >60 overdue) with how-to steps.
- **My data:** shows exactly what is stored and what was sent, JSON export, erase everything.
- All data is stored in the browser's localStorage only. No accounts, no server.

- **✨ AI Planner:** brain-dump + time + energy → Claude (`claude-haiku-5-5`) returns a day plan with a first step per block; add blocks to Today. First use shows a consent popup listing exactly what is sent; every AI request is logged in My data. Server limits input to 2,000 characters and ~15 requests/hour per IP (best-effort).

## Honest limits (early version)

- The ⚡ first step on regular tasks uses built-in offline rules; AI first steps come from the AI Planner.
- The rate limit is per server instance, not a full abuse system. Set a monthly spend limit in the Anthropic console.
- Email breach alerts are planned for v2 (an email check can't be fully private, so it will be opt-in).
- Websites can't inspect a device's real update status, so update dates are entered by the user.
- Pricing ($19 one-time) is a planned launch price; the early-access button does not collect data yet.

## Files

- `index.html`, `styles.css`, `app.js`: ClinicGuard Personal
- `api/plan.js`: serverless AI Planner endpoint (holds the API key)
- `msp.html`, `msp-styles.css`, `msp-app.js`: original ClinicGuard clinic/MSP concept site (kept for reference, linked in the footer)
- `assets/`: images used by the MSP concept page

## Accounts, AI and payments (server setup)

Set these in Vercel → Project → Settings → Environment Variables, then redeploy:

| Variable | What it's for | Where it comes from |
|---|---|---|
| `DATABASE_URL` | Neon Postgres: user accounts + sessions | Added automatically when you connect Neon in Vercel (Storage) |
| `ANTHROPIC_API_KEY` | ✨ AI Planner (Claude) | console.anthropic.com |
| `STRIPE_SECRET_KEY` | Stripe Checkout | dashboard.stripe.com → Developers → API keys (`sk_test_...` for testing) |
| `PRICE_CENTS` | Optional price override (default `1900` = $19) | Set to `100` for the $1 live test |

- Tables (`users`, `sessions`) are created automatically on the first request.
- Demo account `demo@demo.com` / `password123!` is created automatically with full paid access (no email verification).
- Passwords are hashed with scrypt. Sessions are random tokens in an HttpOnly cookie; only a SHA-256 of the token is stored.
- Free accounts get 3 AI plans per day; Personal (paid) is unlimited.
- Tasks, devices and streaks still live only in the browser (localStorage).
