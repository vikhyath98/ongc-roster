# Overstay attribution — manual test data (SPEC.md §14.6)

These are **SQL setup scripts**, not automated tests. They seed the exact
historical database state each two-segment attribution scenario needs, so you
can open the app, offboard the named test employee, and check that the
**default** attributions shown in the Overstay modal are correct.

## How to use

1. Open the **Supabase SQL Editor** for the project.
2. Paste and run **one** scenario file. Each is self-contained: it first
   deletes any prior test rows with its own `TEST-S<n>-%` prefix, then inserts
   fresh state. Order doesn't matter and you can re-run any file safely.
3. In the app: **Board → Offboard tab**, find the `TEST-SCENARIO-<n>` employee
   (designation **Cook**, installation **ICP**, ~80 days served), select them,
   leave the sign-off date as **today**, and click **Offboard**.
4. The **Overstay attribution** modal appears. Compare its segment days and
   default attributions against the "EXPECTED MODAL OUTPUT" block at the top of
   the scenario file.
5. (Optional) Confirm the sign-off, then run the commented `VERIFY` query at the
   bottom of the file to check the persisted `overstay_attributions` row.

Dates are all relative to `current_date`, so the test employee is always over
day 70 no matter when you run the script. `sign_on = today − 79` ⇒ 80 days
served; the day-70 hard threshold lands on `today − 10`.

## The five scenarios

| # | File | Setup | Seg 1 (days / default) | Seg 2 (days / default) |
|---|------|-------|------------------------|------------------------|
| 1 | `scenario-1-no-pairing.sql` | No request, no pairing ever | 10 / **SKFS** | — (0) |
| 2 | `scenario-2-dropped-then-boarded.sql` | Prior attempt **dropped**, retry boarded | 6 / **ONGC** | 4 / ONGC |
| 3 | `scenario-3-noshow-then-boarded.sql` | Prior attempt **no-show**, retry boarded | 6 / **SKFS** | 4 / ONGC |
| 4 | `scenario-4-relief-arrived-before-threshold.sql` | Filed day 63 (in window), relief boarded **before** day 70 | **0** | 10 / **ONGC** |
| 5 | `scenario-5-first-try-filed-after-day65.sql` | First try, filed **day 67** (after 65) | 6 / **SKFS** | 4 / ONGC |

Scenarios 2 vs 3 isolate the dropped-vs-no-show default; 4 vs 5 isolate the
in-window-vs-late filing default; 1 is the no-relief-at-all baseline.

## Cleanup

Each script cleans up its own prefix on the next run. To remove all test data
manually, run the cleanup block at the top of each file (or delete employees
whose `emp_id` starts with `TEST-S`, after clearing their dependent rows in
FK-safe order — see any scenario file's cleanup section for the order).
