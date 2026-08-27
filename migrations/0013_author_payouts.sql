-- Liquidaciones verificables: respaldo real de Tinta, Stripe Connect y
-- reserva inmutable de ganancias antes de transferir.

ALTER TABLE wallet_ledger
  ADD COLUMN IF NOT EXISTS cash_backing_cents integer NOT NULL DEFAULT 0;

ALTER TABLE token_orders
  ADD COLUMN IF NOT EXISTS cash_backing_cents integer NOT NULL DEFAULT 0;

-- Solo el efectivo confirmado por Stripe entra al respaldo histórico. Los
-- créditos beta, regalos y ganancias antiguas de Tinta permanecen en cero.
UPDATE wallet_ledger l
SET cash_backing_cents = o.amount_cents
FROM wallet_orders o
WHERE l.ref_type = 'wallet_order'
  AND l.reason = 'purchase'
  AND l.ref_id = o.id
  AND o.provider = 'stripe'
  AND o.status = 'paid'
  AND l.cash_backing_cents = 0;

UPDATE token_orders
SET cash_backing_cents = amount_cents
WHERE provider = 'stripe'
  AND status = 'paid'
  AND amount_cents > 0
  AND cash_backing_cents = 0;

ALTER TABLE token_orders
  DROP CONSTRAINT IF EXISTS token_orders_cash_backing_range;
ALTER TABLE token_orders
  ADD CONSTRAINT token_orders_cash_backing_range
  CHECK (cash_backing_cents >= 0 AND cash_backing_cents <= amount_cents);

CREATE TABLE IF NOT EXISTS author_payout_accounts (
  user_id integer PRIMARY KEY REFERENCES users(id),
  provider text NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
  provider_account_id text NOT NULL UNIQUE,
  country text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'mxn',
  details_submitted boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  transfers_active boolean NOT NULL DEFAULT false,
  disabled_reason text NOT NULL DEFAULT '',
  requirements_due jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_synced_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT author_payout_accounts_requirements_array
    CHECK (jsonb_typeof(requirements_due) = 'array')
);

CREATE TABLE IF NOT EXISTS author_payouts (
  id serial PRIMARY KEY,
  author_user_id integer NOT NULL REFERENCES users(id),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'mxn' CHECK (currency = 'mxn'),
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN (
      'requested', 'processing', 'processing_unknown', 'transferred',
      'failed', 'rejected', 'reversed', 'attention'
    )),
  provider text NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
  provider_ref text NOT NULL DEFAULT '',
  failure_code text NOT NULL DEFAULT '',
  admin_user_id integer REFERENCES users(id),
  requested_at timestamp NOT NULL DEFAULT now(),
  processed_at timestamp,
  completed_at timestamp,
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE author_earnings
  ADD COLUMN IF NOT EXISTS payout_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payout_id integer REFERENCES author_payouts(id);

-- Las ganancias históricas solo son liquidables cuando provinieron de un
-- cobro directo confirmado. Las operaciones antiguas con Tinta carecen de
-- trazabilidad de respaldo y se conservan fuera de retiros automáticos.
UPDATE author_earnings e
SET payout_eligible = true
FROM token_orders o
WHERE e.order_id = o.id
  AND o.provider = 'stripe'
  AND o.status = 'paid'
  AND o.cash_backing_cents > 0;

ALTER TABLE author_earnings
  DROP CONSTRAINT IF EXISTS author_earnings_status_valid;
ALTER TABLE author_earnings
  ADD CONSTRAINT author_earnings_status_valid
  CHECK (status IN ('accrued', 'reserved', 'paid_out'));

CREATE UNIQUE INDEX IF NOT EXISTS author_payouts_one_active_idx
  ON author_payouts(author_user_id)
  WHERE status IN ('requested', 'processing', 'processing_unknown');

CREATE INDEX IF NOT EXISTS author_payouts_status_requested_idx
  ON author_payouts(status, requested_at);

CREATE INDEX IF NOT EXISTS author_earnings_payout_ready_idx
  ON author_earnings(author_user_id, created_at)
  WHERE status = 'accrued' AND payout_eligible = true;

CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_tinta_refund_once_idx
  ON wallet_ledger(ref_id)
  WHERE currency = 'tinta' AND reason = 'refund'
    AND ref_type = 'wallet_debit' AND ref_id IS NOT NULL;
