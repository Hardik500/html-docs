-- 0006_sync.sql
-- Add revision metadata for desktop offline-first synchronization.
-- Existing rows remain revision 1 and keep their current public-link behavior.

ALTER TABLE docs
  ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;

ALTER TABLE docs
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS sync_changes (
  seq BIGSERIAL PRIMARY KEY,
  doc_id TEXT NOT NULL,
  owner_user_id UUID NOT NULL,
  revision BIGINT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sync_changes_owner_seq_idx
  ON sync_changes(owner_user_id, seq);

CREATE INDEX IF NOT EXISTS sync_changes_doc_idx
  ON sync_changes(doc_id);

-- Seed the incremental feed for documents that existed before sync was added.
-- A cursor-0 desktop client must receive the complete account snapshot.
INSERT INTO sync_changes (doc_id, owner_user_id, revision)
SELECT d.id, d.owner_user_id, d.revision
  FROM docs d
 WHERE d.owner_user_id IS NOT NULL
   AND d.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM sync_changes sc WHERE sc.doc_id = d.id
   );
