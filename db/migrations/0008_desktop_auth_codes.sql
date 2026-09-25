-- 0008_desktop_auth_codes.sql
-- One-time authorization codes for the Electron custom-protocol handoff.
-- Reusable desktop session tokens are never placed in the protocol URL.

CREATE TABLE IF NOT EXISTS desktop_auth_codes (
  code_hash TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS desktop_auth_codes_state_idx
  ON desktop_auth_codes(state, expires_at DESC);
