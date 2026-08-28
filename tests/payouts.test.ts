import test from "node:test"
import assert from "node:assert/strict"
import { tintaBackingForDebit } from "../server/economy"

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/tloque_test"

test("la Tinta nunca atribuye más efectivo que el disponible o su valor nominal", () => {
  assert.equal(tintaBackingForDebit(4_900, 5), 1_000)
  assert.equal(tintaBackingForDebit(730, 5), 730)
  assert.equal(tintaBackingForDebit(0, 5), 0)
  assert.equal(tintaBackingForDebit(-20, 5), 0)
  assert.equal(tintaBackingForDebit(10_000, 0), 0)
})

test("una cuenta de liquidación exige verificación, payouts y transferencias activas", async () => {
  const { payoutAccountReady, payoutAccountSnapshot } = await import("../server/payouts")
  const ready = {
    id: "acct_test",
    country: "mx",
    default_currency: "mxn",
    details_submitted: true,
    payouts_enabled: true,
    capabilities: { transfers: "active" },
    requirements: { currently_due: [], disabled_reason: null },
  }
  assert.equal(payoutAccountReady(ready), true)
  assert.equal(payoutAccountReady({ ...ready, payouts_enabled: false }), false)
  assert.equal(payoutAccountReady({ ...ready, capabilities: { transfers: "pending" } }), false)
  assert.equal(payoutAccountReady({ ...ready, requirements: { currently_due: [], disabled_reason: "requirements.past_due" } }), false)
  assert.deepEqual(payoutAccountSnapshot(ready), {
    country: "MX",
    currency: "mxn",
    detailsSubmitted: true,
    payoutsEnabled: true,
    transfersActive: true,
    disabledReason: "",
    requirementsDue: [],
  })
})

test("las liquidaciones fallan cerradas y acotan espera y mínimo", async () => {
  const { payoutHoldDays, payoutMinimumCents, payoutSystemEnabled } = await import("../server/payouts")
  const previous = { ...process.env }
  try {
    process.env.STRIPE_SECRET_KEY = "sk_test"
    process.env.STRIPE_CONNECT_ENABLED = "true"
    process.env.PAYOUTS_READY = "true"
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET
    assert.equal(payoutSystemEnabled(), false)
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_test"
    assert.equal(payoutSystemEnabled(), true)

    process.env.PAYOUT_HOLD_DAYS = "1"
    process.env.PAYOUT_MIN_CENTS = "10"
    assert.equal(payoutHoldDays(), 7)
    assert.equal(payoutMinimumCents(), 1_000)
    process.env.PAYOUT_HOLD_DAYS = "999"
    process.env.PAYOUT_MIN_CENTS = "999999999"
    assert.equal(payoutHoldDays(), 180)
    assert.equal(payoutMinimumCents(), 10_000_000)
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    for (const [key, value] of Object.entries(previous)) process.env[key] = value
  }
})

test("la migración de liquidaciones conserva trazabilidad y exclusión histórica de Tinta", async () => {
  const { readFile } = await import("node:fs/promises")
  const sql = await readFile(new URL("../migrations/0013_author_payouts.sql", import.meta.url), "utf8")
  for (const contract of [
    /cash_backing_cents/i,
    /CREATE TABLE IF NOT EXISTS author_payout_accounts/i,
    /CREATE TABLE IF NOT EXISTS author_payouts/i,
    /payout_eligible = true[\s\S]*o\.provider = 'stripe'/i,
    /author_payouts_one_active_idx/i,
    /wallet_ledger_tinta_refund_once_idx/i,
  ]) assert.match(sql, contract)
})
