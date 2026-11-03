-- No historical rows, balances, acceptances or acquired rights are rewritten.
ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS funding jsonb;
ALTER TABLE wallet_orders ADD COLUMN IF NOT EXISTS funding_policy text;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wallet_funding_conserves_amounts' AND conrelid='wallet_ledger'::regclass) THEN
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_funding_conserves_amounts CHECK (
  funding IS NULL OR (
    jsonb_typeof(funding) = 'object'
    AND funding ?& ARRAY['legacyUnits','legacyCents','paidUnits','paidCents']
    AND (funding->>'legacyUnits')::bigint + (funding->>'paidUnits')::bigint = delta
    AND (funding->>'legacyCents')::bigint + (funding->>'paidCents')::bigint = cash_backing_cents
  )
);
END IF;
END $$;

-- A fresh permission for the same manuscript creates a distinct immutable grant.
ALTER TABLE licensed_editions DROP CONSTRAINT IF EXISTS licensed_editions_revision_unique;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='licensed_editions_acceptance_unique' AND conrelid='licensed_editions'::regclass) THEN
    ALTER TABLE licensed_editions ADD CONSTRAINT licensed_editions_acceptance_unique UNIQUE(book_id,book_revision,acceptance_id);
  END IF;
END $$;

-- Author permission may be renewed without rewriting a manuscript or old receipt.
ALTER TABLE legal_acceptances DROP CONSTRAINT IF EXISTS legal_acceptances_book_id_book_revision_key;
CREATE INDEX IF NOT EXISTS legal_acceptances_work_latest_idx ON legal_acceptances(book_id,work_hash,id DESC);
