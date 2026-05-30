-- 0003_supabase_auth.sql
-- Drop auth-managed tables and re-wire docs FK to auth.users

-- Drop tables that Supabase Auth now owns
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS magic_tokens;

-- Remove FK from docs → public.users before dropping public.users
ALTER TABLE docs DROP CONSTRAINT IF EXISTS docs_owner_user_id_fkey;

-- Drop the custom users table (Supabase manages auth.users)
DROP TABLE IF EXISTS users;

-- Re-add FK pointing to Supabase's auth schema
-- ON DELETE SET NULL: if a Supabase user is deleted, their docs become anonymous
ALTER TABLE docs
  ADD CONSTRAINT docs_owner_user_id_fkey
  FOREIGN KEY (owner_user_id)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;
