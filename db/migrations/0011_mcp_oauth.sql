-- 0011_mcp_oauth.sql
-- OAuth 2.1 authorization for the MCP endpoint: dynamic client registration,
-- PKCE authorization codes, rotating refresh tokens, and audience-bound
-- access tokens stored alongside existing personal access tokens.

CREATE TABLE IF NOT EXISTS agent_oauth_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL UNIQUE,
  client_name TEXT NOT NULL,
  redirect_uris TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

-- Personal access tokens stay valid; OAuth access tokens are distinguished by
-- credential_type and are bound to a single MCP resource audience.
ALTER TABLE agent_access_tokens
  ADD COLUMN IF NOT EXISTS credential_type TEXT NOT NULL DEFAULT 'pat',
  ADD COLUMN IF NOT EXISTS resource TEXT,
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES agent_oauth_clients(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS agent_access_tokens_client_idx
  ON agent_access_tokens (client_id, created_at DESC)
  WHERE credential_type = 'oauth';

CREATE TABLE IF NOT EXISTS agent_oauth_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  client_pk UUID NOT NULL REFERENCES agent_oauth_clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_oauth_authorization_codes_expiry_idx
  ON agent_oauth_authorization_codes (expires_at ASC);

CREATE TABLE IF NOT EXISTS agent_oauth_refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_pk UUID NOT NULL REFERENCES agent_oauth_clients(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  access_token_id UUID REFERENCES agent_access_tokens(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_oauth_refresh_tokens_client_idx
  ON agent_oauth_refresh_tokens (client_pk, created_at DESC);

-- Lets a user see and revoke OAuth grants independently of personal tokens.
CREATE TABLE IF NOT EXISTS agent_oauth_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_pk UUID NOT NULL REFERENCES agent_oauth_clients(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (user_id, client_pk)
);

-- Expired authorization codes and dead refresh tokens accumulate otherwise.
CREATE INDEX IF NOT EXISTS agent_oauth_refresh_tokens_expiry_idx
  ON agent_oauth_refresh_tokens (expires_at ASC);
