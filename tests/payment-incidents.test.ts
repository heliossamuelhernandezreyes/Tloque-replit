import assert from "node:assert/strict"
import test from "node:test"

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:1/tloque_test"

test("Stripe refund y dispute se reducen a incidencias sin PII", async () => {
  const { paymentIncidentFromStripeEvent } = await import("../server/paymentIncidents")
  const refund = paymentIncidentFromStripeEvent({
    id: "evt_refund1",
    type: "charge.refunded",
    created: 1_700_000_000,
    data: { object: {
      id: "ch_refund1", payment_intent: "pi_payment1", amount_refunded: 1250,
      currency: "mxn", refunded: true, billing_details: { email: "never-store@example.com" },
    } },
  })
  assert.deepEqual(refund, {
    eventId: "evt_refund1", objectId: "ch_refund1", kind: "refund",
    paymentRef: "pi_payment1", amountCents: 1250, currency: "mxn",
    providerStatus: "refunded", reason: "customer_refund",
    occurredAt: new Date(1_700_000_000_000), fundsRestored: false,
  })
  assert.equal(JSON.stringify(refund).includes("never-store"), false)

  const won = paymentIncidentFromStripeEvent({
    id: "evt_dispute1", type: "charge.dispute.closed",
    data: { object: {
      id: "du_dispute1", payment_intent: "pi_payment1", amount: 1250,
      currency: "mxn", status: "won", reason: "fraudulent",
    } },
  })
  assert.equal(won?.kind, "dispute")
  assert.equal(won?.fundsRestored, true)
  assert.equal(paymentIncidentFromStripeEvent({ id: "evt_x", type: "customer.updated" }), null)
})

test("la migración congela liquidaciones ante incidencias abiertas", async () => {
  const { readFile } = await import("node:fs/promises")
  const [migration, payouts] = await Promise.all([
    readFile("migrations/0016_payment_incidents.sql", "utf8"),
    readFile("server/payouts.ts", "utf8"),
  ])
  assert.match(migration, /payment_incidents/i)
  assert.match(migration, /author_earnings_status_valid/i)
  assert.match(payouts, /hasOpenPaymentIncidents/)
})
