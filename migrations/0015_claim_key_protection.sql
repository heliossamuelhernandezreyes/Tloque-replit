-- Las claves nuevas se cifran en la aplicación con AES-256-GCM y se verifican
-- mediante HMAC. Las filas históricas permanecen legibles y se protegen de
-- forma perezosa cuando el propietario vuelve a abrirlas o alguien las reclama.

ALTER TABLE print_copies
  ADD COLUMN IF NOT EXISTS claim_key_hash text NOT NULL DEFAULT '';

ALTER TABLE print_copies
  DROP CONSTRAINT IF EXISTS print_copies_claim_key_hash_check;
ALTER TABLE print_copies
  ADD CONSTRAINT print_copies_claim_key_hash_check
  CHECK (claim_key_hash = '' OR claim_key_hash ~ '^[a-f0-9]{64}$');
