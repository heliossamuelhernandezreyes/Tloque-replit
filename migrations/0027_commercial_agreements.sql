CREATE TABLE IF NOT EXISTS commercial_agreements (
  id serial PRIMARY KEY,
  book_id integer NOT NULL REFERENCES books(id),
  author_id integer NOT NULL REFERENCES users(id),
  acceptance_id integer NOT NULL REFERENCES legal_acceptances(id),
  work_hash text NOT NULL,
  terms_hash text NOT NULL,
  terms jsonb NOT NULL,
  accepted_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(book_id, author_id, acceptance_id, terms_hash)
);
ALTER TABLE commercial_approvals ADD COLUMN IF NOT EXISTS commercial_agreement_id integer REFERENCES commercial_agreements(id);
CREATE INDEX IF NOT EXISTS commercial_agreements_author_idx ON commercial_agreements(author_id,id DESC);
DROP TRIGGER IF EXISTS commercial_agreements_immutable ON commercial_agreements;
CREATE TRIGGER commercial_agreements_immutable BEFORE UPDATE OR DELETE ON commercial_agreements FOR EACH ROW EXECUTE FUNCTION protect_rights_evidence();
-- No historical acceptance or approval is fabricated. Existing deliveries remain valid.
