-- Índices de catálogo que existían fuera del sistema formal de migraciones.
-- Son aditivos y pueden volver a ejecutarse de forma segura.

CREATE INDEX IF NOT EXISTS books_status_idx
  ON books (status);
CREATE INDEX IF NOT EXISTS books_genre_idx
  ON books (genre);
CREATE INDEX IF NOT EXISTS books_is_classic_idx
  ON books (is_classic);
CREATE INDEX IF NOT EXISTS books_author_id_idx
  ON books (author_id);
CREATE INDEX IF NOT EXISTS books_gutenberg_id_idx
  ON books (gutenberg_id);
