-- 0009_agent_tokens.sql
-- Personal access tokens for the hosted MCP server.
-- Only SHA-256 token hashes are stored; plaintext tokens are shown once.

CREATE TABLE IF NOT EXISTS agent_access_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['docs:read']::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS agent_access_tokens_user_idx
  ON agent_access_tokens (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_access_tokens_active_idx
  ON agent_access_tokens (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS agent_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_id UUID REFERENCES agent_access_tokens(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  document_id TEXT,
  status TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_audit_events_user_idx
  ON agent_audit_events (user_id, created_at DESC);
