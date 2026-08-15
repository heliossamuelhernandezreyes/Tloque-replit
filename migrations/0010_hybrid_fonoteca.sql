-- Fonoteca híbrida: streaming, síntesis procedural y bancos SF2/SF3/DLS.
-- Los bancos son opcionales y se descargan al dispositivo sólo por decisión
-- del lector; el repositorio guarda metadatos, recetas y licencias, no audio.

ALTER TABLE audio_assets
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'stream',
  ADD COLUMN IF NOT EXISTS recipe jsonb,
  ADD COLUMN IF NOT EXISTS musical_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS musical_mode text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS brightness real NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS texture text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pack_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pack_bytes integer,
  ADD COLUMN IF NOT EXISTS pack_sha256 text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS instrument_program integer;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audio_assets_source_type_check') THEN
    ALTER TABLE audio_assets ADD CONSTRAINT audio_assets_source_type_check
      CHECK (source_type IN ('stream', 'procedural', 'soundfont'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audio_assets_brightness_check') THEN
    ALTER TABLE audio_assets ADD CONSTRAINT audio_assets_brightness_check
      CHECK (brightness >= 0 AND brightness <= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audio_assets_pack_bytes_check') THEN
    ALTER TABLE audio_assets ADD CONSTRAINT audio_assets_pack_bytes_check
      CHECK (pack_bytes IS NULL OR pack_bytes > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audio_assets_program_check') THEN
    ALTER TABLE audio_assets ADD CONSTRAINT audio_assets_program_check
      CHECK (instrument_program IS NULL OR (instrument_program >= 0 AND instrument_program <= 127));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audio_assets_pack_hash_check') THEN
    ALTER TABLE audio_assets ADD CONSTRAINT audio_assets_pack_hash_check
      CHECK (pack_sha256 = '' OR pack_sha256 ~ '^[a-f0-9]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audio_assets_source_payload_check') THEN
    ALTER TABLE audio_assets ADD CONSTRAINT audio_assets_source_payload_check CHECK (
      (source_type = 'stream' AND length(url) > 0)
      OR (source_type = 'procedural' AND recipe IS NOT NULL)
      OR (source_type = 'soundfont' AND recipe IS NOT NULL AND length(pack_url) > 0)
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS audio_assets_source_type_idx
  ON audio_assets (source_type, status, kind);
