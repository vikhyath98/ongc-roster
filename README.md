# ONGC Offshore Workforce Rotation System

A mobile-first PWA that replaces the legacy Excel workbook for staffing 14 ONGC
offshore installations (8 platforms + 6 rigs, ~290 required positions). A manager
can run the daily rotation job from a phone on site: see who is due to rotate off,
find a confirmed replacement from base, run the real ONGC manifestation paperwork
(request → RFM → boarding outcome), and produce defensible evidence when a penalty
has to be reconciled with ONGC.

See [`SPEC.md`](./SPEC.md) — the source of truth for the build.

**Live:** https://skfs-ongc-roster.vercel.app (auto-deploys on push to `main`).

## Tech stack

- **Frontend:** React + Vite, mobile-first, installable PWA (`vite-plugin-pwa`)
- **Backend / auth / DB:** Supabase (PostgreSQL, Auth, Realtime)
- **Hosting:** Vercel (free tier)
- **Scale:** up to ~10 trusted internal managers. RLS = any authenticated user can
  read/write all tables (per-installation scoping is deferred).

## Getting started

```bash
npm install
cp .env.example .env   # then fill in your Supabase URL + anon key
npm run dev
```

Open the dev server URL on a phone-sized viewport (or your phone on the same
network — `server.host` is enabled).

### Environment variables

| Variable | Where to find it |
|---|---|
| `VITE_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public key |

Only the **anon** key goes in the client. Never commit a real `.env`.

## Build & preview

```bash
npm run build
npm run preview
```

## Database

Migrations and seed data live in [`supabase/`](./supabase/) (see its README to
apply them). The schema is migrations `0001`–`0007`: the v1 core (employees,
designations, installations, rotation log, availability, penalties, config) plus
the manifestation system (manifest requests/items, RFMs + line items, replacement
pairings, overstay attributions, understay records).

## App structure

Navigation is a 4-item bottom nav — **Home · Roster · Board · Penalty** — with a
top-right hamburger drawer for Employee Master, Configuration, Reports, and sign-out.

- **Home (Dashboard)** — headcount, rotation-window bands (with per-designation
  breakdown), reserve readiness + pipeline health, open penalty exposure,
  collapsible manifest alerts, and a collapsible staffing-variance matrix.
- **Roster** — two-tab operational hub: *Offshore* (flat, urgency-sorted, with a
  per-card Find Replacement sheet) and *Base staff* (the reserve pool with
  eligibility / confirmation / call state, location-type filters, and bulk confirm).
- **Board** — the manifestation pipeline: *Manifest* (requests → RFMs with
  three-state boarding outcomes) and *Offboard* (closes stints, with understay and
  two-segment overstay attribution).
- **Penalty** — live exposure, unreconciled vs reconciled, remark-required
  reconcile, and per-stint "View evidence".
- **Employee Master** — desktop-first dense table with detail panel, document
  checklist + cert-current/DOB-mismatch flags, rotation history, and `.xlsx`
  import/export with a validated preview.
- **Reports** — Reconciliation Report and DOB Mismatch Report (downloadable `.xlsx`).

## Status

The v1 build (SPEC.md §§1–9), the post-v1 refinement pass (§§10–13: navigation
restructure, Employee Master, real seed data), and the full manifestation /
RFM / pairing / attribution system (§14, workstreams A–H) are all built, deployed,
and live. Remaining open and deferred items are tracked in SPEC.md §§15–16.
