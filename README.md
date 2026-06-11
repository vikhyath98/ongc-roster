# ONGC Offshore Workforce Rotation System

A mobile-first PWA that replaces the legacy Excel workbook for staffing 14 ONGC
offshore installations. See [`SPEC.md`](./SPEC.md) — the source of truth for the
build.

## Tech stack

- **Frontend:** React + Vite, mobile-first, installable PWA (`vite-plugin-pwa`)
- **Backend / auth / DB:** Supabase (PostgreSQL, Auth, Realtime)
- **Hosting:** Vercel (free tier)

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

## Build progress (per SPEC.md §7)

- [x] **1. Scaffold** — Vite + React PWA, Supabase client, auth shell, bottom nav (8 modules)
- [x] **2. Supabase migration + seed** — `supabase/migrations/0001_init.sql` + `supabase/seed.sql` (see `supabase/README.md` to apply)
- [x] **3. Email auth + `app_users` linkage** — login wired (step 1), `app_users` auto-created via DB trigger + client upsert; RLS = authenticated full access
- [x] **4. Employee management** — searchable list, add/edit, document checklist + cert-current (§6.4), `.xlsx` bulk import with validated preview
- [x] **5. Boarding flow** — batch onboard/offboard on a shared transport date (§5.4, §6.1)
- [x] **6. Active roster** — grouped by installation, days served + colour states (§6.2), filter by installation & designation
- [x] **7. Replacement finder + reserve pool** — strict reserve pool (§3.4); ranked same-designation candidates with call/confirm lifecycle (§6.5/§6.6)
- [x] **8. Penalty tracker** — live exposure from the penalty view; unreconciled vs reconciled; remark-required reconcile (§5.7, §6.7)
- [x] **9. Configuration** — thresholds/rates, installations (active toggle), designations, document types (+ mapping), installation requirements (§5.8); plus read-only rotation history on the employee detail
- [x] **10. Dashboard** — headcount, rotation-window bands, open penalty exposure, needs-attention list (§5.1)
- [x] **11a. PWA polish** — PNG 192/512 + maskable + apple-touch icons; offline read-only (NetworkFirst cache of Supabase GETs)
- [ ] 11b. Vercel deploy (connect repo + env vars)
