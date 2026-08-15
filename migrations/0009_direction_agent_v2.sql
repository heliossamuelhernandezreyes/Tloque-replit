-- Partitura avanzada v2 y Director Artificial.
-- Sólo almacena anotaciones laterales, hashes y contabilidad. El manuscrito,
-- audio y música generada no forman parte de estas tablas.

CREATE TABLE IF NOT EXISTS advanced_direction_projects (
  id serial PRIMARY KEY,
  book_id integer NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_index integer NOT NULL CHECK (chapter_index >= 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  data jsonb NOT NULL,
  created_by integer REFERENCES users(id),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uniq_advanced_direction_chapter UNIQUE (book_id, chapter_index)
);

CREATE TABLE IF NOT EXISTS direction_agent_runs (
  id serial PRIMARY KEY,
  request_key text NOT NULL UNIQUE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id integer NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_index integer NOT NULL CHECK (chapter_index >= 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  mode text NOT NULL DEFAULT 'replace_unlocked'
    CHECK (mode IN ('replace_unlocked', 'fill_gaps')),
  status text NOT NULL DEFAULT 'quoted'
    CHECK (status IN ('quoted', 'processing', 'ready', 'applied', 'failed', 'expired')),
  prompt_version text NOT NULL,
  provider text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  estimated_input_units integer NOT NULL CHECK (estimated_input_units >= 0),
  estimated_output_units integer NOT NULL CHECK (estimated_output_units >= 0),
  estimated_paper integer NOT NULL CHECK (estimated_paper >= 0),
  maximum_paper integer NOT NULL CHECK (maximum_paper >= estimated_paper),
  reserved_paper integer NOT NULL DEFAULT 0 CHECK (reserved_paper >= 0),
  actual_input_units integer NOT NULL DEFAULT 0 CHECK (actual_input_units >= 0),
  actual_output_units integer NOT NULL DEFAULT 0 CHECK (actual_output_units >= 0),
  charged_paper integer NOT NULL DEFAULT 0 CHECK (charged_paper >= 0),
  proposal jsonb,
  error_code text NOT NULL DEFAULT '',
  expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  started_at timestamp,
  finished_at timestamp
);

CREATE INDEX IF NOT EXISTS advanced_direction_projects_book_idx
  ON advanced_direction_projects (book_id, chapter_index);
CREATE INDEX IF NOT EXISTS direction_agent_runs_user_idx
  ON direction_agent_runs (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS direction_agent_one_active_request_idx
  ON direction_agent_runs (request_key) WHERE status IN ('quoted', 'processing');
