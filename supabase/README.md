# Database setup

SQL for the ONGC Rotation System. Source of truth: [`../SPEC.md`](../SPEC.md) §4.

```
supabase/
  migrations/
    0001_init.sql   # all tables, indexes, updated_at triggers (SPEC.md §4)
    0002_rls.sql    # RLS policies: any authenticated user = full read/write
  seed.sql          # reference + config data (idempotent; safe to re-run)
```

`0002_rls.sql` implements the v1 access model (SPEC.md §2): every logged-in
manager can read/write every table. The `anon` role stays locked out.
Per-installation scoping is deferred to phase 2 (SPEC.md §9).

## Applying it

You need DDL access, which the app's publishable/anon key does **not** have.
Use one of the two paths below.

### Option A — Supabase SQL Editor (no tooling, quickest)

1. Open your project → **SQL Editor** → **New query**.
2. Paste the entire contents of `migrations/0001_init.sql`, **Run**.
3. New query → paste `seed.sql`, **Run**.
4. New query → paste `migrations/0002_rls.sql`, **Run** (RLS policies).
5. Verify under **Table Editor** that 14 tables exist and that
   `categories` (4), `installations` (14), `designations` (9),
   `document_types` (13), and `app_config` (5) are populated.

### Option B — Supabase CLI (repeatable)

```bash
# one-time
supabase login
supabase link --project-ref vjovhydahukdnyybewtt   # asks for the DB password

# apply schema + seed
supabase db push          # runs migrations/
psql "$DATABASE_URL" -f supabase/seed.sql   # or paste seed.sql in SQL Editor
```

## Quick verification queries

```sql
select count(*) from installations;   -- expect 14
select count(*) from designations;    -- expect 9 (plus any you add later)
select count(*) from document_types;  -- expect 13
select key, value from app_config order by key;  -- 5 rows
-- ITI Certificate must map to BOTH Electrician and Plumber:
select dt.name, dg.name
from document_type_designations m
join document_types dt on dt.id = m.document_type_id
join designations  dg on dg.id = m.designation_id
where dt.name = 'ITI Certificate';
```
