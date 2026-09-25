/**
 * Schema for the Electron desktop runtime.
 *
 * Keep this separate from the hosted PostgreSQL migrations. The desktop
 * database is local to the machine, has no Supabase auth schema, and must be
 * initialised before the local React Router server starts serving requests.
 */
export const LOCAL_SCHEMA_VERSION = 3;

export const LOCAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS docs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  owner_user_id UUID,
  edit_token TEXT NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 0,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revision BIGINT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ
);

ALTER TABLE docs ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE docs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS docs_owner_idx ON docs(owner_user_id);
CREATE INDEX IF NOT EXISTS docs_last_activity_idx ON docs(last_activity_at);

CREATE TABLE IF NOT EXISTS tabs (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  html TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_type TEXT NOT NULL DEFAULT 'html',
  UNIQUE (doc_id, slug)
);

ALTER TABLE tabs ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'html';

CREATE INDEX IF NOT EXISTS tabs_doc_position_idx ON tabs(doc_id, position);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  doc_id TEXT PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
  remote_revision BIGINT NOT NULL DEFAULT 0,
  dirty BOOLEAN NOT NULL DEFAULT FALSE,
  force_push BOOLEAN NOT NULL DEFAULT FALSE,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  doc_id TEXT PRIMARY KEY,
  remote_payload TEXT NOT NULL,
  local_payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export const LOCAL_MIGRATIONS = [
  { version: 1, sql: LOCAL_SCHEMA },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_conflicts (
        doc_id TEXT PRIMARY KEY,
        remote_payload TEXT NOT NULL,
        local_payload TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE sync_state
        ADD COLUMN IF NOT EXISTS force_push BOOLEAN NOT NULL DEFAULT FALSE;
    `,
  },
];
