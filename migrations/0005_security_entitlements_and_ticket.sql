-- Seguridad e integridad v1. El sorteo queda en $20 MXN (10 Tinta) sin
-- reescribir configuraciones que un operador haya personalizado.

ALTER TABLE gacha_config ALTER COLUMN ticket_price SET DEFAULT 10;
ALTER TABLE gacha_config ALTER COLUMN split_direct SET DEFAULT 3;
ALTER TABLE gacha_config ALTER COLUMN split_pool SET DEFAULT 4;
ALTER TABLE gacha_config ALTER COLUMN split_house SET DEFAULT 3;

UPDATE gacha_config
SET ticket_price = 10,
    split_direct = 3,
    split_pool = 4,
    split_house = 3,
    updated_at = now()
WHERE ticket_price = 40
  AND split_direct = 16
  AND split_pool = 12
  AND split_house = 12;

DO $$ BEGIN
  ALTER TABLE gacha_config ADD CONSTRAINT gacha_config_nonnegative_check
    CHECK (pool_balance >= 0 AND ticket_price > 0
      AND split_direct >= 0 AND split_pool >= 0 AND split_house >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE gacha_config ADD CONSTRAINT gacha_config_split_check
    CHECK (split_direct + split_pool + split_house = ticket_price);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE audiobook_cache ADD CONSTRAINT audiobook_cache_storage_key_check
    CHECK (status <> 'ready' OR
      (storage_key <> '' AND storage_key !~ '(^/|\\\\|(^|/)\.\.?(/|$))'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
