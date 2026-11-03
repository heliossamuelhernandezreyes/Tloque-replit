import test from "node:test"
import assert from "node:assert/strict"
import { safeAuthReturn } from "../shared/auth-return.ts"
import { readingProgress } from "../shared/reading-progress.ts"
import { purchaseState } from "../shared/purchase-state.ts"
import { DEFAULT_PRICES, TINTA_PACKS } from "../shared/pricing.ts"

test("OAuth restores a supported internal destination without carrying claim secrets", () => {
  assert.equal(safeAuthReturn("/book/123#mecenazgo"), "/book/123#mecenazgo")
  assert.equal(safeAuthReturn("/claim/TLQ-ABCD?key=SECRET#key=SECRET"), "/claim/TLQ-ABCD")
  assert.equal(safeAuthReturn("/library?search=Ball"), "/library?search=Ball")
  assert.equal(safeAuthReturn("/read/local-123/2"), "/read/local-123/2")
  for (const unsafe of ["//evil.test", "https://evil.test", "/\\evil.test", "/%2f%2fevil.test", "/api/auth/logout", "/book/1\n", "/book/../api/users", null, ["/profile"]]) assert.equal(safeAuthReturn(unsafe), "/")
})
test("chapter progress uses the actual work length and distinguishes unknown from complete", () => {
  assert.equal(readingProgress(1, 2), 50)
  assert.equal(readingProgress(1, 100), 1)
  assert.equal(readingProgress(1, undefined), null)
  assert.equal(readingProgress(100, 2), 100)
  assert.equal(readingProgress(-1, 2), 0)
  assert.equal(readingProgress(1, undefined, true), 100)
})
test("checkout success requires a paid, delivered order and handles reversals", () => {
  assert.equal(purchaseState(undefined), "pending")
  assert.equal(purchaseState({ status: "paid", tokenId: null }), "pending")
  assert.equal(purchaseState({ status: "paid", tokenId: 123 }), "confirmed")
  assert.equal(purchaseState({ status: "refunded", tokenId: 123 }), "refunded")
  assert.equal(purchaseState({ status: "failed" }), "failed")
})
test("visual fixtures and checkout share all approved offers", () => {
  assert.deepEqual(TINTA_PACKS.map(p => [p.tinta * 20, p.cents]), [[100, 2000], [200, 3000], [400, 5500], [1000, 12000], [2000, 22000]])
  assert.deepEqual(DEFAULT_PRICES.sale, { cents: 3000, currency: "mxn", tinta: 12 })
  assert.equal(DEFAULT_PRICES.support.cents, 3500)
})
