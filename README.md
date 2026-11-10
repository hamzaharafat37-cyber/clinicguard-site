# ClinicGuard Personal

A private daily planner with a built-in security "Guard". Static site, no build step, no API keys.

## Run locally

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000.

## What works (real, not mocked)

- **Today:** add tasks, quick-add suggestions, offline "first step" for every task, 2-minute start timer, progress ring, day streak.
- **Guard:** private password breach check using the Have I Been Pwned Pwned Passwords range API (k-anonymity). Only the first 5 characters of the SHA-1 hash are sent; the password is never stored. Guard score combines password check recency, unresolved leaks, and device update status. Issues can be added to Today as tasks.
- **Devices:** detects the current device/browser, tracks last update dates, flags devices overdue (>30 days check soon, >60 overdue) with how-to steps.
- **My data:** shows exactly what is stored and what was sent, JSON export, erase everything.
- All data is stored in the browser's localStorage only. No accounts, no server.

## Honest limits (early version)

- "First step" uses built-in rules, not AI.
- Email breach alerts are planned for v2 (an email check can't be fully private, so it will be opt-in).
- Websites can't inspect a device's real update status, so update dates are entered by the user.
- Pricing ($19 one-time) is a planned launch price; the early-access button does not collect data yet.

## Files

- `index.html`, `styles.css`, `app.js`: ClinicGuard Personal (homepage)
- `msp.html`, `msp-styles.css`, `msp-app.js`: original ClinicGuard clinic/MSP concept site (kept for reference, linked in the footer)
- `assets/`: images used by the MSP concept page
