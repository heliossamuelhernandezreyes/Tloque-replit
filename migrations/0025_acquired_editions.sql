-- Never infer new rights or alter historic claims. New purchases pin a complete
-- authorised edition before checkout; a delayed payment cannot change its text.
CREATE TABLE IF NOT EXISTS licensed_editions (
  id serial PRIMARY KEY,
  book_id integer NOT NULL REFERENCES books(id),
  book_revision integer NOT NULL,
  acceptance_id integer NOT NULL REFERENCES legal_acceptances(id),
  work_hash text NOT NULL,
  snapshot jsonb NOT NULL,
  rights jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT licensed_editions_revision_unique UNIQUE(book_id, book_revision),
  CONSTRAINT licensed_editions_contract_check CHECK (
    book_revision > 0 AND work_hash ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(snapshot) = 'object' AND jsonb_typeof(rights) = 'object'
    AND (snapshot->>'id')::integer = book_id
    AND (snapshot->>'revision')::integer = book_revision
  )
);
ALTER TABLE book_tokens ADD COLUMN IF NOT EXISTS edition_id integer REFERENCES licensed_editions(id);
ALTER TABLE token_orders ADD COLUMN IF NOT EXISTS edition_id integer REFERENCES licensed_editions(id);
ALTER TABLE token_orders ADD COLUMN IF NOT EXISTS purchase_terms jsonb;
ALTER TABLE print_copies ADD COLUMN IF NOT EXISTS digital_claim_allowed boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS book_tokens_edition_idx ON book_tokens(edition_id);

CREATE OR REPLACE FUNCTION protect_licensed_edition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'licensed_editions is append-only'; END; $$;
DROP TRIGGER IF EXISTS licensed_editions_immutable ON licensed_editions;
CREATE TRIGGER licensed_editions_immutable BEFORE UPDATE OR DELETE ON licensed_editions
FOR EACH ROW EXECUTE FUNCTION protect_licensed_edition();

CREATE OR REPLACE FUNCTION protect_first_digital_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.token_id IS DISTINCT FROM OLD.token_id OR NEW.folio IS DISTINCT FROM OLD.folio OR
     NEW.digital_claim_allowed IS DISTINCT FROM OLD.digital_claim_allowed THEN
    RAISE EXCEPTION 'print copy licence identity is immutable';
  END IF;
  IF OLD.claimed_by_user_id IS NOT NULL AND
    (NEW.claimed_by_user_id IS DISTINCT FROM OLD.claimed_by_user_id OR
     NEW.claimed_at IS DISTINCT FROM OLD.claimed_at) THEN
    RAISE EXCEPTION 'digital claim is permanently linked to its first account';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS print_copies_first_claim ON print_copies;
CREATE TRIGGER print_copies_first_claim BEFORE UPDATE ON print_copies
FOR EACH ROW EXECUTE FUNCTION protect_first_digital_claim();

CREATE OR REPLACE FUNCTION protect_purchase_contract() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.edition_id IS NOT NULL AND NEW.edition_id IS DISTINCT FROM OLD.edition_id THEN
    RAISE EXCEPTION 'acquired edition is immutable';
  END IF;
  IF TG_TABLE_NAME = 'token_orders' AND OLD.purchase_terms IS NOT NULL AND
    NEW.purchase_terms IS DISTINCT FROM OLD.purchase_terms THEN
    RAISE EXCEPTION 'purchase terms are immutable';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS token_orders_contract ON token_orders;
CREATE TRIGGER token_orders_contract BEFORE UPDATE ON token_orders FOR EACH ROW EXECUTE FUNCTION protect_purchase_contract();

CREATE OR REPLACE FUNCTION protect_token_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.book_id IS DISTINCT FROM OLD.book_id OR
    NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.edition_id IS DISTINCT FROM OLD.edition_id THEN
    RAISE EXCEPTION 'token licence identity is immutable';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS book_tokens_identity ON book_tokens;
CREATE TRIGGER book_tokens_identity BEFORE UPDATE ON book_tokens FOR EACH ROW EXECUTE FUNCTION protect_token_identity();
