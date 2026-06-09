-- =====================================================================
-- ONGC Rotation System — app_users linkage  (build step 3)
--
-- Every Supabase auth user should have a matching public.app_users row, so
-- that FKs such as rotation_log.onboarded_by and employee_documents.verified_by
-- resolve. This adds a trigger that creates the row automatically on signup,
-- and backfills any users that already exist (e.g. created via the dashboard
-- before this trigger existed).
--
-- The app also upserts this row on sign-in (src/lib/appUser.js) as a safety
-- net; both paths are idempotent and compatible.
--
-- Safe to run more than once.
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_users (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill existing auth users (incl. the test user created earlier).
insert into public.app_users (id, email)
select id, email from auth.users
on conflict (id) do nothing;
