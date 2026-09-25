ALTER TABLE books ADD COLUMN IF NOT EXISTS client_draft_id text;
CREATE UNIQUE INDEX IF NOT EXISTS books_author_client_draft_idx ON books(author_id, client_draft_id) WHERE client_draft_id IS NOT NULL;
