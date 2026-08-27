-- Trazabilidad de reembolsos y contracargos para el flujo de cargos separados
-- y transferencias. Una incidencia abierta bloquea nuevas transferencias hasta
-- que administración documente la conciliación.

ALTER TABLE token_orders
  ADD COLUMN IF NOT EXISTS payment_ref text NOT NULL DEFAULT '';
ALTER TABLE wallet_orders
  ADD COLUMN IF NOT EXISTS payment_ref text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS payment_incidents (
  id serial PRIMARY KEY,
  provider_event_id text NOT NULL UNIQUE,
  provider_object_id text NOT NULL UNIQUE,
  kind text NOT NULL,
  payment_ref text NOT NULL DEFAULT '',
  token_order_id integer REFERENCES token_orders(id),
  wallet_order_id integer REFERENCES wallet_orders(id),
  amount_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'mxn',
  provider_status text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  resolution text NOT NULL DEFAULT 'open',
  resolution_note text NOT NULL DEFAULT '',
  admin_user_id integer REFERENCES users(id),
  occurred_at timestamp NOT NULL DEFAULT now(),
  resolved_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT payment_incidents_contract_check CHECK (
    kind IN ('refund', 'dispute')
    AND amount_cents >= 0
    AND resolution IN ('open', 'funds_restored', 'liability_reconciled')
  )
);

ALTER TABLE author_earnings DROP CONSTRAINT IF EXISTS author_earnings_status_valid;
ALTER TABLE author_earnings ADD CONSTRAINT author_earnings_status_valid
  CHECK (status IN ('accrued', 'reserved', 'paid_out', 'reversed'));

CREATE UNIQUE INDEX IF NOT EXISTS token_orders_payment_ref_idx
  ON token_orders(payment_ref) WHERE payment_ref <> '';
CREATE UNIQUE INDEX IF NOT EXISTS wallet_orders_payment_ref_idx
  ON wallet_orders(payment_ref) WHERE payment_ref <> '';
CREATE INDEX IF NOT EXISTS payment_incidents_resolution_created_idx
  ON payment_incidents(resolution, created_at);
