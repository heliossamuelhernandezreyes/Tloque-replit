CREATE TABLE IF NOT EXISTS visual_uploads (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  hash text NOT NULL,
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 20971520),
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT visual_uploads_owner_hash_unique UNIQUE(user_id, hash)
);
CREATE INDEX IF NOT EXISTS visual_uploads_status_created_idx ON visual_uploads(status, created_at);
