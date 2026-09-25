-- A purchase owns an edition, not a mutable reference to the author's editor.
ALTER TABLE book_cards ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE book_cards ADD CONSTRAINT book_cards_archived_pool_check CHECK (NOT archived OR NOT in_gacha_pool);
ALTER TABLE user_cards ADD COLUMN IF NOT EXISTS snapshot jsonb;

CREATE OR REPLACE FUNCTION tloque_card_snapshot(c book_cards) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'snapshotVersion', 1, 'id', c.id, 'bookId', c.book_id, 'authorId', c.author_id,
    'name', c.name, 'subtitle', c.subtitle, 'description', c.description,
    'fx', c.fx, 'rarity', c.rarity, 'inGachaPool', c.in_gacha_pool,
    'unlock', c.unlock_mode, 'priceTinta', c.price_tinta, 'position', c.position,
    'createdAt', c.created_at,
    'frameSnapshot', (SELECT f.pkg FROM frames f WHERE f.id::text = c.fx->>'frameId')
  );
$$;

-- Historical purchases can preserve only the edition available at migration.
UPDATE user_cards uc SET snapshot = tloque_card_snapshot(c)
FROM book_cards c WHERE c.id = uc.card_id AND uc.snapshot IS NULL;

CREATE OR REPLACE FUNCTION tloque_preserve_card_purchase() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE c book_cards;
BEGIN
  SELECT * INTO c FROM book_cards WHERE id = NEW.card_id FOR SHARE;
  IF NOT FOUND OR c.archived THEN
    RAISE EXCEPTION 'Card unavailable' USING ERRCODE = '23514';
  END IF;
  NEW.snapshot := tloque_card_snapshot(c);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS preserve_card_purchase ON user_cards;
CREATE TRIGGER preserve_card_purchase BEFORE INSERT ON user_cards
FOR EACH ROW EXECUTE FUNCTION tloque_preserve_card_purchase();

-- Replace every historical FK name, including drizzle-push installations.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'user_cards'::regclass AND confrelid = 'book_cards'::regclass AND contype = 'f'
  LOOP EXECUTE format('ALTER TABLE user_cards DROP CONSTRAINT %I', r.conname); END LOOP;
END $$;
ALTER TABLE user_cards ADD CONSTRAINT user_cards_card_preserved_fk
  FOREIGN KEY (card_id) REFERENCES book_cards(id) ON DELETE RESTRICT;
