ALTER TABLE books ADD COLUMN IF NOT EXISTS rights_hold boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS books_rights_hold_idx ON books(id) WHERE rights_hold=true;
CREATE TABLE IF NOT EXISTS commercial_approvals (
  id serial PRIMARY KEY,
  book_id integer NOT NULL REFERENCES books(id),
  acceptance_id integer NOT NULL REFERENCES legal_acceptances(id),
  work_hash text NOT NULL,
  actor_id integer NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('approve','withdraw')),
  agreement_ref text NOT NULL,
  evidence_ref text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commercial_approvals_book_idx ON commercial_approvals(book_id,id DESC);
CREATE TABLE IF NOT EXISTS copyright_cases (
  id serial PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  book_id integer NOT NULL REFERENCES books(id),
  author_id integer REFERENCES users(id),
  claimant_name text NOT NULL,
  claimant_email text NOT NULL,
  work_description text NOT NULL,
  location text NOT NULL,
  rights_basis text NOT NULL,
  status text NOT NULL DEFAULT 'received'
    CHECK(status IN ('received','removed','counter_received','counter_notified','proceedings','restored','rejected','closed')),
  counter_notice jsonb,
  notified_at timestamp,
  deadline_at timestamp,
  proceeding_ref text NOT NULL DEFAULT '',
  prior_status text,
  held_work_hash text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS copyright_case_events (
  id serial PRIMARY KEY,
  case_id integer NOT NULL REFERENCES copyright_cases(id),
  actor_id integer REFERENCES users(id),
  action text NOT NULL,
  note text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS copyright_cases_book_status_idx ON copyright_cases(book_id,status);
CREATE OR REPLACE FUNCTION protect_rights_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'rights evidence is append-only'; END; $$;
DROP TRIGGER IF EXISTS commercial_approvals_immutable ON commercial_approvals;
CREATE TRIGGER commercial_approvals_immutable BEFORE UPDATE OR DELETE ON commercial_approvals FOR EACH ROW EXECUTE FUNCTION protect_rights_evidence();
DROP TRIGGER IF EXISTS copyright_events_immutable ON copyright_case_events;
CREATE TRIGGER copyright_events_immutable BEFORE UPDATE OR DELETE ON copyright_case_events FOR EACH ROW EXECUTE FUNCTION protect_rights_evidence();
