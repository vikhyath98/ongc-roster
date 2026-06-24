-- =====================================================================
-- 0011_cleanup.sql — drop the vestigial app_users.installation_id
-- 0010 added it, but catering-manager scoping actually lives in the
-- app_user_installations junction (many installations per user), so the
-- single column is unused. Safe + idempotent.
-- =====================================================================

alter table app_users
  drop column if exists installation_id;
