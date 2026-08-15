CREATE TABLE IF NOT EXISTS audio_assets (
  id serial PRIMARY KEY,
  title text NOT NULL,
  artist text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'music' CHECK (kind IN ('music', 'ambience', 'system')),
  url text NOT NULL,
  emotion text NOT NULL DEFAULT 'neutral',
  bpm integer CHECK (bpm IS NULL OR bpm BETWEEN 20 AND 300),
  energy real NOT NULL DEFAULT 0.5 CHECK (energy BETWEEN 0 AND 1),
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 1 AND 86400),
  loop boolean NOT NULL DEFAULT true,
  license text NOT NULL,
  source_name text NOT NULL DEFAULT '',
  source_url text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chapter_audio_assignments (
  id serial PRIMARY KEY,
  book_id integer NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_index integer NOT NULL CHECK (chapter_index >= 0),
  asset_id integer NOT NULL REFERENCES audio_assets(id),
  volume real NOT NULL DEFAULT 0.35 CHECK (volume BETWEEN 0 AND 1),
  loop boolean NOT NULL DEFAULT true,
  crossfade_seconds real NOT NULL DEFAULT 6 CHECK (crossfade_seconds BETWEEN 0.25 AND 20),
  assigned_by integer REFERENCES users(id),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uniq_book_chapter_audio UNIQUE (book_id, chapter_index)
);

CREATE TABLE IF NOT EXISTS audio_favorites (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id integer NOT NULL REFERENCES audio_assets(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uniq_audio_favorite UNIQUE (user_id, asset_id)
);

CREATE INDEX IF NOT EXISTS audio_assets_status_kind_idx
  ON audio_assets (status, kind);
CREATE INDEX IF NOT EXISTS chapter_audio_book_idx
  ON chapter_audio_assignments (book_id, chapter_index);
CREATE INDEX IF NOT EXISTS audio_favorites_user_idx
  ON audio_favorites (user_id);

-- Defensa adicional para que un reintento de webhook nunca duplique una compra.
CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_wallet_purchase_once_idx
  ON wallet_ledger (ref_id)
  WHERE ref_type = 'wallet_order' AND reason = 'purchase';

-- El borrado de una tarjeta debe retirar sus copias de colecciones, incluso
-- si se ejecuta fuera de la ruta normal de la aplicación.
ALTER TABLE user_cards
  DROP CONSTRAINT IF EXISTS user_cards_card_id_book_cards_id_fk;
ALTER TABLE user_cards
  ADD CONSTRAINT user_cards_card_id_book_cards_id_fk
  FOREIGN KEY (card_id) REFERENCES book_cards(id) ON DELETE CASCADE;

-- El interruptor del sorteo necesita una fila única aun en instalaciones
-- recién creadas. Los valores conservan exactamente la economía existente.
INSERT INTO gacha_config
  (id, enabled, pool_balance, ticket_price, split_direct, split_pool, split_house)
VALUES
  (1, false, 0, 40, 16, 12, 12)
ON CONFLICT (id) DO NOTHING;
