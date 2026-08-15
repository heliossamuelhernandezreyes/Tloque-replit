-- Fonoteca adaptativa v1: catálogos musicales, proyectos editoriales y
-- perfiles compactos consumidos por el lector. Esta migración es aditiva y
-- conserva chapter_audio_assignments como modo básico compatible.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_plan text NOT NULL DEFAULT 'reader';

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_subscription_plan_check
    CHECK (subscription_plan IN ('reader', 'aesthetic', 'audio'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS adaptive_scores (
  id serial PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  bpm integer NOT NULL CHECK (bpm BETWEEN 20 AND 300),
  musical_key text NOT NULL DEFAULT '',
  time_signature text NOT NULL DEFAULT '4/4',
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS adaptive_score_layers (
  id serial PRIMARY KEY,
  score_id integer NOT NULL REFERENCES adaptive_scores(id) ON DELETE CASCADE,
  asset_id integer NOT NULL REFERENCES audio_assets(id),
  layer_key text NOT NULL,
  family text NOT NULL CHECK (family IN ('base', 'harmony', 'melody', 'bass', 'texture', 'percussion', 'ambience')),
  role text NOT NULL DEFAULT 'stem' CHECK (role IN ('stem', 'loop', 'transition')),
  intensity_min real NOT NULL DEFAULT 0 CHECK (intensity_min BETWEEN 0 AND 1),
  intensity_max real NOT NULL DEFAULT 1 CHECK (intensity_max BETWEEN 0 AND 1),
  default_gain real NOT NULL DEFAULT 0.5 CHECK (default_gain BETWEEN 0 AND 1),
  sync_bars integer NOT NULL DEFAULT 4 CHECK (sync_bars BETWEEN 1 AND 64),
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  position integer NOT NULL DEFAULT 0,
  CONSTRAINT adaptive_score_layer_range CHECK (intensity_min <= intensity_max),
  CONSTRAINT uniq_adaptive_score_layer_key UNIQUE (score_id, layer_key)
);

CREATE TABLE IF NOT EXISTS narrative_projects (
  id serial PRIMARY KEY,
  book_id integer NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_index integer NOT NULL CHECK (chapter_index >= 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  data jsonb NOT NULL,
  created_by integer REFERENCES users(id),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uniq_narrative_project_chapter UNIQUE (book_id, chapter_index)
);

CREATE TABLE IF NOT EXISTS experience_profiles (
  id serial PRIMARY KEY,
  book_id integer NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_index integer NOT NULL CHECK (chapter_index >= 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  source_project_revision integer NOT NULL CHECK (source_project_revision >= 1),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  data jsonb NOT NULL,
  compiled_by integer REFERENCES users(id),
  compiled_at timestamp NOT NULL DEFAULT now(),
  published_at timestamp,
  CONSTRAINT uniq_experience_profile_chapter UNIQUE (book_id, chapter_index)
);

CREATE INDEX IF NOT EXISTS adaptive_scores_status_idx
  ON adaptive_scores (status, title);
CREATE INDEX IF NOT EXISTS adaptive_score_layers_score_idx
  ON adaptive_score_layers (score_id, position);
CREATE INDEX IF NOT EXISTS narrative_projects_book_idx
  ON narrative_projects (book_id, chapter_index);
CREATE INDEX IF NOT EXISTS experience_profiles_book_status_idx
  ON experience_profiles (book_id, chapter_index, status);
