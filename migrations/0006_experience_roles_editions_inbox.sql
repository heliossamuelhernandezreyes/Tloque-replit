-- Experiencia v2: ejemplares comerciales auditables y buzón transaccional.

ALTER TABLE print_copies
  ADD COLUMN IF NOT EXISTS sale_status text NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS sold_at timestamp,
  ADD COLUMN IF NOT EXISTS sale_price_cents integer,
  ADD COLUMN IF NOT EXISTS sale_channel text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sale_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();

DO $$ BEGIN
  ALTER TABLE print_copies ADD CONSTRAINT print_copies_sale_status_check
    CHECK (sale_status IN ('available', 'sold', 'returned'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE print_copies ADD CONSTRAINT print_copies_sale_price_check
    CHECK (sale_price_cents IS NULL OR sale_price_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS print_copy_events (
  id serial PRIMARY KEY,
  copy_id integer NOT NULL REFERENCES print_copies(id),
  actor_user_id integer NOT NULL REFERENCES users(id),
  event_type text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS print_copy_events_copy_created_idx
  ON print_copy_events(copy_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  kind text NOT NULL DEFAULT 'system',
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  destination text NOT NULL DEFAULT '',
  dedupe_key text NOT NULL DEFAULT '',
  read_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications(user_id, read_at) WHERE read_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_dedupe_idx
  ON notifications(user_id, dedupe_key) WHERE dedupe_key <> '';
