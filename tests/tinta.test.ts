import test from "node:test"
import assert from "node:assert/strict"
import { displayTinta, emptyFunding, negateFunding, paidFunding, planTintaDebit } from "../shared/tinta.ts"
import { economicQuote, settlementWindow } from "../shared/commerce.ts"

const terms = { bookId: 1, workHash: "a".repeat(64), agreementId: 2, agreementHash: "b".repeat(64),
  kind: "support" as const, provider: "tinta" as const, currency: "mxn" as const,
  units: 10, nominalCents: 2000, authorShareBps: 9000, holdDays: 30, minimumCents: 10000, availableBackingCents: 0 }

test("2,000 Tintas / $200 fund ten full $18 author royalties and consume exactly $200", () => {
  let state = paidFunding(100, 20000), royalties = 0, platform = 0
  assert.equal(displayTinta(100), 2000)
  for (let i = 0; i < 10; i++) {
    const quote = economicQuote({ ...terms, walletFunding: state })
    assert.equal(quote.cashBasisCents, 2000); assert.equal(quote.authorCents, 1800)
    const spend = quote.tintaFunding!
    royalties += quote.authorCents; platform += quote.platformCents
    state = { ...state, paidUnits: state.paidUnits - spend.paidUnits, paidCents: state.paidCents - spend.paidCents }
  }
  assert.deepEqual(state, emptyFunding()); assert.equal(royalties, 18000); assert.equal(platform, 2000)
})

test("the small-package premium belongs to Tloque and never strands cash after the final spend", () => {
  const quote = economicQuote({ ...terms, walletFunding: paidFunding(10, 3000) })
  assert.equal(quote.authorCents, 1800); assert.equal(quote.platformCents, 1200)
  assert.equal(quote.royaltyBaseCents, 2000); assert.equal(quote.cashBasisCents, 3000)
  const first = planTintaDebit(paidFunding(3, 1001), 1)!
  const second = planTintaDebit(paidFunding(2, 1001 - first.paidCents), 1)!
  const last = planTintaDebit(paidFunding(1, 1001 - first.paidCents - second.paidCents), 1)!
  assert.equal(first.paidCents + second.paidCents + last.paidCents, 1001)
})

test("mixed credits preserve the legacy cash-first rule and an exact reversible funding record", () => {
  const state = { legacyUnits: 10, legacyCents: 730, paidUnits: 5, paidCents: 1500 }
  const quote = economicQuote({ ...terms, walletFunding: state })
  assert.deepEqual(quote.tintaFunding, { legacyUnits: 5, legacyCents: 730, paidUnits: 5, paidCents: 1500 })
  assert.equal(quote.cashBasisCents, 2230); assert.equal(quote.authorCents, 1557)
  const debit = negateFunding(quote.tintaFunding!)
  assert.deepEqual(negateFunding(debit), quote.tintaFunding)
  assert.equal(planTintaDebit({ ...emptyFunding(), legacyUnits: -1, paidUnits: 10, paidCents: 3000 }, 10), null)
  assert.equal(planTintaDebit(emptyFunding(), 1), null)
})

test("new unsupported credits cannot silently pay a reduced royalty; historical windows remain frozen", () => {
  assert.throws(() => economicQuote({ ...terms, walletFunding: paidFunding(10, 1000) }), /conciliación/)
  const window = settlementWindow("2026-01-01", { version: "2026-11-01.1", holdDays: 37, minimumCents: 15000 }, { holdDays: 180, minimumCents: 999999 })
  assert.equal(window.holdDays, 37); assert.equal(window.minimumCents, 15000)
})

test("direct patronage and commercial licences use their own accepted price and split", () => {
  const direct = economicQuote({ ...terms, provider: "stripe", nominalCents: 3500, authorShareBps: 5000 })
  assert.equal(direct.authorCents, 1750); assert.equal(direct.platformCents, 1750)
  const licence = economicQuote({ ...terms, kind: "sale", units: 12, nominalCents: 2400, authorShareBps: 7500, walletFunding: paidFunding(100, 20000) })
  assert.equal(licence.authorCents, 1800); assert.equal(licence.platformCents, 600)
})


test("a recharge after a premium-package chargeback pays the fixed royalty whenever remaining cash covers it", () => {
  // A spent 200-Tinta/$30 recharge was refunded, then 2,000/$200 were bought.
  const state=paidFunding(90,17000)
  const quote=economicQuote({...terms,walletFunding:state})
  assert.equal(quote.authorCents,1800)
  assert.equal(quote.cashBasisCents,1888)
  assert.equal(quote.platformCents,88)
  assert.throws(()=>economicQuote({...terms,walletFunding:paidFunding(90,15000)}),/conciliación/)
})
