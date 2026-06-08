-- 0005_markdown_support.sql
-- Adds per-tab content type so tabs can hold either HTML or Markdown source.
-- Existing tabs default to 'html' to preserve current behaviour.

ALTER TABLE tabs ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'html';
