-- Estudio de audio V1: partitura lineal segura, microsonidos procedurales y
-- asignación administrativa de cada evento estable de la interfaz.

ALTER TABLE audio_assets DROP CONSTRAINT IF EXISTS audio_assets_source_type_check;
ALTER TABLE audio_assets ADD CONSTRAINT audio_assets_source_type_check
  CHECK (source_type IN ('stream', 'procedural', 'soundfont', 'score', 'sfx'));

ALTER TABLE audio_assets DROP CONSTRAINT IF EXISTS audio_assets_source_payload_check;
ALTER TABLE audio_assets ADD CONSTRAINT audio_assets_source_payload_check CHECK (
  (source_type = 'stream' AND length(url) > 0)
  OR (source_type IN ('procedural', 'score', 'sfx') AND recipe IS NOT NULL)
  OR (source_type = 'soundfont' AND recipe IS NOT NULL AND length(pack_url) > 0)
);

CREATE TABLE IF NOT EXISTS audio_event_bindings (
  event_key text PRIMARY KEY,
  asset_id integer NOT NULL REFERENCES audio_assets(id) ON DELETE CASCADE,
  volume real NOT NULL DEFAULT 0.8,
  cooldown_ms integer NOT NULL DEFAULT 70,
  enabled boolean NOT NULL DEFAULT true,
  updated_by integer REFERENCES users(id),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT audio_event_bindings_volume_check CHECK (volume >= 0 AND volume <= 1),
  CONSTRAINT audio_event_bindings_cooldown_check CHECK (cooldown_ms >= 0 AND cooldown_ms <= 10000)
);

CREATE INDEX IF NOT EXISTS audio_event_bindings_asset_idx
  ON audio_event_bindings (asset_id);

-- La instalación nace con cada sonido que ya utiliza la app representado en
-- la Fonoteca. Son recetas propias: no descargan audio ni introducen licencias
-- externas. El runtime conserva fallbacks locales si la base no está lista.
WITH defaults(event_key, title, wave, start_hz, end_hz, duration, attack, release, gain_value, filter_type, filter_hz) AS (
  VALUES
    ('ui.orb.tap', 'Orbe · toque cristalino', 'sine', 680, 1020, 0.28, 0.004, 0.24, 0.08, 'lowpass', 6000),
    ('ui.orb.hold', 'Orbe · activación ascendente', 'sine', 400, 720, 0.38, 0.04, 0.30, 0.10, 'lowpass', 5200),
    ('ui.genre.cycle.todos', 'Género · general', 'sine', 440, 660, 0.30, 0.004, 0.24, 0.10, 'lowpass', 6000),
    ('ui.genre.cycle.melancolico', 'Género · melancólico', 'sine', 220, 277, 0.62, 0.02, 0.54, 0.10, 'lowpass', 3000),
    ('ui.genre.cycle.terror', 'Género · terror', 'sawtooth', 110, 92, 0.42, 0.003, 0.35, 0.08, 'lowpass', 1200),
    ('ui.genre.cycle.fantasia', 'Género · fantasía', 'sine', 392, 740, 0.48, 0.006, 0.36, 0.08, 'highpass', 300),
    ('ui.genre.cycle.misterio', 'Género · misterio', 'sine', 370, 523, 0.48, 0.01, 0.40, 0.09, 'bandpass', 1200),
    ('ui.genre.cycle.romance', 'Género · romance', 'sine', 392, 494, 0.50, 0.012, 0.42, 0.09, 'lowpass', 4800),
    ('ui.genre.reset', 'Género · restablecer', 'sine', 440, 550, 0.28, 0.004, 0.22, 0.10, 'lowpass', 6000),
    ('ui.book.save', 'Libro · guardado', 'sine', 660, 880, 0.24, 0.004, 0.18, 0.11, 'lowpass', 6500),
    ('ui.page.turn', 'Lectura · página', 'noise', 900, NULL, 0.13, 0.012, 0.10, 0.035, 'bandpass', 900),
    ('ui.navigation', 'Interfaz · navegación', 'sine', 480, 720, 0.18, 0.003, 0.13, 0.065, 'lowpass', 6000),
    ('ui.book.complete', 'Libro · completado', 'triangle', 523, 1047, 1.70, 0.02, 1.55, 0.10, 'lowpass', 7500),
    ('ui.streak.milestone', 'Racha · hito', 'triangle', 784, 1568, 0.65, 0.008, 0.54, 0.09, 'lowpass', 8000)
)
INSERT INTO audio_assets (
  title, artist, kind, source_type, url, recipe, musical_key, musical_mode,
  brightness, texture, tags, emotion, energy, duration_seconds, loop, license,
  source_name, source_url, status
)
SELECT
  defaults.title, 'Tloque', 'system', 'sfx', '',
  jsonb_build_object(
    'version', 1,
    'seed', 202608,
    'filter', jsonb_build_object('type', filter_type, 'frequency', filter_hz, 'q', 0.7),
    'voices', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'wave', wave, 'startHz', start_hz, 'endHz', end_hz, 'offset', 0,
      'duration', duration, 'attack', attack, 'release', release, 'gain', gain_value
    )))
  ),
  '', '', 0.5, 'microsonido procedural', jsonb_build_array(event_key, 'interface', 'procedural'),
  'neutral', 0.25, GREATEST(1, CEIL(duration)::integer), false,
  'Propio · Tloque', 'Tloque UI built-ins', '', 'published'
FROM defaults
WHERE NOT EXISTS (
  SELECT 1 FROM audio_assets existing
  WHERE existing.kind = 'system' AND existing.tags @> jsonb_build_array(defaults.event_key)
);

INSERT INTO audio_event_bindings (event_key, asset_id, volume, cooldown_ms, enabled)
SELECT tags->>0, id, 0.8,
  CASE tags->>0
    WHEN 'ui.orb.tap' THEN 55
    WHEN 'ui.page.turn' THEN 140
    WHEN 'ui.book.save' THEN 350
    WHEN 'ui.book.complete' THEN 1500
    WHEN 'ui.streak.milestone' THEN 1500
    ELSE 90
  END,
  true
FROM audio_assets
WHERE kind = 'system'
  AND source_type = 'sfx'
  AND source_name = 'Tloque UI built-ins'
  AND tags->>0 LIKE 'ui.%'
ON CONFLICT (event_key) DO NOTHING;
