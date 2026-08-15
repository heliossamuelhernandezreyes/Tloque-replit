-- Papel deja de ser una recompensa y se convierte en un medidor auditable de IA.
CREATE TABLE IF NOT EXISTS paper_usage_events (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_key text NOT NULL UNIQUE,
  feature text NOT NULL CHECK (feature IN ('oracle', 'elevenlabs')),
  provider text NOT NULL DEFAULT '',
  input_units integer NOT NULL DEFAULT 0 CHECK (input_units >= 0),
  output_units integer NOT NULL DEFAULT 0 CHECK (output_units >= 0),
  paper_charged integer NOT NULL DEFAULT 0 CHECK (paper_charged >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paper_usage_user_created_idx
  ON paper_usage_events (user_id, created_at DESC);

-- Las instalaciones de prueba anteriores pudieron crear Papel mediante el
-- sorteo. No se borra historial financiero automáticamente: desde esta versión
-- ninguna tirada nueva lo emite y una migración operativa decidirá cómo ajustar
-- saldos beta antes del lanzamiento.
