-- Integridad de clásicos: un Gutenberg ID representa una única obra, incluso
-- si la obra está en revisión u oculta. El índice parcial permite los libros
-- originales de Tloque, cuyo gutenberg_id es NULL.

CREATE UNIQUE INDEX IF NOT EXISTS books_gutenberg_id_unique_idx
  ON books (gutenberg_id)
  WHERE gutenberg_id IS NOT NULL;
