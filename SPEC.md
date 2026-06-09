# ONGC Offshore Workforce Rotation System — Build Specification

> This document is the source of truth for the build. Place it in the project root as `SPEC.md`. Claude Code should read it fully before scaffolding, and re-read relevant sections before building each module. Where this spec and a later instruction conflict, ask before proceeding.

---

## 1. Purpose & context

A catering and housekeeping contractor staffs **14 ONGC offshore installations** (8 platforms, 6 rigs; 4 rigs currently unmobilised) across **291 positions**. Roughly 228 employees are offshore at any time and ~182 sit in a ground/base pool.

The current system is a fragile multi-sheet Excel workbook. This project replaces it with a mobile-first web app a manager can run from a phone on site — no laptop, no SharePoint, no formula breakage.

**The core daily job the app must make easy:** know who is due to rotate off, find who from base can replace them (same designation, eligible, certified, confirmed-by-phone), and record onboard/offboard with a single tap.

**Scale:** maximum 10 concurrent users (managers). This is small — design for clarity and reliability, not for massive scale.

---

## 2. Tech stack (fixed)

- **Frontend:** React + Vite, mobile-first responsive, installable as a PWA (add to home screen).
- **Backend / database / auth:** Supabase (PostgreSQL, Supabase Auth, Realtime).
- **Hosting:** Vercel (free tier).
- **Cost target:** ₹0/month at this scale.

All data access goes through the Supabase client. Use Supabase Row Level Security; for v1 all 10 users are trusted internal staff, so the policy is "any authenticated user can read/write all tables" (we can tighten per-installation later — see §9).

---

## 3. Domain rules (the logic that must be correct)

These are non-negotiable and several were mis-built in the Excel version. Get them exactly right.

### 3.1 Rotation window
- An offshore stint runs **56 to 70 days**.
- **Day 56:** minimum service met — employee becomes *eligible* to rotate off.
- **Day 65:** *warning* state (configurable).
- **Day 70:** *hard threshold*. This is the last day before penalty exposure.
- Day count = `today − sign_on_date` while offshore; `sign_off_date − sign_on_date` once complete. Count is **inclusive of the sign-on day** (day 1 = sign-on date).

### 3.2 Penalty rule (day-counter logic for v1)
- The penalty is **₹1,000 per person per day** (configurable rate).
- For v1, the penalty is driven by **day count alone**: once an offshore stint exceeds the hard threshold (day 70), every day beyond it accrues penalty automatically and the person shows as in penalty. `days_over = days_served − max_service_days` (floor at 0); `penalty = days_over × penalty_rate`. Penalty keeps accruing while the person remains offshore and finalises at sign-off.
- **Reconciliation is a separate, later step.** In reality some of these are settled with ONGC. So a unit manager can mark any penalty as **reconciled**, which requires a mandatory remark stating it has been reconciled with ONGC. Reconciled penalties are recorded (who, when, the remark) and drop out of the active/unreconciled penalty exposure but remain in history. The app never deletes a penalty — it only moves it from `unreconciled` to `reconciled`.
- The real-world ONGC nuance (penalty only applies when ONGC arranged transport and the person didn't board) is captured at reconciliation time via the manager's remark, not by the day-counter — see §9 for the fuller automated version deferred to phase 2.

### 3.3 Rotations are batch-based
Movements happen on helicopter/vessel schedules, not continuously. The app does not need to schedule transport, but onboard/offboard actions may happen in batches (multiple employees moved on the same date). Make batch onboarding/offboarding easy.

### 3.4 Reserve pool definition (do not simplify this)
"Base staff" ≠ "reserve pool". The reserve pool is the **intersection** of three independent conditions:

```
reserve_pool = base_staff
  WHERE is_eligible          (enough rest; active employment)
  AND   all_required_certs_current   (no required document missing or expired)
  AND   availability_confirmed       (a manager called and they said yes, not expired)
```

A person can be eligible and fully certified yet still excluded because nobody has confirmed they will actually show up. High attrition during unpaid rest periods means availability must be actively confirmed, never assumed.

### 3.5 Confirmation expires
A "yes" is not permanent. Each confirmation carries `confirmed_at` and `expires_at` (default validity configurable, e.g. 14 days). If the mobilisation is still far out when confirmation expires, the person re-surfaces for a fresh confirmation call rather than being trusted on a stale yes.

### 3.6 Call tracking
For each base employee being courted for a need: track `call_count`, `last_call_at`, and `last_call_outcome` (`no_answer | call_back | confirmed | declined`). After repeated no-answers the UI should de-emphasise them so the manager stops wasting time. Keep a full `call_log` history too.

### 3.7 Categories and designations
- **Category** is the broad bucket: `Unskilled`, `Semi-skilled`, `Skilled`, `Outsourced`.
- **Designation** is the specific role within a category: e.g. Electrician (Skilled), Cook (Semi-skilled), Steward (Unskilled), Pest Controller (Outsourced).
- Replacement matching is **by designation** (an electrician replaces an electrician).
- Wage rates are **out of scope for v1** — do not build wage fields yet, but leave the schema clean so they can be added later.

---

## 4. Database schema (PostgreSQL / Supabase)

Generate a single migration creating these tables. Use `uuid` PKs (`gen_random_uuid()`), `timestamptz` for timestamps, `created_at`/`updated_at` on mutable tables, and foreign keys with sensible `on delete` behaviour. Add indexes on every foreign key and on `rotation_log(sign_off_date)` (partial, where null) for the "currently offshore" query.

```sql
-- Reference: categories
create table categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique  -- Unskilled, Semi-skilled, Skilled, Outsourced
);

-- Reference: designations (role within a category)
create table designations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  category_id  uuid not null references categories(id),
  created_at   timestamptz not null default now(),
  unique (name, category_id)
);

-- Installations: platforms and rigs
create table installations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  type        text not null check (type in ('platform','rig')),
  is_active   boolean not null default true,  -- false for the 4 unmobilised rigs
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Managers (linked to Supabase auth.users)
create table app_users (
  id            uuid primary key references auth.users(id),
  full_name     text,
  email         text,
  role          text not null default 'manager' check (role in ('admin','manager')),
  created_at    timestamptz not null default now()
);

-- Employees
create table employees (
  id                       uuid primary key default gen_random_uuid(),
  emp_id                   text not null unique,        -- the ID managers type/scan
  full_name                text not null,
  designation_id           uuid not null references designations(id),
  phone                    text,
  employment_status        text not null default 'active' check (employment_status in ('active','inactive')),
  current_installation_id  uuid references installations(id),  -- null = on base; set on onboard, cleared on offboard
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- Document type definitions (configurable; universal or designation-specific)
create table document_types (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null unique,        -- e.g. 'Medical Fitness Certificate'
  is_required            boolean not null default true,
  applies_to_all         boolean not null default false,  -- true = every employee needs it
  default_validity_days  int,                          -- for expiry calc; null = no auto-expiry
  created_at             timestamptz not null default now()
);

-- Which specific designations require a non-universal document.
-- Many-to-many: one document (e.g. ITI Certificate) can apply to several designations
-- (Electrician AND Plumber) without duplicate document_type rows.
create table document_type_designations (
  document_type_id  uuid not null references document_types(id) on delete cascade,
  designation_id    uuid not null references designations(id) on delete cascade,
  primary key (document_type_id, designation_id)
);

-- Per-employee document state (the checklist)
create table employee_documents (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references employees(id) on delete cascade,
  document_type_id  uuid not null references document_types(id),
  status            text not null default 'pending' check (status in ('pending','submitted','verified')),
  issue_date        date,
  expiry_date       date,
  verified_by       uuid references app_users(id),
  verified_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (employee_id, document_type_id)
);

-- Rotation log: ONE ROW PER BOARDING/DEBOARDING PAIR (the operational + history core)
create table rotation_log (
  id                     uuid primary key default gen_random_uuid(),
  employee_id            uuid not null references employees(id),
  installation_id        uuid not null references installations(id),
  sign_on_date           date not null,
  sign_off_date          date,                  -- null = currently offshore
  expected_rotation_date date,                  -- sign_on + target window (for punctuality)
  onboarded_by           uuid references app_users(id),
  offboarded_by          uuid references app_users(id),
  remarks                text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- How many of each designation each installation needs
create table installation_requirements (
  id               uuid primary key default gen_random_uuid(),
  installation_id  uuid not null references installations(id) on delete cascade,
  designation_id   uuid not null references designations(id),
  required_count   int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (installation_id, designation_id)
);

-- Current availability/confirmation state per base employee (one row per employee)
create table availability (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references employees(id) on delete cascade unique,
  confirmed           boolean not null default false,
  confirmed_at        timestamptz,
  confirmed_for_date  date,                 -- the mobilisation date they confirmed for
  expires_at          timestamptz,          -- confirmation validity cutoff
  call_count          int not null default 0,
  last_call_at        timestamptz,
  last_call_outcome   text check (last_call_outcome in ('no_answer','call_back','confirmed','declined')),
  updated_by          uuid references app_users(id),
  updated_at          timestamptz not null default now()
);

-- Full call history
create table call_log (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references employees(id) on delete cascade,
  called_by    uuid references app_users(id),
  called_at    timestamptz not null default now(),
  outcome      text not null check (outcome in ('no_answer','call_back','confirmed','declined')),
  notes        text
);

-- Penalty log (auto-computed from day count; reconciled later by a manager)
-- A row exists per offshore stint that crosses the hard threshold. days_over and
-- total_penalty are refreshed from day count while offshore and finalised at sign-off.
create table penalty_log (
  id                     uuid primary key default gen_random_uuid(),
  employee_id            uuid not null references employees(id),
  installation_id        uuid not null references installations(id),
  rotation_log_id        uuid references rotation_log(id) unique,  -- one penalty per stint
  days_over              int not null default 0,        -- days_served - max_service_days (floor 0)
  daily_penalty_rate     numeric not null default 1000,
  total_penalty          numeric not null default 0,    -- days_over * daily_penalty_rate
  status                 text not null default 'unreconciled' check (status in ('unreconciled','reconciled')),
  reconciled_by          uuid references app_users(id),
  reconciled_at          timestamptz,
  reconciliation_remark  text,                            -- REQUIRED (non-empty) when status = 'reconciled'
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Configurable thresholds and rates
create table app_config (
  key         text primary key,
  value       text not null,
  updated_by  uuid references app_users(id),
  updated_at  timestamptz not null default now()
);
```

**Seed `app_config` with these defaults (all editable in the app):**

| key | value | meaning |
|---|---|---|
| `min_service_days` | `56` | eligible to rotate |
| `warning_day` | `65` | warning state |
| `max_service_days` | `70` | hard threshold |
| `penalty_rate` | `1000` | ₹ per person per day |
| `confirmation_validity_days` | `14` | how long a confirmation stays valid |

**Seed data to load:**
- 14 installations (8 platforms, 6 rigs); mark the 4 unmobilised rigs `is_active = false`.
- The 4 categories.
- Designations as they exist (Claude Code: leave a clearly-marked seed file the user fills in with real designations). The designation names referenced below — Catering Manager, Cook, Asst Cook, Electrician, Plumber, Housekeeper — must exist for the document mapping to attach.
- Document types per the table below.

**Document types seed.** Universal documents (`applies_to_all = true`) are required of every employee. The rest attach to specific designations via `document_type_designations`.

| Document | Required of | Validity |
|---|---|---|
| PCC (Police Clearance Certificate) | All | manager-set expiry |
| Aadhaar Card | All | none |
| PAN Card | All | none |
| Passport | All | manager-set expiry |
| STCW/BST | All | manager-set expiry |
| HUET | All | manager-set expiry |
| Medical Fitness Certificate | All | 365 days default |
| HACCP | Catering Manager | manager-set expiry |
| Hotel Management (2 yrs exp) OR 5-yr Offshore Experience Letter | Catering Manager, Cook | none |
| Cookery Certificate | Asst Cook | none |
| PWD Licence | Electrician | manager-set expiry |
| ITI Certificate | Electrician, Plumber | none |
| 1-yr Experience Letter | Housekeeper | none |

Notes for the build:
- The two "OR" documents (Hotel Mgmt **or** Experience Letter) are modelled as a **single document_type** whose name states the alternation. Verifying it once satisfies the requirement — the manager records which underlying document they checked in the document's notes/issue fields. A proper "any-of group" requirement can be added in phase 2 if needed (see §9); do not build it now.
- `ITI Certificate` is one document_type row linked to **both** Electrician and Plumber via two `document_type_designations` rows — this is exactly why the model is many-to-many.
- Only `Medical Fitness Certificate` gets a `default_validity_days` (365). For the others that expire in reality (PCC, Passport, STCW/BST, HUET, PWD Licence), leave `default_validity_days` null and let the manager set `expiry_date` per employee record; these are all editable in Configuration.

---

## 5. Modules / screens

Build mobile-first. Each screen must be usable one-handed on a phone.

1. **Dashboard** — counts (offshore / on base / inactive), how many are in the rotation window now, total open penalty exposure, and a short "needs attention" list (anyone ≥ warning day).
2. **Employee management** — searchable list by name/emp_id/designation; add and edit employees; per-employee document checklist with status and expiry.
3. **Active roster** — grouped by installation; each person shows days served and a colour state (see §6.2); filterable by installation and designation.
4. **Boarding flow** — onboard (pick installation + date, defaults today, sets `current_installation_id`, opens a `rotation_log` row) and offboard (sets `sign_off_date`, clears `current_installation_id`). Support batch onboard/offboard for a shared transport date.
5. **Replacement finder** — pick (or auto-surface) a person in the window; show available base candidates of the **same designation**, ranked, each with rest days, cert status, call count, and confirm/call actions. (This is the headline screen — see the agreed mockup.)
6. **Reserve pool** — all base staff passing the §3.4 filter; filter by designation; shows confirmation + expiry + call state.
7. **Penalty tracker** — auto-lists every offshore stint past the hard threshold with its live accruing penalty (no manual entry to create one). Two views: `unreconciled` (active exposure, with a running total) and `reconciled` (history). A "reconcile" action requires a non-empty remark stating it has been reconciled with ONGC; it records `reconciled_by`/`reconciled_at` and moves the row to reconciled. Nothing is ever deleted.
8. **Configuration** — edit thresholds/rates (`app_config`), installations, designations, document types (universal or designation-specific, via the many-to-many mapping), and installation requirements.

---

## 6. Key logic specs

### 6.1 "Currently offshore" / "on base"
- Offshore = has a `rotation_log` row with `sign_off_date IS NULL`. `current_installation_id` mirrors this for fast lookup.
- On base = `employment_status = 'active'` and no open rotation_log row.

### 6.2 Roster colour states (from `app_config`)
- Days `< min_service_days` → neutral/green ("in service").
- `>= min_service_days` and `< warning_day` → blue/teal ("eligible").
- `>= warning_day` and `< max_service_days` → amber ("warning").
- `>= max_service_days` → red ("over threshold — penalty risk").

### 6.3 Eligibility (for reserve pool)
- `employment_status = 'active'`, not currently offshore, and rested. Compute rest days as `today − (most recent rotation_log.sign_off_date for that employee)`. If never offshore, treat as eligible. (Optional configurable minimum rest — leave a hook, default 0.)

### 6.4 Cert-current check
- A document_type applies to an employee if `applies_to_all = true` OR there is a `document_type_designations` row linking it to the employee's designation.
- For every applying, required document_type, the employee must have an `employee_documents` row with `status = 'verified'` and (if `expiry_date` is set) `expiry_date >= today`.
- Any missing or expired required document → not cert-current. Always surface *which* document is the problem (e.g. "HUET expired", "ITI Certificate missing") so the manager knows what to chase.

### 6.5 Replacement matching query
Given a target person on installation X with designation D and an expected rotation date:
- Candidates = base employees with designation D, passing eligibility (§6.3) and cert-current (§6.4).
- Rank: confirmed-and-unexpired first, then cert-current + eligible, then by fewest calls / most recent useful outcome. De-emphasise `last_call_outcome = 'no_answer'` with high `call_count`.

### 6.6 Confirmation lifecycle
- Calling sets/updates `availability` (increment `call_count`, set `last_call_at`, `last_call_outcome`) and inserts a `call_log` row.
- Outcome `confirmed` → set `confirmed = true`, `confirmed_at = now()`, `expires_at = now() + confirmation_validity_days`, `confirmed_for_date` if known.
- A confirmation is "live" only if `confirmed = true AND expires_at >= now()`. Expired confirmations drop out of the reserve pool and the person re-surfaces for a fresh call.

### 6.7 Penalty computation & reconciliation
- A `penalty_log` row should exist for any stint where `days_served > max_service_days`. Create it the first time a stint crosses the threshold (one row per `rotation_log` via the unique FK), then keep `days_over` and `total_penalty` refreshed: `days_over = days_served − max_service_days` (floor 0), `total_penalty = days_over × daily_penalty_rate`. While the person is offshore this keeps growing; at sign-off it finalises (use `sign_off_date − sign_on_date − max_service_days`).
- Computation can run client-side when the Penalty tracker loads, or via a scheduled refresh — either is fine at this scale; do not require a background worker.
- **Reconcile action:** sets `status = 'reconciled'`, `reconciled_by`, `reconciled_at`, and `reconciliation_remark` (reject the action if the remark is empty). Reconciled rows leave the active exposure total but stay in history. Penalties are never deleted, only reconciled.

---

## 7. Build sequence (paste these into Claude Code in order)

Put this spec in the project root first. Then:

1. *"Read SPEC.md fully. Scaffold a Vite + React mobile-first PWA wired to Supabase, with a Vercel-ready config. Set up the Supabase client, env vars, and a basic authenticated shell with a bottom nav for the 8 modules in §5. Don't build module internals yet."*
2. *"Generate the full Supabase migration from §4, plus the seed data described at the end of §4. Give me a seed file with clearly-marked placeholders for the real installation names and designations."*
3. *"Build Supabase email auth and the app_users table linkage. 10 trusted users; RLS = any authenticated user can read/write all tables for now."*
4. *"Build the Employee management module per §5.2 and §6.4, including the configurable document checklist."*
5. *"Build the Boarding flow per §5.4 and §6.1, including batch onboard/offboard."*
6. *"Build the Active roster per §5.3 and the colour states in §6.2."*
7. *"Build the Replacement finder (§5.5, §6.5) and Reserve pool (§5.6, §3.4, §6.3, §6.6). Match the agreed mockup: target person on top, ranked same-designation candidates below with rest days, cert status, call count, and confirm/call actions."*
8. *"Build the Penalty tracker per §5.7 and §6.7 — auto-listed penalties from day count, with unreconciled vs reconciled views and a reconcile action that requires a remark."*
9. *"Build the Configuration module per §5.8 — thresholds, installations, designations, document types (incl. designation-specific), and installation requirements."*
10. *"Build the Dashboard per §5.1."*
11. *"Make it an installable PWA and deploy to Vercel. Walk me through connecting Supabase env vars in Vercel."*

Iterate within each step before moving on — test on a phone-sized viewport as you go.

---

## 8. Prerequisites (one-time setup before step 1)

- Node.js (LTS) installed.
- A free Supabase project created (note the project URL and anon key).
- A free Vercel account.
- Claude Code installed and authenticated (Max plan).

---

## 9. Deferred / phase-2 (note, don't build now)

- Wage rates per category/designation and cost reporting.
- Per-installation manager scoping (tighten RLS so a site manager sees only their installation).
- Gap-variance / punctuality analytics off `rotation_log` (on-time vs late rotation history).
- Push/SMS alerts (the app shows in-app alerts in v1).
- Additional or "any-of group" document requirements (the OR documents are a single row in v1 — see §4 notes).
- Fuller penalty model: capture whether ONGC actually arranged transport and the employee didn't board, so the penalty reflects the real contractual trigger rather than day count alone. In v1 this nuance lives in the reconciliation remark; phase 2 can make it a structured field on `penalty_log`.
