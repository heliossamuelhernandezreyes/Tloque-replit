import assert from "node:assert/strict"
import test from "node:test"
import { paymentExposure, withheldTinta } from "../shared/payment-reconciliation"

const refund = (amountCents: number, resolution = "open") => ({
  kind: "refund", amountCents, resolution, currency: "mxn", providerStatus: "partially_refunded",
})

test("refund rounding preserves full-pack bounds and cumulative rather than per-event rounding", () => {
  assert.equal(withheldTinta(25, 4900, 0), 0)
  assert.equal(withheldTinta(25, 4900, 1), 1)
  assert.equal(withheldTinta(25, 4900, 2450), 13)
  assert.equal(withheldTinta(25, 4900, 4900), 25)
  assert.equal(withheldTinta(25, 4900, 9999), 25)
  for (const [units, price] of [[25, 4900], [55, 9900], [120, 19900]]) {
    let previous = 0, debited = 0
    for (let cents = 1; cents <= price; cents++) {
      const cumulative = withheldTinta(units, price, cents)
      assert.ok(cumulative >= previous && cumulative <= units)
      debited += cumulative - previous
      previous = cumulative
    }
    assert.equal(debited, units)
  }
})

test("resolving liability does not manufacture money or reactivate a refunded licence", () => {
  assert.deepEqual(paymentExposure([refund(4900, "liability_reconciled")], 4900, "mxn"), {
    withheldCents: 4900, status: "refunded", licenseStatus: "revoked",
  })
  assert.equal(paymentExposure([refund(2450)], 4900, "mxn").licenseStatus, "suspended")
  assert.deepEqual(paymentExposure([refund(4900, "funds_restored")], 4900, "mxn"), {
    withheldCents: 0, status: "paid", licenseStatus: "active",
  })
})

test("a won dispute restores only its portion; overlapping losses never exceed the payment", () => {
  const dispute = { ...refund(4900), kind: "dispute", providerStatus: "needs_response" }
  assert.equal(paymentExposure([refund(2450), dispute], 4900, "mxn").withheldCents, 4900)
  assert.equal(paymentExposure([refund(2450), { ...dispute, resolution: "funds_restored" }], 4900, "mxn").withheldCents, 2450)
  assert.equal(paymentExposure([refund(4900), { ...dispute, resolution: "funds_restored" }], 4900, "mxn").licenseStatus, "revoked")
  assert.throws(() => paymentExposure([refund(100)], 4900, "usd"))
  assert.throws(() => withheldTinta(25, 0, 100))
  assert.throws(() => withheldTinta(25, 4900, -1))
})
