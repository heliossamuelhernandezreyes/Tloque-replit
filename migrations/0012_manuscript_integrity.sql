-- Integridad editorial: revisión optimista, historial restaurable y borrador cloud.
ALTER TABLE books
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at timestamp;

ALTER TABLE token_orders
  ADD COLUMN IF NOT EXISTS author_user_id integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS author_share_bps integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS book_type_snapshot text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS book_revision_snapshot integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS refund_ref text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS refunded_at timestamp;

UPDATE token_orders o
SET author_user_id = b.author_id,
    author_share_bps = CASE WHEN o.kind = 'card' OR b.type = 'story' THEN 5000 ELSE 9000 END,
    book_type_snapshot = b.type,
    book_revision_snapshot = b.revision
FROM books b
WHERE b.id = o.book_id AND o.author_user_id IS NULL;

ALTER TABLE token_orders
  DROP CONSTRAINT IF EXISTS token_orders_author_share_bps_range;
ALTER TABLE token_orders
  ADD CONSTRAINT token_orders_author_share_bps_range
  CHECK (author_share_bps BETWEEN 0 AND 10000);

ALTER TABLE books
  DROP CONSTRAINT IF EXISTS books_revision_positive;
ALTER TABLE books
  ADD CONSTRAINT books_revision_positive CHECK (revision >= 1);

CREATE TABLE IF NOT EXISTS book_revisions (
  id serial PRIMARY KEY,
  book_id integer NOT NULL REFERENCES books(id),
  revision integer NOT NULL CHECK (revision >= 1),
  snapshot jsonb NOT NULL,
  change_type text NOT NULL DEFAULT 'update'
    CHECK (change_type IN ('create', 'update', 'publish', 'unpublish', 'restore', 'delete')),
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT book_revisions_book_revision_unique UNIQUE (book_id, revision)
);

CREATE INDEX IF NOT EXISTS book_revisions_book_created_idx
  ON book_revisions(book_id, created_at DESC);

CREATE TABLE IF NOT EXISTS book_drafts (
  book_id integer PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  author_id integer NOT NULL REFERENCES users(id),
  base_revision integer NOT NULL CHECK (base_revision >= 1),
  draft_revision integer NOT NULL DEFAULT 1 CHECK (draft_revision >= 1),
  data jsonb NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS book_drafts_author_updated_idx
  ON book_drafts(author_id, updated_at DESC);

-- Límite compartido entre réplicas autoscale. Las claves son hashes y expiran.
CREATE TABLE IF NOT EXISTS api_rate_limits (
  bucket_key text NOT NULL,
  window_start bigint NOT NULL,
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count >= 1),
  expires_at timestamp NOT NULL,
  PRIMARY KEY (bucket_key, window_start)
);

CREATE INDEX IF NOT EXISTS api_rate_limits_expires_idx
  ON api_rate_limits(expires_at);

-- Las obras ya existentes reciben un punto de restauración inicial. to_jsonb
-- conserva también campos añadidos por instalaciones anteriores.
INSERT INTO book_revisions (book_id, revision, snapshot, change_type)
SELECT b.id, b.revision, to_jsonb(b), 'create'
FROM books b
ON CONFLICT (book_id, revision) DO NOTHING;
