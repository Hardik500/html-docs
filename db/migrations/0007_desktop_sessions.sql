-- 0007_desktop_sessions.sql
-- Long-lived opaque bearer sessions for the hosted desktop client.
-- Only SHA-256 token hashes are stored; the bearer token is returned once in
-- the html-docs:// callback and is not recoverable from the database.

CREATE TABLE IF NOT EXISTS desktop_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS desktop_sessions_user_active_idx
  ON desktop_sessions (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;
