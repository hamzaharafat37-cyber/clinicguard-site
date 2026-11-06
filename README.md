# ClinicGuard — Interactive Website Concept

A fully self-contained, responsive HTML/CSS/JavaScript concept website for ClinicGuard, based on the user's supplied indigo–aqua–lavender reference and generated visual direction.

## Run locally

Open `index.html` in a browser, or serve the folder with:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000.

No npm installation or API keys needed.

## What's interactive

- Responsive nav and scroll transitions
- Dashboard tabs: Overview, Devices, Advisories, Fix Lists
- Filterable, searchable fictional device inventory
- Asset-detail modals
- CSV export of the fictional sample inventory
- Medical device lookup and provider breach lookup concept forms
- Demo inquiry form with a copyable summary (not sent anywhere)
- Accessible modal dialogs, keyboard focus states, reduced-motion support

## Important demo-only boundaries

- Dashboard devices and metrics are **fictional**.
- No real vulnerability scanning or advisory matching occurs.
- Free-tool searches do **not** call FDA/HHS APIs; they explain limitations and link to official resources.
- Demo form does **not** transmit or store personal information.
- No patient records or PHI are collected.
- Trust statements describe the product's intended approach, not unverified certifications.

## Going live

Before deployment: replace concept images with a properly licensed source image; configure an actual company contact address and a secured form endpoint; connect and validate external advisory sources; complete privacy/security and accessibility review; implement real authentication and tenancy if launching the MSP app. The hero crop is taken from the user-provided design mockup, so usage rights must be checked for commercial launch.

## Primary files

- `index.html` — page structure and content
- `styles.css` — responsive design system and motion
- `app.js` — interactive dashboard, sample data, dialogs and tools
- `assets/family-hero.png` — hero visual cropped from the user-provided concept image
- `assets/reference-design.png` — original reference mockup
