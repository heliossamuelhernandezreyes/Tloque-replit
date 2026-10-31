-- Append-only evidence; never infer consent for legacy users or publications.
CREATE TABLE IF NOT EXISTS legal_acceptances (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  book_id integer NOT NULL REFERENCES books(id),
  book_revision integer NOT NULL CHECK (book_revision > 0),
  document_version text NOT NULL,
  document_hash text NOT NULL CHECK (document_hash ~ '^[a-f0-9]{64}$'),
  documents jsonb NOT NULL CHECK (jsonb_typeof(documents) = 'array'),
  work_hash text NOT NULL CHECK (work_hash ~ '^[a-f0-9]{64}$'),
  declaration jsonb NOT NULL CHECK (jsonb_typeof(declaration) = 'object'),
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (book_id, book_revision)
);
CREATE INDEX IF NOT EXISTS legal_acceptances_user_created_idx ON legal_acceptances(user_id, created_at);

CREATE TABLE IF NOT EXISTS privacy_requests (
  id serial PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  user_id integer REFERENCES users(id),
  email text NOT NULL,
  request_type text NOT NULL CHECK (request_type IN ('access','rectification','cancellation','opposition','revocation','restriction')),
  description text NOT NULL CHECK (length(description) BETWEEN 10 AND 4000),
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','verification','processing','answered','closed')),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS privacy_requests_status_created_idx ON privacy_requests(status, created_at);
CREATE TABLE IF NOT EXISTS privacy_request_events (
  id serial PRIMARY KEY,
  request_id integer NOT NULL REFERENCES privacy_requests(id),
  actor_id integer REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('received','verification','processing','answered','closed')),
  note text NOT NULL CHECK (length(note) BETWEEN 5 AND 2000),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION tloque_legal_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Legal evidence is append-only; a justified retention procedure is required';
END;
$$;
DROP TRIGGER IF EXISTS legal_acceptances_append_only ON legal_acceptances;
CREATE TRIGGER legal_acceptances_append_only BEFORE UPDATE OR DELETE ON legal_acceptances
FOR EACH ROW EXECUTE FUNCTION tloque_legal_append_only();
DROP TRIGGER IF EXISTS privacy_request_events_append_only ON privacy_request_events;
CREATE TRIGGER privacy_request_events_append_only BEFORE UPDATE OR DELETE ON privacy_request_events
FOR EACH ROW EXECUTE FUNCTION tloque_legal_append_only();
