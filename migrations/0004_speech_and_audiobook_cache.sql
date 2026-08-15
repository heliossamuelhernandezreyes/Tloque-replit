-- Editor Avanzado de voz y caché comunitaria de audiolibros v1.
-- La migración sólo almacena metadatos y claves de objetos; el audio nunca se
-- guarda como blob en PostgreSQL.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'inactive';
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_expires_at timestamp;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_subscription_status_check
    CHECK (subscription_status IN ('inactive', 'active', 'past_due', 'canceled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS voice_profiles (
  id serial PRIMARY KEY,
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  provider text NOT NULL DEFAULT 'elevenlabs' CHECK (provider IN ('elevenlabs')),
  provider_voice_id text NOT NULL,
  language text NOT NULL DEFAULT 'es',
  role text NOT NULL DEFAULT 'both' CHECK (role IN ('narrator', 'dialogue', 'both')),
  license text NOT NULL,
  source_url text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uniq_voice_provider_id UNIQUE (provider, provider_voice_id)
);

CREATE TABLE IF NOT EXISTS speech_projects (
  id serial PRIMARY KEY,
  book_id integer NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_index integer NOT NULL CHECK (chapter_index >= 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  data jsonb NOT NULL,
  created_by integer REFERENCES users(id),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uniq_speech_project_chapter UNIQUE (book_id, chapter_index)
);

CREATE TABLE IF NOT EXISTS speech_profiles (
  id serial PRIMARY KEY,
  book_id integer NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_index integer NOT NULL CHECK (chapter_index >= 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  source_project_revision integer NOT NULL CHECK (source_project_revision >= 1),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  character_count integer NOT NULL CHECK (character_count > 0),
  data jsonb NOT NULL,
  compiled_by integer REFERENCES users(id),
  compiled_at timestamp NOT NULL DEFAULT now(),
  published_at timestamp,
  CONSTRAINT uniq_speech_profile_chapter UNIQUE (book_id, chapter_index)
);

CREATE TABLE IF NOT EXISTS audiobook_cache (
  id serial PRIMARY KEY,
  cache_key text NOT NULL UNIQUE CHECK (cache_key ~ '^[a-f0-9]{64}$'),
  book_id integer NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_index integer NOT NULL CHECK (chapter_index >= 0),
  speech_profile_revision integer NOT NULL CHECK (speech_profile_revision >= 1),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  model_id text NOT NULL,
  storage_key text NOT NULL DEFAULT '',
  mime_type text NOT NULL DEFAULT 'audio/mpeg',
  duration_seconds integer,
  character_count integer NOT NULL CHECK (character_count > 0),
  status text NOT NULL DEFAULT 'generating' CHECK (status IN ('generating', 'ready', 'failed', 'retired')),
  generated_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audiobook_jobs (
  id serial PRIMARY KEY,
  request_key text NOT NULL UNIQUE,
  cache_key text NOT NULL CHECK (cache_key ~ '^[a-f0-9]{64}$'),
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id integer NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_index integer NOT NULL CHECK (chapter_index >= 0),
  speech_profile_revision integer NOT NULL CHECK (speech_profile_revision >= 1),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  model_id text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'ready', 'failed')),
  estimated_paper integer NOT NULL CHECK (estimated_paper >= 0),
  reserved_paper integer NOT NULL CHECK (reserved_paper >= 0),
  expected_characters integer NOT NULL CHECK (expected_characters > 0),
  actual_characters integer NOT NULL DEFAULT 0 CHECK (actual_characters >= 0),
  provider text NOT NULL DEFAULT 'elevenlabs',
  error_code text NOT NULL DEFAULT '',
  created_at timestamp NOT NULL DEFAULT now(),
  started_at timestamp,
  finished_at timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS audiobook_jobs_one_active_cache_idx
  ON audiobook_jobs (cache_key) WHERE status IN ('queued', 'processing');
CREATE INDEX IF NOT EXISTS voice_profiles_catalog_idx
  ON voice_profiles (status, language, role, label);
CREATE INDEX IF NOT EXISTS speech_projects_book_idx
  ON speech_projects (book_id, chapter_index);
CREATE INDEX IF NOT EXISTS speech_profiles_ready_idx
  ON speech_profiles (book_id, chapter_index, status);
CREATE INDEX IF NOT EXISTS audiobook_cache_chapter_idx
  ON audiobook_cache (book_id, chapter_index, status);
CREATE INDEX IF NOT EXISTS audiobook_jobs_user_idx
  ON audiobook_jobs (user_id, created_at DESC);
