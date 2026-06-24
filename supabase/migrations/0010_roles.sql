-- =====================================================================
-- 0010_roles.sql — role system (SPEC.md §17.M, Workstream M)
-- Widen app_users.role to the four Phase-3 roles, migrate legacy 'manager'
-- rows to hr_manager, change the new-signup default, and add the optional
-- installation binding catering_manager users are scoped to. Idempotent.
-- =====================================================================

-- Widen the role check FIRST so the migrate-UPDATE below is allowed.
alter table app_users
  drop constraint if exists app_users_role_check;
alter table app_users
  add constraint app_users_role_check
  check (role in ('admin','hr_manager','catering_manager','ongc_head'));

-- Migrate existing 'manager' rows to hr_manager (the closest match).
update app_users set role = 'hr_manager' where role = 'manager';

-- New signups should default to hr_manager. handle_new_user() (0003) inserts no
-- role, so the value falls back to the COLUMN default — change that, not the
-- trigger body (which never references role).
alter table app_users alter column role set default 'hr_manager';

-- Optional installation binding for catering_manager users (their scope).
alter table app_users
  add column if not exists installation_id uuid
  references installations(id) on delete set null;
