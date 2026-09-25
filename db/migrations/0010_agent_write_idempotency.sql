-- 0010_agent_write_idempotency.sql
-- Replay protection for agent-initiated writes so a retried MCP tool call
-- cannot create a second document or apply the same edit twice.

CREATE TABLE IF NOT EXISTS agent_idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID NOT NULL REFERENCES agent_access_tokens(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (token_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS agent_idempotency_keys_created_idx
  ON agent_idempotency_keys (created_at ASC);
