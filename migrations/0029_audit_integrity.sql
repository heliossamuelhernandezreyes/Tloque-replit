-- Preserve existing acquisitions without manufacturing historical consent.
ALTER TABLE user_cards ADD COLUMN IF NOT EXISTS edition_id integer REFERENCES licensed_editions(id);
CREATE INDEX IF NOT EXISTS user_cards_edition_idx ON user_cards(edition_id);
CREATE OR REPLACE FUNCTION protect_card_edition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE edition_book integer; card_book integer;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.edition_id IS NOT NULL AND NEW.edition_id IS DISTINCT FROM OLD.edition_id THEN
    RAISE EXCEPTION 'acquired card edition is immutable';
  END IF;
  IF NEW.edition_id IS NOT NULL THEN
    SELECT book_id INTO edition_book FROM licensed_editions WHERE id=NEW.edition_id;
    SELECT book_id INTO card_book FROM book_cards WHERE id=NEW.card_id;
    IF edition_book IS DISTINCT FROM card_book THEN RAISE EXCEPTION 'card edition belongs to another work'; END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS user_cards_edition_identity ON user_cards;
CREATE TRIGGER user_cards_edition_identity BEFORE INSERT OR UPDATE ON user_cards
FOR EACH ROW EXECUTE FUNCTION protect_card_edition();

ALTER TABLE experience_profiles ADD COLUMN IF NOT EXISTS content_hash text;
-- Only an exact source revision proves which manuscript was compiled.
UPDATE experience_profiles e SET content_hash=n.content_hash FROM narrative_projects n
WHERE e.content_hash IS NULL AND n.book_id=e.book_id AND n.chapter_index=e.chapter_index
  AND n.revision=e.source_project_revision;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='experience_profiles_hash_check' AND conrelid='experience_profiles'::regclass) THEN
    ALTER TABLE experience_profiles ADD CONSTRAINT experience_profiles_hash_check
      CHECK (content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$');
  END IF;
END $$;
