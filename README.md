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
- [ ] 4. Employee management (+ `.xlsx` bulk import)
- [ ] 5. Boarding flow (batch onboard/offboard)
- [ ] 6. Active roster + colour states
- [ ] 7. Replacement finder + reserve pool
- [ ] 8. Penalty tracker
- [ ] 9. Configuration
- [ ] 10. Dashboard
- [ ] 11. PWA polish + Vercel deploy
