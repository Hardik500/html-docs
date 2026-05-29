CREATE INDEX IF NOT EXISTS magic_tokens_expires_idx ON magic_tokens(expires_at);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS rate_limits_reset_idx ON rate_limits(reset_at);

ALTER TABLE docs ALTER COLUMN title TYPE VARCHAR(500);
ALTER TABLE tabs ALTER COLUMN name TYPE VARCHAR(200);
ALTER TABLE tabs ALTER COLUMN slug TYPE VARCHAR(200);

DELETE FROM magic_tokens WHERE expires_at < now();
DELETE FROM sessions WHERE expires_at < now();
DELETE FROM rate_limits WHERE reset_at < now();
