# ONGC Offshore Workforce Rotation System — Build Specification (v2)

> This document is the source of truth for the build. Place it in the project root as `SPEC.md`, replacing any earlier version. Claude Code should read it fully before building, and re-read relevant sections before each module. Where this spec and a later instruction conflict, ask before proceeding.
>
> **Document status, so a fresh session orients instantly:** Sections 1–9 describe the original v1 build (11 steps) — fully built, tested, deployed, and live at `https://skfs-ongc-roster.vercel.app`. Sections 10–13 describe the post-v1 refinement pass (navigation restructure, Employee Master, real seed data) — fully built and pushed. Section 14 describes the manifestation/RFM/pairing/attribution system: **Workstreams A, B, C, and D are built, tested, and pushed to `origin/main`. Workstreams E through H are fully designed below but not yet built** — that is the remaining work, in the order listed in §14.9. Section 15 lists genuinely open/unresolved items. Section 16 is the updated deferred list.

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
- **E — Reports hub** (§14.8). **Not yet built** — next up.
- **F — Guesthouse vs. hometown base staff** — `base_location_type` + `recall_lead_time_days` (already in schema, §14.1), shown as a tag on Roster/Employee Master cards, used as a ranking tiebreaker in `reserve.js` (guesthouse outranks hometown within the same confirmation tier).
- **G — Passport number field** — make the document checklist render a document's number field whenever `tracks_number` is true and its date fields whenever `tracks_dates` is true, independently (so Passport shows both). Expose `tracks_number` as an editable Configuration toggle.
- **H — DOB mismatch detection (soft flag)** — capture a `date_of_birth` per Aadhaar/PAN/Passport document. If an employee's recorded DOBs across these (where at least two are recorded) disagree, flag a separate, distinct "⚠️ DOB mismatch" badge (never merged into the cert-current badge, never blocks any action) showing the conflicting dates on tap. Add `dob_mismatch` as a read-only Employee Master export column. Feeds the DOB Mismatch Report in §14.8.

B was built before C–H because it consumes the pairing data A produces, and was verified end-to-end across all three pairing-creation paths (formal request, ad-hoc RFM line, and manual exception). With A–C pushed and D awaiting test/push, the remaining order is E → F → G → H.

---

## 15. Open / unresolved items

- **BLQ-1 / BLQ-2 naming.** The ops team's chopper-field list named "BLQ1, BLQ2" while the seeded installation list has only "BLQ-I". Unconfirmed whether BLQ-2 is a real, not-yet-added installation or a naming variant. Resolve before assuming BLQ-2 exists anywhere in the system.
- **Field grouping** (Tapti/B&S/South/North/NH) — parked, not built. A lightweight optional `field` label on installations could be added later purely for analytics/filtering; no logic should depend on it yet.
- **No-show confirmation snapshot** — reversing a no-show correction does not restore the employee's prior `confirmed` value (it stays `false`); accepted as a minor, low-cost gap rather than adding a snapshot column.
- **alerts.js Alert-1 wait-day calc** uses `slice(0,10)` on a raw UTC timestamp (same IST/UTC class as `eb17e66`) — only misfires for outcomes recorded midnight–5:30am IST, deferred to post-E fix.

---

## 16. Deferred / future phases (replaces original §9)

- Wage rates per category/designation and cost reporting.
- Per-installation manager scoping (RLS tightened so a site manager sees only their installation).
- Gap-variance / punctuality analytics off `rotation_log`.
- Push/SMS alerts (in-app alerts only for now).
- "Any-of group" document requirements (the OR documents remain a single combined row).
- Structured field-grouping logic beyond the optional label noted in §15.
- Anything not explicitly listed in §14.9 as pending.
