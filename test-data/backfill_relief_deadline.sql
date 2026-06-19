-- =====================================================================
-- ONE-TIME BACKFILL — correct relief_deadline rows written before eb17e66
-- =====================================================================
--
-- Commit eb17e66 fixed an off-by-one in addDays(): under IST it returned a
-- date one day early, so every relief_deadline written by the app
-- (relief_deadline = arrival + relief_grace_period_days) landed a day early.
-- This script recomputes relief_deadline to its correct value from the
-- authoritative source.
--
-- Canonical value:
--   relief_deadline = <relief arrival date> + relief_grace_period_days (app_config)
--   where <relief arrival date> is the RFM sortie_date (RFM-linked pairings)
--   or the incoming employee's boarding sign_on_date (manual onboards).
--
-- SCOPE: only rows with relief_deadline IS NOT NULL (i.e. boarded pairings;
-- the field is null for pending/dropped/no_show and is cleared on a
-- correction away from Boarded). This is a ONE-TIME fix — run it once in the
-- Supabase SQL Editor. It is idempotent and safe to re-run: rows already
-- correct (e.g. the SQL-seeded test rows) are simply set to the same value.
--
-- Run the two UPDATEs, then the VERIFY query at the bottom should return
-- zero mismatched rows.
-- =====================================================================

-- ---- (optional) preview what will change ---------------------------
-- select p.id, p.rfm_line_item_id is not null as rfm_linked,
--        p.relief_deadline as current_deadline
-- from replacement_pairings p
-- where p.relief_deadline is not null;

-- ---- 1) RFM-linked pairings: arrival = rfms.sortie_date ------------
update replacement_pairings p
set relief_deadline = r.sortie_date
      + coalesce((select value::int from app_config where key = 'relief_grace_period_days'), 1)
from rfm_line_items li
join rfms r on r.id = li.rfm_id
where p.rfm_line_item_id = li.id
  and p.relief_deadline is not null;

-- ---- 2) Manual onboards (no RFM): arrival = incoming employee's -----
--          boarding sign_on_date. The boarding stint is pinned by matching
--          its (sign_on + grace) to within one day of the existing
--          relief_deadline, so an incoming employee with several rotations
--          can't match the wrong stint (the day-early bug means the true
--          stint satisfies sign_on + grace = relief_deadline or +1).
update replacement_pairings p
set relief_deadline = rl.sign_on_date
      + coalesce((select value::int from app_config where key = 'relief_grace_period_days'), 1)
from rotation_log rl
where p.rfm_line_item_id is null
  and p.relief_deadline is not null
  and rl.employee_id = p.incoming_employee_id
  and rl.sign_on_date
        + coalesce((select value::int from app_config where key = 'relief_grace_period_days'), 1)
      between p.relief_deadline and p.relief_deadline + 1;

-- ---- VERIFY — expect ZERO rows after running the two UPDATEs -------
-- Any row here still disagrees with the canonical value.
with grace as (
  select coalesce((select value::int from app_config where key = 'relief_grace_period_days'), 1) as days
)
select p.id,
       (p.rfm_line_item_id is not null) as rfm_linked,
       p.relief_deadline,
       coalesce(r.sortie_date, rl.sign_on_date) + g.days as expected_deadline
from replacement_pairings p
cross join grace g
left join rfm_line_items li on li.id = p.rfm_line_item_id
left join rfms r on r.id = li.rfm_id
left join rotation_log rl
       on p.rfm_line_item_id is null
      and rl.employee_id = p.incoming_employee_id
      and rl.sign_on_date + g.days = p.relief_deadline
where p.relief_deadline is not null
  and p.relief_deadline <> coalesce(r.sortie_date, rl.sign_on_date) + g.days;
