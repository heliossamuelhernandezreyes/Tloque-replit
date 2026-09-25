CREATE TABLE IF NOT EXISTS ai_requests (
  id serial PRIMARY KEY,
  request_key text NOT NULL UNIQUE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  input_hash text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  reserved_paper integer NOT NULL CHECK (reserved_paper > 0),
  result jsonb,
  expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_requests_recovery_idx ON ai_requests(status, expires_at);
