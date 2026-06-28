# ONGC Offshore Workforce Rotation System — Build Specification (v2)

> This document is the source of truth for the build. Place it in the project root as `SPEC.md`, replacing any earlier version. Claude Code should read it fully before building, and re-read relevant sections before each module. Where this spec and a later instruction conflict, ask before proceeding.
>
> **Document status, so a fresh session orients instantly:** Sections 1–9 describe the original v1 build (11 steps) — fully built, tested, deployed, and live at `https://skfs-ongc-roster.vercel.app`. Sections 10–13 describe the post-v1 refinement pass (navigation restructure, Employee Master, real seed data) — fully built and pushed. Section 14 describes the manifestation/RFM/pairing/attribution system: **all eight workstreams A–H are built, tested, and pushed to `origin/main` — §14 is feature-complete as of 2026-06-22** (per-workstream commit refs are in §14.9). Section 15 lists genuinely open/unresolved items. Section 16 is the updated deferred list.

---

## 1. Purpose & context

A catering and housekeeping contractor staffs **14 ONGC offshore installations** (8 platforms, 6 rigs) across **290 required positions** (the exact per-installation, per-designation breakdown is now real data — see §13). Roughly 228–290 employees are offshore at any time and ~180+ sit in a ground/base pool.

The original system was a fragile multi-sheet Excel workbook. This project replaced it with a mobile-first web app a manager can run from a phone on site.

**The core daily job the app must make easy:** know who is due to rotate off, find who from base can replace them, run the actual ONGC manifestation paperwork (request → RFM → boarding outcome) that real-world rotation requires, and produce defensible evidence when a penalty needs to be reconciled with ONGC.

**Scale:** maximum 10 concurrent users (managers). Design for clarity and reliability, not massive scale.

---

## 2. Tech stack (fixed)

- **Frontend:** React + Vite, mobile-first responsive PWA. Employee Master is desktop-first (see §11) but must degrade gracefully on mobile.
- **Backend / database / auth:** Supabase (PostgreSQL, Supabase Auth, Realtime).
- **Hosting:** Vercel (free tier), auto-deploys on push to `main`.
- **Cost target:** ₹0/month at this scale.

RLS: any authenticated user can read/write all tables (10 trusted internal users). Per-installation scoping remains deferred (§16).

---

## 3. Domain rules — original v1 (still in force)

### 3.1 Rotation window
- Offshore stint: **56 to 70 days**. Day 56 = eligible to rotate. Day 65 = warning (configurable). Day 70 = hard threshold.
- Day count is **inclusive** of the sign-on day (day 1 = sign-on date).

### 3.2 Penalty rule (day-counter, v1 — still the base computation)
- ₹1,000/person/day (configurable). Once a stint exceeds day 70, every day beyond accrues automatically: `days_over = days_served − max_service_days` (floor 0), `total_penalty = days_over × penalty_rate`. Accrues while offshore, finalises at sign-off.
- **This base computation is unchanged by §14.** What §14 adds is an *attribution layer* on top — splitting the existing `days_over`/`total_penalty` into who's responsible — not a change to how the penalty amount itself is calculated.
- Reconciliation: a mandatory remark moves a penalty from unreconciled to reconciled. Never deleted.

### 3.3 Rotations are batch-based. Batch onboard/offboard for a shared transport date.

### 3.4 Reserve pool definition
`reserve_pool = base_staff WHERE is_eligible AND all_required_certs_current AND availability_confirmed`. All three conditions are independent; confirmation must be actively obtained, never assumed.

### 3.5 Confirmation expires
`confirmed_at` / `expires_at` (default validity configurable, e.g. 14 days). Expired confirmations drop out of the reserve pool.

### 3.6 Call tracking
`call_count`, `last_call_at`, `last_call_outcome` (`no_answer | call_back | confirmed | declined`), full `call_log` history.

### 3.7 Categories and designations
- Category: `Unskilled | Semi-skilled | Skilled | Outsourced`.
- Designation: specific role within a category (real list in §13).
- Replacement matching is **by designation**, with the matching rule refined in §14.2 (exact match required for Skilled/Semi-skilled/Outsourced; Unskilled-to-Unskilled crossing allowed with a warning).
- Wage rates remain out of scope.

---

## 4. Database schema — original v1 tables (still in force, unchanged)

`categories`, `designations`, `installations`, `app_users`, `employees` (base columns — see §10/§14 for columns added later), `document_types` (extended in §14 schema), `employee_documents` (extended in §14 schema), `rotation_log` (extended in §14 schema), `installation_requirements`, `availability`, `call_log`, `penalty_log`, `app_config`.

Refer to the original migrations `0001`–`0005` already applied in Supabase for exact DDL. Do not re-create these — only the additive columns/tables in §14's schema block are new.

**One real schema change since v1, already applied (migration `0004`):** `document_types` moved from a single `applies_to_designation_id` FK to a proper many-to-many junction table, `document_type_designations`, because real certifications like ITI Certificate apply to multiple designations (Electrician AND Plumber). `document_types` also gained `tracks_dates` (independent of expiry — Aadhaar/PAN are dateless) and `employee_documents` gained `document_number`.

---

## 5. Modules — original v1 list (superseded in part, see notes)

1. **Dashboard** — see §12 for the rebuilt version (supersedes this entry).
2. **Employee management** — renamed and rebuilt as **Employee Master**, see §11 (supersedes this entry).
3. **Active roster** — rebuilt as a two-tab hub (Offshore / Base staff) with the Find Replacement sheet absorbed in, see §10 (supersedes this entry).
4. **Boarding flow** — the **Onboard half is superseded** by the Manifest → RFM → Boarded flow in §14; the Offboard half is unchanged in mechanism but gains the understay/overstay-attribution logic in §14.6.
5. **Replacement finder** — absorbed into Roster's Find Replacement sheet (§10). No longer a standalone screen/route.
6. **Reserve pool** — absorbed into Roster's Base staff tab (§10). No longer a standalone screen/route.
7. **Penalty tracker** — unchanged base mechanism (§3.2); gains a "View evidence" report button, see §14.7.
8. **Configuration** — unchanged mechanism; gains new editable fields as new tables/columns are added (document type-designation mapping, `tracks_number`, the new `app_config` keys in §14).

---

## 6. Key logic — original v1 (still in force)

§§6.1–6.7 from the original spec (currently-offshore/on-base definition, roster colour states, eligibility, cert-current check, replacement matching, confirmation lifecycle, penalty computation/reconciliation) remain accurate and unchanged. Refer to them as-is. The roster colour-state label **"Eligible" was renamed to "Plan Rotation"** in the UI (§12) — the day range and computation are identical, only the displayed label changed. This rename applies **only** to the rotation-window state, not to the unrelated "Eligible" badge used on base-staff cards (§3.4's eligibility condition) — those are two different concepts and both keep their original labels.

---

## 7. Original v1 build sequence — complete

Steps 1–11 from the original spec are fully built, tested, and deployed. Not reproduced here. See git history for the full sequence.

---

## 8. Prerequisites — unchanged, already satisfied.

---

## 9. Original v1 deferred list — see §16 for the current version (several items here have since been built; §16 replaces this section).

---

## 10. Navigation & Roster restructure (built)

The original 8-tab horizontally-scrolling bottom nav was replaced.

**Bottom nav (4 items):** Home | Roster | Board | Penalty.
**Top-right hamburger (☰):** opens a drawer/menu containing Employee Master, Configuration, Reports (§14.7), and Sign out. Identity (signed-in manager's name/email) also lives here.

**Roster** is now a two-tab operational hub:

- **Offshore tab:** a flat card list (not grouped by installation), sorted by days served descending (most urgent first). Each card shows name, designation, 📍 installation, days served, colour-state pill, rotation deadline, and a **"Find replacement"** button (visible at day 56+). Filterable by installation and designation, with a "shown of total" count.
- **Base staff tab:** this is the reserve pool, in full view. Each card shows rest days, eligibility state (with the specific blocking reason if not eligible), confirmation badge + expiry, call count/last outcome. Filterable by designation. A "Select" toggle enables multi-select with a sticky "Confirm Availability (N)" action bar (§14.3 will route manifest-request candidates through this same confirmed state).
- **Find Replacement sheet:** opens from an Offshore card's "Find replacement" button. Shows the target employee at top (days served, deadline, colour state), a "Confirmed ready" section (confirmed + unexpired + eligible + cert-current candidates of the same designation, read-only display), an "Available to call" section (eligible + cert-current but unconfirmed, ranked by fewest/best calls, with inline Call and Confirm actions), and a "Not available" section at the bottom (cert-blocked, declined, inactive — greyed out with the specific reason). Closing returns to Roster.

The standalone Reserve Pool and Replacement Finder pages/routes were deleted; their logic lives in `lib/reserve.js`, now consumed by Roster.

---

## 11. Employee Master (built, renamed from "Staff")

Desktop-first, since the primary users (admin/HR) work from a laptop, while remaining accessible on mobile via graceful card-layout degradation.

**Desktop:** dense table view — columns include Emp ID, Name, Designation, Category, Status, Current Location, Certs, Last Sign-off. Sortable, multi-column search/filter. Row click opens a right-side detail panel (not a full-screen modal) so the table stays visible — shows employee detail, the full document checklist, and a **read-only Rotation History section** (every stint, most-recent-first, with installation, sign-on/sign-off or "Currently offshore", inclusive days served, Completed/Offshore status, and a red highlight + `days_over` for any stint that exceeded day 70).

**Toolbar / bulk actions (multi-select with checkboxes, sticky action bar when active):**
- **Import / Export (.xlsx).** See the extended template below.
- **Bulk Verify Documents** — pick document type(s), optional shared issue/expiry, applies only where applicable to each selected employee's designation, reports "X verified across Y employees, Z skipped (not applicable)".
- **Confirm Availability** (bulk) — optional shared confirmed-for date, skips currently-offshore employees, reports "N confirmed, X skipped (currently offshore)".
- **Set Active/Inactive.**

**Delete policy (smart delete):** the standard removal mechanism is the Active/Inactive toggle (soft delete, preserves history). **Hard delete is only available for an employee with zero `rotation_log` rows** (true data-entry mistakes/test records) — the delete control is not even shown for anyone with rotation history.

### Extended import/export template

Columns, in order:
```
emp_id, full_name, designation, phone, employment_status, notes,
current_location, current_sign_on,
stint_1_installation, stint_1_sign_on, stint_1_sign_off,
stint_2_installation, stint_2_sign_on, stint_2_sign_off,
stint_3_installation, stint_3_sign_on, stint_3_sign_off
```

Validation rules (all enforced, surfaced clearly in the import preview):
1. **All-or-nothing per stint** — if any column in a stint is filled, all three must be; otherwise reject: "Stint N is incomplete."
2. **No gaps in sequence** — Stint 2 requires Stint 1 filled; Stint 3 requires both prior. Reject otherwise.
3. **Chronological order across stints** — each stint's sign_off must precede the next stint's (or current_sign_on's) sign_on.
4. **sign_off must be after sign_on** within a stint.
5. **Completed stints must have a past sign_off** (not today/future).
6. **Installation name matching** — case-insensitive against the real installations list (§13). Unrecognised name → reject with the specific name.
7. **Days-served sanity warning (non-blocking)** — any stint under 10 days or over 150 days shows a yellow warning in the preview but still imports.
8. **current_location + current_sign_on** — both or neither; `current_sign_on` must be in the past and after the most recent stint's sign_off.
9. **No history and no current location** → imported as a new base employee.

On a valid row: creates the employee, inserts a closed `rotation_log` row per valid stint (oldest to newest, `onboarded_by`/`offboarded_by` = importer), and if `current_location`/`current_sign_on` are present, opens a current (open) `rotation_log` row via the same logic as `onboardEmployee()`.

**Export** adds read-only columns (clearly labelled `[Read Only]`, ignored on re-import): `cert_status`, `cert_issues`, `days_since_signoff`, `confirmation_status`, and `dob_mismatch` (§14.8). Rotation history in the export reflects the 3 most recent completed stints, so an exported file can be re-imported cleanly.

---

## 12. Dashboard (rebuilt)

- **Headcount cards** — Offshore / On base / Inactive, each deep-linking to Roster or Employee Master.
- **Rotation window** — four colour bands: In service (green, not clickable) / **Plan Rotation** (teal) / Warning (amber) / Over threshold (red). The latter three are clickable, opening a modal titled "<band> — N employees" with a breakdown by designation (count descending) and the installations each designation's affected employees are at.
- **Reserve readiness** — two numbers: "Confirmed ready" (the strict §3.4 reserve pool count) and "Eligible (unconfirmed)" (eligible + cert-current but not confirmed). Both deep-link to Roster → Base staff, pre-filtered. A health line below: green if confirmed-ready ≥ the total rotation-window count, amber if 50–99% of it, red if under 50%.
- **Staffing variance** — per active installation with configured `installation_requirements`, compares required vs. current-offshore count per designation. Shows "Short N [designation]" (red) or "Surplus N [designation]" (amber); balanced rows/installations are hidden entirely; "All installations fully staffed" if everything balances; a setup hint if no requirements are configured anywhere.
- **(Pending — §14.7) Three manifestation alerts** will be added here: Awaiting re-manifest, Relief failed to arrive, Manifest needed soon.

---

## 13. Real seed data (built)

**Installations — Platforms:** ICP, SHP, SAGAR SAMRAT, WIN, NEELAM, BLQ-I, TCPP, R-12.
**Installations — Rigs:** SAGAR JYOTI, SAGAR GAURAV, SAGAR SHAKTI, SAGAR UDAY, SAGAR RATNA, SAGAR KIRAN.
*(Open item: the ops team separately mentioned "BLQ-1, BLQ-2" under a chopper-field grouping; whether BLQ-2 is a genuinely new, not-yet-seeded installation or a naming variant of BLQ-I is unresolved — see §15.)*

**Designations:** Catering Manager, Cook, Assistant Cook, Electrician, Plumber, Housekeeper, Laundry, Room Boy, Pest Controller. Laundry and Room Boy are only required at SAGAR JYOTI.

**Installation requirements:** real per-installation, per-designation headcounts are seeded, summing to 290 required positions total. See `installation_requirements` table / Configuration screen for the exact matrix.

**Document types (real certification list):**

| Document | Required of | Notes |
|---|---|---|
| PCC | All | manager-set expiry |
| Aadhaar Card | All | number only, no dates (`tracks_dates=false`) |
| PAN Card | All | number only, no dates |
| Passport | All | number AND dates (§14.6 `tracks_number`) |
| STCW/BST | All | manager-set expiry |
| HUET | All | manager-set expiry |
| Medical Fitness Certificate | All | 365-day default validity |
| HACCP | Catering Manager | manager-set expiry |
| Hotel Mgmt (2yr) OR 5yr Experience Letter | Catering Manager, Cook | single combined document_type; verifying once satisfies it |
| Cookery Certificate | Assistant Cook | none |
| PWD Licence | Electrician | manager-set expiry |
| ITI Certificate | Electrician, Plumber | many-to-many via `document_type_designations` |
| 1-yr Experience Letter | Housekeeper | none |

A field-grouping concept (chopper fields like Tapti/B&S/South/North/NH grouping multiple installations) was discussed and explicitly **parked** — not built, may be added later as a lightweight optional `field` label on installations purely for future filtering/analytics.

---

## 14. Manifestation tracking system

This is the real-world ONGC process the app was missing: a mail request naming people and a destination → ONGC issues an RFM (with some requests not approved) → actual boarding (with some approved people still dropped or no-show) → and the resulting paper trail is what makes a later overstay penalty reconciliation possible or not.

**Status: Workstream A (§14.1–§14.5) is built, tested, and pushed. Workstreams B–H (§14.6–§14.8, plus §10/§11 enhancements) are designed in full below, not yet built.**

### 14.1 Schema (built — migrations `0006`, `0007`)

```sql
manifest_requests
  id, installation_id (fk installations), request_date,
  requested_by (fk app_users), notes,
  status: 'sent' | 'partially_approved' | 'approved' | 'rejected',
  created_at, updated_at

manifest_request_items
  id, manifest_request_id (fk, cascade),
  employee_id (fk employees) -- the incoming/relief employee,
  replacing_employee_id (fk employees, nullable) -- the outgoing
    employee currently offshore being relieved,
  reason (text, nullable),
  is_emergency_exception (boolean, default false),
  exception_reason (text, nullable) -- mandatory in UI when
    is_emergency_exception is true,
  created_at

replacement_pairings
  id,
  manifest_request_item_id (fk, nullable, on delete set null),
  outgoing_employee_id (fk employees),
  incoming_employee_id (fk employees),
  retry_of_pairing_id (fk replacement_pairings, nullable),
  rfm_line_item_id (fk rfm_line_items, nullable, on delete set null),
  status: 'pending' | 'rfm_listed' | 'boarded' | 'dropped' |
          'no_show' | 'cancelled',
  relief_deadline (date, nullable) -- set when status='boarded':
    sortie_date + relief_grace_period_days (app_config),
  consumed_at (timestamptz, nullable) -- set when resolved at
    the outgoing employee's eventual offboard,
  created_at, updated_at

rfms
  id, rfm_number (unique text), manifest_request_id (fk, nullable),
  installation_id (fk installations), sortie_date,
  scheduled_dep_time (time), scheduled_report_time (time),
  mode_of_journey: 'Air' | 'Sea' | 'Other' (not null, default 'Air'),
  received_at (default now()), notes, created_at, updated_at

rfm_line_items
  id, rfm_id (fk, cascade), employee_id (fk employees),
  vendor_code (text, nullable),
  outcome: 'listed' | 'boarded' | 'dropped' | 'no_show'
    (default 'listed'),
  outcome_reason (text, nullable -- optional for both dropped
    and no_show; on correction this is composed as a dated
    audit note that PRESERVES the original reason rather than
    overwriting it, e.g.
    "[Original (Dropped): reason] [Corrected 18-Jun -> No-show: reason]"),
  outcome_recorded_at, outcome_recorded_by (fk app_users),
  rotation_log_id (fk rotation_log, nullable),
  created_at, updated_at

overstay_attributions   -- (Workstream B, not yet built)
  id, rotation_log_id (fk rotation_log, unique),
  replacement_pairing_id (fk replacement_pairings, nullable),
  segment_1_days (int, default 0),
  segment_1_attribution: 'ongc' | 'skfs' | null,
  segment_1_overridden (boolean, default false),
  segment_1_remark (text, nullable -- required if overridden),
  segment_2_days (int, default 0),
  segment_2_attribution: 'ongc' | 'skfs' | null,
  segment_2_overridden (boolean, default false),
  segment_2_remark (text, nullable -- required if overridden),
  created_by (fk app_users), created_at, updated_at

understay_records   -- (Workstream B, not yet built)
  id, rotation_log_id (fk rotation_log), employee_id (fk employees),
  days_short (int), reason (text, nullable),
  fixed_cost (numeric), daily_rate (numeric), total_cost (numeric),
  created_by (fk app_users), created_at

-- additive columns already applied:
document_types.tracks_number (boolean, default false)
  -- true for Aadhaar Card, PAN Card, Passport
employee_documents.date_of_birth (date, nullable)
employees.base_location_type: 'guesthouse' | 'hometown' | null
employees.recall_lead_time_days (int, nullable)
employees.no_show_count (int, default 0)
rotation_log.is_manual_exception (boolean, default false)
rotation_log.manual_exception_reason (text, nullable)

app_config additions:
  relief_grace_period_days = 1
  understay_fixed_cost = 0      -- PLACEHOLDER, mark clearly in UI
  understay_daily_rate = 0      -- PLACEHOLDER, mark clearly in UI
```

No new threshold needed for the manifest safe window — it reuses the existing `min_service_days` (56) and `warning_day` (65).

### 14.2 Manifest Requests (built)

Board screen is now **Manifest | Offboard** (the standalone Onboard tab no longer exists as a peer tab — see §14.5 for the only remaining manual onboarding path).

**Requests sub-view:** request cards (installation, date, status, employee count) are clickable, opening a detail modal showing every line item with its live pairing status (pending/rfm_listed/boarded/dropped/no_show/cancelled).

**Creating/editing a request** uses a shared `LineItemPicker` component (also reused by §14.3's ad-hoc RFM lines and the manual exception path), enforcing identically everywhere:

- **Confirmed-only picker (hard restriction):** the incoming/relief employee dropdown shows only base staff who are `confirmed = true` and unexpired. If zero exist for a relevant designation: "No confirmed [designation] candidates available. Confirm availability first." with a shortcut to Roster → Base staff.
- **Day-56 gate (hard block) on the replacing/outgoing employee:** if their `days_served < min_service_days`, the line item cannot be added unless the manager checks "Emergency exception" and provides a mandatory `exception_reason`.
- **Day-65 warning (non-blocking):** if the replacing employee is already past `warning_day`, show: "The safe manifesting window (day 56–65) has closed. Any resulting overstay is likely to default toward SKFS responsibility." Item can still be added.
- **Designation matching rule:** same designation always passes silently. Skilled, Semi-skilled, and Outsourced designations require an **exact designation match** — any mismatch is a hard block ("[Designation] can only be replaced by another [Designation]"). Unskilled designations may cross-replace a different Unskilled designation, but show a non-blocking warning ("⚠️ [Incoming] is replacing [Outgoing] — different roles, please confirm this is intended.").
- **Dedupe:** any employee already used (incoming or outgoing) elsewhere in this same request (including cancelled line items) is removed from both dropdowns.

On creating the request, `replacement_pairings` rows are created for every valid line item (status `'pending'`), with `retry_of_pairing_id` set to the most recent prior `dropped`/`no_show` pairing for that same outgoing employee, if one exists.

**Editing an existing request:** new line items can be added later using the same picker/gates. A line item can be **cancelled** (status → `'cancelled'`, never deleted) only while its pairing is still `'pending'` — once it's been pulled into an RFM (`'rfm_listed'` or beyond), it's locked: "Already logged on RFM #[number] — locked." Once any RFM has been logged against a request, that request's **installation and date lock** (notes remain editable always). **Requests themselves are never deletable.** Reason-only line items (no replacing employee specified) have no pairing and therefore no cancel action, but still count toward dedupe.

The request's `status` field (sent/partially_approved/approved/rejected) is manager-edited bookkeeping reflecting the email/phone conversation with ONGC — it does **not** automatically affect RFMs, pairings, or any employee record. **Rejected requests are excluded from the "link to manifest request" picker when logging an RFM**, so rejected names can't accidentally be pulled into a real boarding.

### 14.3 RFMs (built)

**Log RFM:** RFM number, installation, sortie date, scheduled dep/report time, mode of journey, optional link to a manifest_request (pre-fills its line items). Each line gets an optional `vendor_code`.

**Ad-hoc line items** (added directly to an RFM, not pre-filled from a request) use the exact same `LineItemPicker` safeguards as §14.2 — confirmed-only, day-56 gate with exception, designation matching, dedupe within this RFM. If a replacing employee is named, a `replacement_pairings` row is created immediately at status `'rfm_listed'` (no `manifest_request_item_id`), with the same `retry_of_pairing_id` chaining — closing what would otherwise be a gap in the attribution evidence for relief that didn't go through a formal request.

**Three-state outcome per line item**, each settable once per calendar day with a same-day correction path (see below):

- **Boarded** — gated by the §6.4 cert-current check first: if the employee's required documents are missing/expired, the action is blocked and the specific document is named, no override. On success: triggers `onboardEmployee()` (installation, sign_on = sortie_date), sets the line's `rotation_log_id`, and if a pairing exists for this line, sets it to `'boarded'` with `relief_deadline = sortie_date + relief_grace_period_days`.
- **Dropped** (ONGC bumped — no chopper/boat space) — `outcome_reason` optional. Sets any linked pairing to `'dropped'`. Employee becomes "awaiting re-manifest" (§14.7), flagged as a drop, not a no-show.
- **No-show** (seat was available, employee didn't show) — `outcome_reason` **optional, never required** (too many possible reasons to force one). Sets any linked pairing to `'no_show'`. Immediately flips the employee's `confirmed` to `false` and increments `no_show_count`. Employee becomes "awaiting re-manifest" (§14.7), flagged distinctly as a no-show.

**Same-day correction:** an outcome can be corrected only on the calendar day it was recorded (based on local `outcome_recorded_at`); afterward it's permanently locked ("🔒 Locked — recorded on an earlier day"). Correcting requires picking a new outcome plus a mandatory reason. Correcting *away from* Boarded reverses it destructively (deletes the created `rotation_log` row, returns the employee to base, clears the line's `rotation_log_id` and the pairing's `relief_deadline` — flagged clearly as destructive before confirming). Correcting *away from* No-show decrements `no_show_count` but does not restore the employee's prior `confirmed` value (known, accepted limitation — re-confirm via any of the existing confirm entry points). A correction resets the recording timestamp, so it remains correctable for the rest of that same day; after midnight it locks. The reason is composed as a dated audit note preserving the original (see schema block), never silently overwritten.

### 14.4 Replacement pairings — lifecycle summary (built)

A pairing is created the moment a manifest request item or ad-hoc RFM line names a specific outgoing employee being relieved — not deferred until a successful boarding. This means even failed attempts (dropped, no-show) are tracked as first-class history against the outgoing employee, and a chain of retries (`retry_of_pairing_id`) is preserved when a manager re-requests after a failure. Status flow: `pending` → `rfm_listed` → one of `boarded` / `dropped` / `no_show`, or `cancelled` from `pending` only. Only one pairing per outgoing employee should be `'boarded'` with `consumed_at IS NULL` at a time — that is the "active" pairing §14.6 resolves at offboard time.

### 14.5 Manual onboard (exception) — built

A deliberately secondary, low-prominence entry point (not a peer tab) for boarding someone entirely outside the Manifest → RFM flow (e.g. an ad hoc supply-boat ride). Requires a **mandatory** reason (always, no exceptions). Optionally asks "Is this person relieving someone currently offshore?" — if yes, creates a `replacement_pairings` row directly at `'boarded'` (`manifest_request_item_id = null`, `relief_deadline = sign_on_date + relief_grace_period_days`). Sets `is_manual_exception = true` and `manual_exception_reason` on the resulting `rotation_log` row.

### 14.6 Offboard-time logic: understay + two-segment overstay attribution (NOT YET BUILT — Workstream B)

Extend the existing Offboard action. After computing final `days_served` for the closing stint, run two independent checks:

**Understay check.** If `days_served < min_service_days`: look up the most recent `manifest_request_item` where `replacing_employee_id` = this employee and `is_emergency_exception = true`; pre-fill the reason from its `exception_reason` if found (editable). Show a mandatory modal: reason required if not pre-filled. On confirm, insert an `understay_records` row: `days_short = min_service_days − days_served`, `fixed_cost`/`daily_rate` snapshotted from `app_config`, `total_cost` computed. Always label this cost as based on **placeholder, unconfirmed rates** in any UI until the real rates are entered in Configuration. This is tracked and absorbed by SKFS — no ONGC reconciliation flow for understay.

**Overstay attribution.** If `days_served > max_service_days`: find the active pairing (`status='boarded'`, `outgoing_employee_id` = this employee, `consumed_at IS NULL`). Using the existing inclusive day-counting helpers, compute:
- `hard_threshold_date` — the calendar date on which `days_served` would equal `max_service_days`.
- `relief_arrival_date` — the pairing's boarding sortie_date, if a pairing exists.
- `segment_1_days = max(0, relief_arrival_date − hard_threshold_date)` if a pairing exists, else the **entire** overstay (`sign_off_date − hard_threshold_date`) if no pairing was ever boarded for this stint at all.
- `segment_2_days = max(0, sign_off_date − max(relief_arrival_date, hard_threshold_date))` if a pairing exists, else 0.

**Default attributions (always overridable, override requires a mandatory remark):**
- No pairing exists at all → `segment_1_attribution` defaults to **SKFS** (no relief was ever in motion).
- A pairing exists → walk `retry_of_pairing_id` backward to the most recent prior **failed** attempt for this outgoing employee:
  - prior attempt was `'dropped'` → `segment_1_attribution` defaults to **ONGC**.
  - prior attempt was `'no_show'` → `segment_1_attribution` defaults to **SKFS**.
  - no prior failed attempt at all (succeeded first try, just late) → fall back to whether the **original/earliest** request in the retry chain was filed within the safe day-56–65 window: filed within → **ONGC** default; filed after day 65 → **SKFS** default.
- `segment_2_attribution`, whenever `segment_2_days > 0`, **always** defaults to **ONGC** (the relief already arrived — any further delay is a return-transport problem).

Show both segments with their computed days and defaults in a review modal before completing the offboard, each independently changeable. On confirm: insert the `overstay_attributions` row, and set the pairing's `consumed_at = now()` if one existed. This is purely an attribution split layered on top of the existing, unchanged base penalty computation (§3.2) — it does not change how the underlying penalty amount is calculated, only how it's attributed.

### 14.7 Dashboard alerts (NOT YET BUILT — Workstream D)

Three distinct alerts, each genuinely different in cause and required follow-up:

1. **"Awaiting re-manifest"** (base-side) — most recent `rfm_line_items.outcome` is `dropped` or `no_show` with no boarding since. Shown split by reason (dropped → chase ONGC for a seat; no-show → chase the employee / reconsider reliability), colour-escalating with days waiting (0–2 neutral, 3–5 amber, 6+ red). Quick actions: "Create new manifest request" or "Mark as left".
2. **"Relief failed to arrive"** (offshore-side) — currently offshore, past `max_service_days`, whose most recent pairing attempt resolved `dropped`/`no_show` with no successor yet boarded. Tells the manager *why* a specific overdue case hasn't resolved, not just that it's overdue.
3. **"Manifest needed soon"** — past `warning_day` with **no** `manifest_request_item` ever filed naming them at all. The single most actionable alert, since it's the last point where action prevents the problem rather than explains it later.

### 14.8 Reports hub (NOT YET BUILT — Workstream E)

New "Reports" entry in the hamburger drawer (alongside Employee Master, Configuration), built as an extensible list of report cards.

- **Reconciliation Report** — filterable by date range / installation / reconciliation status. One row per overstay stint in a downloadable `.xlsx`: employee, designation, installation, dates, days served/over, both segments' days and attribution, total/ONGC-attributable/SKFS-attributable penalty amounts, linked RFM number(s), and a generated plain-language narrative ("Replacement requested on [date]... ONGC RFM #[number] issued... Outcome: [Dropped/Boarded/No RFM received]..."). This is the multi-case version for periodic ONGC submissions.
- **DOB Mismatch Report** (§14.9 below feeds this) — `.xlsx`: emp_id, full_name, designation, installation/status, Aadhaar DOB, PAN DOB, Passport DOB.
- A **"View evidence" button** on each individual Penalty tracker stint (and reachable from the Reconcile modal) is the single-case, in-app version of the same underlying data.

### 14.9 Remaining build order (Workstreams C–H)

- **C — Bulk confirm on Roster → Base staff tab** (select-mode multi-select + sticky "Confirm Availability (N)" action, distinct from the existing single quick-confirm button). **BUILT AND PUSHED** (commit `69eeece`).
- **D — Dashboard alerts** (§14.7). **BUILT, TESTED, AND PUSHED** (commit `f2253b4`; nav fix + D-series test scripts in `31f65b7`). Two decisions confirmed in testing:
  1. **"Mark as left"** sets `employment_status = inactive` (the standard reversible soft-delete) — confirmed as intended.
  2. **"Create manifest request"** navigates to Board → Manifest tab **without** pre-filling the named employee — accepted; pre-fill can be added later if wanted.
- **E — Reports hub** (§14.8). **BUILT, TESTED, AND PUSHED** (commits `7fc1f6a` route/drawer, `47c966d` View evidence modal, `5b19ded` Reconciliation Report). Reconciliation Report + "View evidence" only; the DOB Mismatch Report is deferred to Workstream H (needs DOB capture first).
- **F — Guesthouse vs. hometown base staff** — `base_location_type` + `recall_lead_time_days` (already in schema, §14.1), shown as a tag on Roster/Employee Master cards, used as a ranking tiebreaker in `reserve.js` (guesthouse outranks hometown within the same confirmation tier). **BUILT, TESTED, AND PUSHED** (commits `070e088` reserve.js ranking, `42e2047` location tag + Employee form fields). UI label for `hometown` is "Out of town" (DB enum value unchanged); recall suffix shows only for a positive lead time.
- **G — Passport number field** — make the document checklist render a document's number field whenever `tracks_number` is true and its date fields whenever `tracks_dates` is true, independently (so Passport shows both). Expose `tracks_number` as an editable Configuration toggle. **BUILT, TESTED, AND PUSHED** (commits `a5614b5` Configuration toggle, `1b215bd` independent checklist rendering). Number field relabelled "Document number"; cert-currency logic untouched (still keyed on `tracks_dates`).
- **H — DOB mismatch detection (soft flag)** — capture a `date_of_birth` per Aadhaar/PAN/Passport document. If an employee's recorded DOBs across these (where at least two are recorded) disagree, flag a separate, distinct "⚠️ DOB mismatch" badge (never merged into the cert-current badge, never blocks any action) showing the conflicting dates on tap. Add `dob_mismatch` as a read-only Employee Master export column. Feeds the DOB Mismatch Report in §14.8. **BUILT, TESTED, AND PUSHED** (commits `00f117a` DOB wired through lib + checklist, `8b5a360` mismatch badge/detail panel/export column, `34b3288` DOB Mismatch Report card). DOB capture gated on `tracks_number` (the identity docs); detail-panel section uses amber `cert-summary--warn` to match the non-blocking pill.

B was built before C–H because it consumes the pairing data A produces, and was verified end-to-end across all three pairing-creation paths (formal request, ad-hoc RFM line, and manual exception). **§14 is feature-complete as of 2026-06-22 — all eight workstreams (A–H) built, tested, and pushed to `origin/main`.**

---

## 15. Open / unresolved items

- **BLQ-1 / BLQ-2 naming.** The ops team's chopper-field list named "BLQ1, BLQ2" while the seeded installation list has only "BLQ-I". Unconfirmed whether BLQ-2 is a real, not-yet-added installation or a naming variant. Resolve before assuming BLQ-2 exists anywhere in the system.
- **Field grouping** (Tapti/B&S/South/North/NH) — parked, not built. A lightweight optional `field` label on installations could be added later purely for analytics/filtering; no logic should depend on it yet.
- **No-show confirmation snapshot** — reversing a no-show correction does not restore the employee's prior `confirmed` value (it stays `false`); accepted as a minor, low-cost gap rather than adding a snapshot column.
- ~~**alerts.js Alert-1 wait-day calc** uses `slice(0,10)` on a raw UTC timestamp (same IST/UTC class as `eb17e66`) — only misfires for outcomes recorded midnight–5:30am IST.~~ **RESOLVED** (commit `e6ec1ec`): a `toISTDate` helper shifts the timestamp into IST (+5:30) before taking the date.
- ~~**penalty_exposure.daily_penalty_rate** uses the current `app_config` rate, not a historical snapshot — attribution penalty amounts may diverge from `penalty_log` totals if the rate has changed since offboarding.~~ **RESOLVED** (commit `7ed4231`, migration 0014): `overstay_attributions.daily_penalty_rate` snapshots the rate at attribution-record time; the ONGC Head dispute figure (and reports) prefer the snapshot, falling back to the live `app_config` rate only for pre-migration rows.

---

## 16. Deferred / future phases (replaces original §9)

- Wage rates per category/designation and cost reporting.
- Per-installation manager scoping (RLS tightened so a site manager sees only their installation).
- Gap-variance / punctuality analytics off `rotation_log`.
- Push/SMS alerts (in-app alerts only for now).
- "Any-of group" document requirements (the OR documents remain a single combined row).
- Structured field-grouping logic beyond the optional label noted in §15.
- Anything not explicitly listed in §14.9 as pending (except the Phase 3 workstreams now scoped in §17).

---

## 17. Phase 3 — Workstreams I–O

> **Status:** Workstreams **I, J, L, K, M, N, O, and P are all built, tested, and pushed**
> (details in each subsection). **Phase 3 is feature-complete** pending final testing and
> any follow-up items. This phase layered cross-tier replacement, a NEDP attribute, a
> status-column board, a structured call log, a role system, the CM return-manifest
> workflow, a read-only ONGC Head view, and file upload (photos + document scans) on top
> of the feature-complete §14 system. Build order is at the end.
>
> **Numbering note:** the owner's request labelled this "§15 Phase 3"; since §15
> (Open items) and §16 (Deferred) already exist, it is filed here as §17 to avoid a
> duplicate section number. Renumber later if preferred.

### 17.I — Cross-designation replacement (logic only, no migration)

Generalises the §14.2 designation-matching rule from "exact match, with an
Unskilled-to-Unskilled exception" to a **skill-tier compatibility** model.

- `reserve.js` → `listOnBaseEmployees` must include `skill_category` via the
  designation → category join (no new column; `categories.name` already exists).
- The outgoing employee's `skill_category` must be passed into the replacement
  finder so the check can compare tiers.
- Tier compatibility (incoming **can replace** outgoing):
  - **Skilled** → Skilled / Semi-skilled / Unskilled
  - **Semi-skilled** → Semi-skilled / Unskilled
  - **Unskilled** → Unskilled only
  - **Outsourced** → Outsourced only
- **Hard block** for any downward violation (e.g. Unskilled replacing Skilled) —
  same blocking treatment as the current designation-mismatch block.
- **Non-blocking warning** for a same-tier cross-designation replacement (e.g.
  Electrician replacing Cook — both Semi-skilled), mirroring the existing
  Unskilled cross-replacement warning.
- Exact same-designation matches still pass silently.

**Status: BUILT, TESTED, AND PUSHED** (commit `8a263ef`; the manifest
`LineItemPicker` was synced to the same tier rule and candidate designation is now
shown in `ReplaceSheet` in `2dc410c`).

### 17.J — NEDP pass

NEDP is modelled as a **first-class employee attribute** (like `emp_id`), not a
document record.

- **Schema (employees table):**
  - `nedp_number text UNIQUE nullable`
  - `nedp_valid_until date nullable`
- **Config:** `nedp_validity_days` (default `365`) in `app_config`, editable in the
  Configuration screen.
- **UI:**
  - `EmployeeForm`: `nedp_number` text input + `nedp_valid_until` date picker.
  - Employee card / detail: NEDP status pill — **OK / Expiring / Expired / Not set**.
  - Find Replacement: an **expired** NEDP is a **block** (same treatment as an
    expired cert). NEDP **expiring within 30 days** is a **non-blocking warning**.

**Status: BUILT, TESTED, AND PUSHED** (commits `c5a6c4b` schema + `nedp_validity_days`
config key, `438190c` form fields / status pill / eligibility gate). Two items deferred:
- The **"NEDP expiring" non-blocking warning on Find Replacement candidate cards** is
  **deferred to Workstream K**. Expired NEDP already blocks in the finder; the expiring
  warning is currently surfaced via the amber pill on the Employee Master card/detail.
- `nedp_validity_days` is **readable but not yet editable in the Configuration screen**
  (exposed via `config.js` defaults; the Configuration UI editor is a follow-up).

### 17.K — Board screen → Flow B (status columns)

Replace the **Manifest** tab in `Boarding.jsx` with a status-column (kanban-style)
view. The **Offboard** tab is unchanged.

- **Columns:**
  - **Needs manifest** — offshore, past `warning_day`, with no `manifest_request_item`
    naming them.
  - **Filed / RFM** — a manifest request exists, awaiting or received RFM, not yet
    boarded.
  - **Boarded** — replacement boarded this cycle.
  - **Retry needed** — latest pairing is `dropped`/`no_show` with no boarded successor.
- Each column lists employee cards with key info: name, designation, installation,
  days served.
- **Batch select + batch action per column:**
  - Needs manifest → **Create manifest request**
  - Retry needed → **Create retry manifest request**
- **CM view (toggle):** scoped to **return manifests only** (see §17.N).

**Status: BUILT, TESTED (pending), AND PUSHED** (commits `2e394e8` shared pipeline
classifier + alerts.js refactor, `0aa630e` Flow B status-column board, `c366b6b` NEDP
expiring warning on finder cards, `6374418` base-side card orientation + layout fix).

**Final orientation — base-side.** The board cards are the **incoming (relief)
employees** — the base manager's mental model of who they are sending — with the
offshore employee being relieved shown as context ("Replacing → [name], [installation]
· [days]d", or "Not yet paired"). Columns are classified by `classifyBaseEmployee` (the
incoming-side mirror of `classifyOffshoreEmployee`, keyed on `incoming_employee_id` /
`manifest_request_items.employee_id`):
- **To manifest** — confirmed-ready base staff not yet named on any manifest item.
- **Filed / RFM** — named on a manifest item, pairing `pending` / `rfm_listed`.
- **Boarded** — pairing `boarded` with `consumed_at` null (offshore now).
- **Retry needed** — most recent pairing `dropped` / `no_show`, no boarded successor.

**To manifest** and **Retry needed** support batch select → "Create manifest request" /
"Create retry request"; the retry action **pre-locks each relief's original outgoing**
from its failed pairing (falling back to the open picker if none is found). Requests,
RFMs, and Manual onboard remain reachable via the secondary nav; the **Offboard tab is
untouched**. **Dashboard alerts stay outgoing-oriented** — `alerts.js` and
`classifyOffshoreEmployee` are unchanged; `classifyBaseEmployee` is board-only. The
deferred §17.J **"NEDP expiring" finder warning** landed here.

Deferred: the **CM view toggle** → Workstreams M + N (needs the role system + return
manifests). **Auto-split of a cross-installation "To manifest" selection** is also
deferred — those reliefs are unpaired (no outgoing yet) so carry no installation context
to split on; the manager picks one installation in the modal for now.

### 17.L — Call log

> **Conflict to resolve before build:** `call_log` is already an existing v1 table
> (§3.6, §4) holding the current `call_count`/`last_call_*` tracking. The schema
> below redefines it. Either migrate/extend the existing table or pick a new name
> (e.g. `call_records`) before building — do not silently create a second table.

- **Schema (`call_log`):**
  - `id uuid PK`
  - `employee_id uuid → employees FK cascade`
  - `called_by uuid → app_users FK nullable`
  - `called_at timestamptz NOT NULL DEFAULT now()`
  - `outcome text nullable CHECK IN (confirmed, declined, callback, no_answer, unreachable)`
  - `commitment_date date nullable`
  - `hometown text nullable`
  - `travel_days smallint nullable CHECK >= 0`
  - `notes text nullable`
  - Index: `(employee_id, called_at DESC)`
- **Model A flow:** tapping **"Call…"** in Find Replacement creates a `call_log` row
  immediately (`called_at = now`, `outcome = null`). An inline outcome picker then
  appears: confirmed / declined / callback / no answer / unreachable. If
  **confirmed**, it also surfaces `commitment_date`, `hometown`, `travel_days`
  (all optional). The manager can update these without leaving the sheet.
- **"Check history"** button on each base candidate card: a collapsible panel of past
  `call_log` entries for that employee, most recent first, grouped by rest period.
  Collapsed by default.
- **Ranked report card** in Reports: per base employee, over the last 12 months —
  total calls to confirm, no-shows, on-time arrival rate (`commitment_date` vs actual
  `sign_on` from `rotation_log`), and avg rest days between stints. Sortable columns,
  download `.xlsx`.

**Status: BUILT, TESTED (pending), AND PUSHED** (commits `4d08ff2` migration 0009 —
`call_log` extended (nullable outcome, `unreachable`, commitment fields), `19975d6`
Model A two-step call flow + Check history, `b2e75d2` Call Performance Report). The
`call_log` conflict was resolved by **extending** the existing table, not creating a
new one. Decisions locked: kept `call_back` spelling (+ added `unreachable`); no-shows
counted from `rfm_line_items.outcome='no_show'` in the last 365 days; on-time = a
confirmed call's commitment date paired to the nearest following `sign_on` within
30 days. Three items deferred:
- The **Base-staff CallDialog UI is unchanged** — it still uses the single-shot path
  via the deprecated `logCall` wrapper; its Model A rebuild is part of **Workstream K**.
- The **"NEDP expiring" warning on Find Replacement candidate cards** remains
  **deferred to Workstream K** (carried over from §17.J).
- The **`call_back` outcome label stays as-is** for now (not renamed to `callback`).

### 17.M — Role system (prerequisite for N and O)

Three roles plus the existing Admin; role stored on `app_users`; UI gates by role.

- **Admin** (existing) — retains full access.
- **hr_manager** — all current screens **except** the CM view.
- **catering_manager** — **CM view only**: return manifests for their installation,
  read-only roster for their installation; no penalty / reports / Employee Master
  edit access.
- **ongc_head** — **ONGC Head view only** (read-only).

**Status: BUILT, TESTED (pending), AND PUSHED** (commits `5ce0ce4` migration 0010 —
widen the role check to the four roles, migrate legacy `manager` → `hr_manager`, default
new signups to `hr_manager` (column default; `handle_new_user` sets no role), add
`app_users.installation_id`; `665f6be` role gating scaffold). `hasRole(profile, ...roles)`
gates routes and nav with **admin always passing**; `RoleRoute` redirects each role to its
landing (catering_manager → `/cm`, ongc_head → `/ongc-head`, hr_manager/admin → `/`).
Bottom nav + drawer are filtered per role; the **catering_manager Roster is read-only and
scoped to their `installation_id`** (no Find Replacement / call / confirm / select). Roles
are assigned **directly in Supabase** — no in-app role UI in M. Gating is **UI-level only**
(RLS stays open per §2/§16). Deferred: the **CM view content → Workstream N** and the
**ONGC Head view content → Workstream O** (both are placeholder screens for now).

### 17.N — Return manifest (CM workflow)

The primary **Segment 2 prevention** mechanism (return transport after relief arrives).

- **Trigger:** when an incoming replacement's RFM line is logged **Boarded**, a
  `return_manifest_task` is created for the **outgoing** employee:
  - `deadline = Boarded timestamp + 36 hours`
  - `status = pending`
- The CM sees these tasks in their view (§17.K CM toggle). **Actions:** *File return
  manifest* (logs the ONGC return RFM number + sortie date) or *Mark as submitted*
  with a reason.
- **Missed deadline** (past the 36-hour deadline, still pending):
  - An alert fires to **hr_manager** on the Dashboard.
  - The CM must submit a reason before the task can be closed.

**Status: BUILT, TESTED (pending), AND PUSHED** (commit `5294acb` migration 0012 —
`return_manifest_tasks` + the backfilled `app_user_installations` junction that M
created by hand in Supabase but never migrated; `34b0b1c` return-manifest flow). The
trigger is **app-side** in `recordRfmOutcome` (after the pairing flips to `boarded`) and
**also `manualOnboard`** — a manual-exception boarding strands the outgoing employee just
the same, so it opens the same task. Both calls are **fire-and-forget**: a failure logs
but never fails the boarding, and a UNIQUE index on `replacement_pairing_id` makes a
repeated boarded outcome a harmless no-op. `deadline` is computed by
`returnManifestDeadline` (boarded timestamp + 36 hours). The CM view
(`CMView.jsx`) is installation-scoped via `profile.installations` → `loadReturnTasks(ids)`
with three sections (Overdue / Upcoming / Completed); **File return manifest** logs the
return RFM number + sortie date (`status='filed'`), **Submit reason** (offered only once
overdue) closes with a reason (`status='submitted'`, JS-guarded to `pending` only). The
hr_manager Dashboard alert is gated behind `loadManifestAlerts({ includeReturnAlerts:
true })` so the CM path can never surface it. **UI-level gating only** (RLS stays open per
§2/§16). Deferred: nothing — N is complete.

### 17.O — ONGC Head view

Read-only dashboard. A grid of **14 installation cards**.

- **Each card:** installation name, persons on board, days-served distribution
  (green / amber / red counts), open penalty exposure for that installation, and
  expected dispute amount (ONGC-attributed days × rate).
- **Drill-down (tap a card):** list of employees at that installation with days served
  and manifest status.
- **No actions. No employee PII beyond name, designation, and days served** (designation
  added as a deliberate post-build refinement so the ONGC Head can read the roster mix).

**Status: BUILT, TESTED (pending), AND PUSHED** (commit `e5acda3`). `lib/ongcHead.js`
`loadOngcHeadData()` assembles one card per installation from existing tables/views (no
migration): all 14 installations (`listInstallations()`, no `activeOnly`), open stints
(`listOffshoreStints()`), `penalty_exposure` (open exposure = `finalised` and not in
`penalty_log` as reconciled, summed per installation), and `overstay_attributions` joined
through `rotation_log` for the **expected dispute** (ONGC-attributed days × the stint's
`daily_penalty_rate`, summed per installation — attributed/offboarded stints only, so the
card carries an "excl. active overstays" footnote). Bands: green `< warning_day`, amber
`warning_day..max_service_days`, red `≥ max_service_days`. `OngcHeadView.jsx` is a 2-col
scrollable grid; tapping a card opens a drill-down Modal listing aboard employees with
**name + designation + days served + manifest status** (`classifyOffshoreEmployee`) — no
other PII. (Designation was a deliberate post-build addition to the original "name + days"
rule.)
**Fully read-only, no actions**, reachable only by `ongc_head` (RoleRoute, §17.M). Rupee
amounts use `Intl.NumberFormat('en-IN')`.

### 17.x — Build order & deferrals

- **Order:** I → J → L → K → M → N → O → P. **All built, tested, and pushed — Phase 3 is
  feature-complete** pending final testing.

### 17.P — File upload (identity photos + document scans)

Files live in the Supabase Storage bucket **`employee-documents`** (created out of band);
rows store only the object **path**, and the browser only ever sees short-lived **signed
URLs** (1 h) — raw paths are never exposed.

- **Schema (migration 0013):** `employees.photo_path text` (nullable),
  `employee_documents.file_path text` (nullable). No constraints.
- **`lib/storage.js`:** `uploadEmployeePhoto` / `uploadDocumentScan` (both `upsert:true`
  so a replacement never orphans the prior object; each records the path on its row),
  `getSignedUrl(path, expiresInSeconds=3600)`, `deleteFile`. Paths:
  `{employeeId}/photo/{file.name}` and `{employeeId}/docs/{documentTypeId}/{file.name}`.
- **Identity photo:** added on the **edit** employee form only (the row must exist),
  uploaded **immediately on file select** (not on save), 5 MB client-side cap,
  `image/jpeg,png,heic`. Shown as a 60 px circular avatar on the form + detail panel and a
  32 px avatar on the employee-list cards (signed URLs fetched per-avatar, resolving
  progressively; no-photo cards are unchanged).
- **Document scans:** a **📎 Scan** / **📎 Replace** + **📎 View** control on each row of
  the document checklist (`image/jpeg,png,pdf`, 5 MB cap). Scanning a doc with no row yet
  creates the `employee_documents` row first to attach `file_path`. View opens a fresh
  signed URL in a new tab.
- **Import template is unchanged** — file upload does not touch it (the original §17
  deferral noted this).

**Status: BUILT, TESTED (pending), AND PUSHED** (commit `0773b46` migration 0013,
`0b3809f` storage lib + UI).

### 17.z — Post-Phase-3 enhancements (shipped)

Small follow-ups built after the I–P workstreams, all built/tested/pushed:

- **Penalty-rate snapshot** (commit `7ed4231`, migration 0014) — resolves §15's
  daily-rate drift item. `overstay_attributions.daily_penalty_rate numeric(10,2)` is
  snapshotted at attribution time (`offboardChecks.js`); the ONGC Head dispute figure
  prefers the snapshot, falling back to the live `app_config` rate only for pre-migration
  rows (`ongcHead.js`).
- **Alternate phone + native-dialler shortcut** (commit `efedcf7`, migration 0014) —
  `employees.alternate_phone text`, surfaced on the employee form + detail panel. Candidate
  cards in the replacement finder (`ReplaceSheet.jsx`) gain a 📞 Call `tel:` shortcut with a
  Primary/Alternate dropdown (dropdown only when an alternate exists). This dialler link is
  **separate from** the Model A "Call…" log button — it dials only, never writes `call_log`.
- **Caller name in Call Performance Report** (commit `49b3ebc`, no migration) — the report
  joins `call_log.called_by → app_users(full_name)`; each employee row carries the distinct
  callers, shown in-app (Reports call-perf card) and as a "Called By" column in the xlsx.
