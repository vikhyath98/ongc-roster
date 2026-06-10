-- =====================================================================
-- ONGC Rotation System — penalty exposure view  (build step 8, SPEC.md §6.7)
--
-- Penalty is computed LIVE from rotation_log + app_config via this view, so
-- reads have no side effects (no client upserts). One row per stint whose
-- inclusive day count exceeds max_service_days.
--
--   days_served   = (coalesce(sign_off_date, today_IST) - sign_on_date) + 1   (inclusive, §3.1)
--   days_over     = max(days_served - max_service_days, 0)                     (§3.2)
--   total_penalty = days_over * penalty_rate
--   finalised     = stint has signed off (figure no longer growing)
--
-- Reconciliation is persisted separately in penalty_log (status=reconciled);
-- the app treats a stint as reconciled when such a row exists. Penalties are
-- never deleted — only reconciled.
--
-- security_invoker = the view honours the caller's RLS on the base tables.
-- Safe to run more than once.
-- =====================================================================

create or replace view penalty_exposure
with (security_invoker = true) as
with cfg as (
  select
    coalesce((select value from app_config where key = 'max_service_days'), '70')::int     as max_days,
    coalesce((select value from app_config where key = 'penalty_rate'), '1000')::numeric    as rate,
    (now() at time zone 'Asia/Kolkata')::date                                               as today
)
select
  r.id                                                                          as rotation_log_id,
  r.employee_id,
  e.emp_id,
  e.full_name,
  d.name                                                                        as designation_name,
  r.installation_id,
  i.name                                                                        as installation_name,
  r.sign_on_date,
  r.sign_off_date,
  ((coalesce(r.sign_off_date, cfg.today) - r.sign_on_date) + 1)                 as days_served,
  greatest(((coalesce(r.sign_off_date, cfg.today) - r.sign_on_date) + 1) - cfg.max_days, 0) as days_over,
  cfg.rate                                                                      as daily_penalty_rate,
  (greatest(((coalesce(r.sign_off_date, cfg.today) - r.sign_on_date) + 1) - cfg.max_days, 0) * cfg.rate) as total_penalty,
  (r.sign_off_date is not null)                                                 as finalised
from rotation_log r
join employees e    on e.id = r.employee_id
join designations d on d.id = e.designation_id
join installations i on i.id = r.installation_id
cross join cfg
where ((coalesce(r.sign_off_date, cfg.today) - r.sign_on_date) + 1) > cfg.max_days;

grant select on penalty_exposure to authenticated;
