-- Durable purchase intents and explicit commercial licence lifecycle.
ALTER TABLE book_tokens ADD COLUMN IF NOT EXISTS license_status text NOT NULL DEFAULT 'active';
ALTER TABLE token_orders ADD COLUMN IF NOT EXISTS purchase_key text;
ALTER TABLE token_orders ADD COLUMN IF NOT EXISTS purchase_fingerprint text NOT NULL DEFAULT '';
ALTER TABLE token_orders ADD COLUMN IF NOT EXISTS checkout_request jsonb;
ALTER TABLE token_orders ADD COLUMN IF NOT EXISTS checkout_url text NOT NULL DEFAULT '';

ALTER TABLE wallet_orders ADD COLUMN IF NOT EXISTS purchase_key text;
ALTER TABLE wallet_orders ADD COLUMN IF NOT EXISTS purchase_fingerprint text NOT NULL DEFAULT '';
ALTER TABLE wallet_orders ADD COLUMN IF NOT EXISTS checkout_request jsonb;
ALTER TABLE wallet_orders ADD COLUMN IF NOT EXISTS checkout_url text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS wallet_orders_purchase_key_idx ON wallet_orders(user_id, purchase_key);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  event_id text PRIMARY KEY,
  payment_ref text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
INSERT INTO payment_webhook_events(event_id, payment_ref)
SELECT provider_event_id, payment_ref FROM payment_incidents ON CONFLICT DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS token_orders_purchase_key_idx ON token_orders(user_id, purchase_key);
CREATE INDEX IF NOT EXISTS book_tokens_owner_license_idx ON book_tokens(owner_user_id, book_id, license_status);
CREATE INDEX IF NOT EXISTS wallet_ledger_payment_adjustment_idx ON wallet_ledger(ref_type, ref_id)
  WHERE ref_type = 'wallet_order_adjustment';
CREATE UNIQUE INDEX IF NOT EXISTS payment_incidents_provider_object_idx ON payment_incidents(provider_object_id);
CREATE INDEX IF NOT EXISTS payment_incidents_payment_ref_idx ON payment_incidents(payment_ref);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'book_tokens_license_status_check') THEN
    ALTER TABLE book_tokens ADD CONSTRAINT book_tokens_license_status_check
      CHECK (license_status IN ('active', 'suspended', 'revoked'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'token_orders_purchase_key_check') THEN
    ALTER TABLE token_orders ADD CONSTRAINT token_orders_purchase_key_check
      CHECK (purchase_key IS NULL OR (purchase_key ~ '^[A-Za-z0-9_-]{16,128}$' AND purchase_fingerprint ~ '^[a-f0-9]{64}$'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallet_orders_purchase_key_check') THEN
    ALTER TABLE wallet_orders ADD CONSTRAINT wallet_orders_purchase_key_check
      CHECK (purchase_key IS NULL OR (purchase_key ~ '^[A-Za-z0-9_-]{16,128}$' AND purchase_fingerprint ~ '^[a-f0-9]{64}$'));
  END IF;
END $$;

-- Correct already recorded incidents as well as future webhooks. Never edit or
-- erase earlier ledger entries. Negative balances represent spent refunded Tinta.
-- A closed liability remains a real loss; only funds_restored releases exposure.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM payment_incidents i JOIN wallet_orders w ON w.payment_ref = i.payment_ref
    WHERE i.resolution <> 'funds_restored' AND i.currency <> 'mxn') THEN
    RAISE EXCEPTION 'Una incidencia de Tinta usa otra moneda: requiere conciliación antes de migrar';
  END IF;
END $$;
WITH exposure AS (
  SELECT w.id, w.user_id, w.amount, w.amount_cents,
    LEAST(w.amount_cents, COALESCE(SUM(i.amount_cents) FILTER (WHERE i.resolution <> 'funds_restored'), 0))::bigint AS cents
  FROM wallet_orders w JOIN payment_incidents i ON i.payment_ref = w.payment_ref
  WHERE w.provider = 'stripe' AND w.paid_at IS NOT NULL AND w.amount_cents > 0
  GROUP BY w.id
), target AS (
  SELECT e.*, ((e.amount::bigint * e.cents + e.amount_cents - 1) / e.amount_cents)::integer AS units
  FROM exposure e
), adjustments AS (
  SELECT t.id, t.user_id, -t.units - COALESCE(SUM(l.delta), 0) AS delta,
    -t.cents - COALESCE(SUM(l.cash_backing_cents), 0) AS backing
  FROM target t LEFT JOIN wallet_ledger l ON l.ref_type = 'wallet_order_adjustment' AND l.ref_id = t.id
  GROUP BY t.id, t.user_id, t.units, t.cents
)
INSERT INTO wallet_ledger(user_id, currency, delta, reason, ref_type, ref_id, cash_backing_cents)
SELECT user_id, 'tinta', delta, 'payment_adjustment', 'wallet_order_adjustment', id, backing
FROM adjustments WHERE delta <> 0 OR backing <> 0;

-- Rebuild affected order states, including incidents administratively closed as
-- liability_reconciled. A later won dispute cannot erase a separate refund.
UPDATE token_orders o SET status = CASE
  WHEN COALESCE((SELECT SUM(i.amount_cents) FROM payment_incidents i WHERE i.payment_ref = o.payment_ref
    AND i.resolution <> 'funds_restored' AND i.kind = 'refund'), 0) >= o.amount_cents THEN 'refunded'
  WHEN EXISTS (SELECT 1 FROM payment_incidents i WHERE i.payment_ref = o.payment_ref AND i.resolution <> 'funds_restored') THEN 'payment_attention'
  ELSE 'paid' END
WHERE o.provider = 'stripe' AND o.token_id IS NOT NULL AND o.paid_at IS NOT NULL AND o.amount_cents > 0
  AND EXISTS (SELECT 1 FROM payment_incidents i WHERE i.payment_ref = o.payment_ref);
UPDATE wallet_orders w SET status = CASE
  WHEN COALESCE((SELECT SUM(i.amount_cents) FROM payment_incidents i WHERE i.payment_ref = w.payment_ref
    AND i.resolution <> 'funds_restored' AND i.kind = 'refund'), 0) >= w.amount_cents THEN 'refunded'
  WHEN EXISTS (SELECT 1 FROM payment_incidents i WHERE i.payment_ref = w.payment_ref AND i.resolution <> 'funds_restored') THEN 'payment_attention'
  ELSE 'paid' END
WHERE w.provider = 'stripe' AND w.paid_at IS NOT NULL AND w.amount_cents > 0
  AND EXISTS (SELECT 1 FROM payment_incidents i WHERE i.payment_ref = w.payment_ref);
UPDATE book_tokens t SET license_status = CASE o.status
  WHEN 'refunded' THEN 'revoked' WHEN 'payment_attention' THEN 'suspended' ELSE 'active' END
FROM token_orders o WHERE o.token_id = t.id;
UPDATE author_earnings e SET payout_eligible = false,
  status = CASE WHEN e.status = 'accrued' THEN 'reversed' ELSE e.status END
FROM token_orders o WHERE e.order_id = o.id AND o.status IN ('refunded', 'payment_attention');
UPDATE author_payouts p SET status = 'attention', failure_code = 'historical_payment_incident', updated_at = now()
WHERE EXISTS (SELECT 1 FROM author_earnings e JOIN token_orders o ON o.id = e.order_id
  WHERE e.payout_id = p.id AND o.status IN ('refunded', 'payment_attention'));

-- Preserve all other entitlements, in particular copies already claimed by a
-- third-party reader. Only the affected owner's derived unlock is recalculated.
WITH affected AS (
  SELECT DISTINCT owner_user_id AS user_id, book_id FROM book_tokens WHERE license_status <> 'active'
), entitlement AS (
  SELECT a.*, CASE
    WHEN EXISTS (SELECT 1 FROM book_tokens t WHERE t.owner_user_id = a.user_id AND t.book_id = a.book_id
      AND t.kind = 'support' AND t.license_status = 'active') THEN 'support'
    WHEN EXISTS (SELECT 1 FROM print_copies c JOIN book_tokens t ON t.id = c.token_id
      WHERE c.claimed_by_user_id = a.user_id AND t.book_id = a.book_id
      AND (t.license_status = 'active' OR t.owner_user_id <> a.user_id)) THEN 'claim'
    ELSE NULL END AS source
  FROM affected a
)
DELETE FROM unlocked_books u USING entitlement e WHERE u.user_id = e.user_id AND u.book_id = e.book_id
  AND u.source IN ('support', 'claim') AND e.source IS NULL;
UPDATE unlocked_books u SET source = 'claim'
WHERE u.source = 'support' AND EXISTS (SELECT 1 FROM book_tokens t
  WHERE t.owner_user_id = u.user_id AND t.book_id = u.book_id AND t.license_status <> 'active')
  AND NOT EXISTS (SELECT 1 FROM book_tokens t WHERE t.owner_user_id = u.user_id
    AND t.book_id = u.book_id AND t.kind = 'support' AND t.license_status = 'active');
