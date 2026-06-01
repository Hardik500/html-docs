-- 0004_rate_limits.sql
-- Persistent rate-limit counters. Replaces the in-memory Map in ratelimit.server.ts
-- which resets on every cold start / deploy (especially problematic on Fly.io with
-- auto_stop_machines and on Vercel where each invocation may be a fresh process).

CREATE TABLE IF NOT EXISTS rate_limits (
  key      TEXT        PRIMARY KEY,
  count    INTEGER     NOT NULL DEFAULT 1,
  reset_at TIMESTAMPTZ NOT NULL
);

-- Allows the cleanup query to efficiently remove expired rows.
CREATE INDEX IF NOT EXISTS rate_limits_reset_at_idx ON rate_limits (reset_at);
