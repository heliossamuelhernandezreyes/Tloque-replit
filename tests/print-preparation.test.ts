import assert from "node:assert/strict"
import { test } from "node:test"
import { preparePrintCopy, printCopySummary, PrintPreparationError, type PrintPreparationStore } from "../server/printPreparation"
import { isProtectedClaimKey } from "../server/claimKeys"

test("copy summaries never include private keys, hashes or unrelated row fields", () => {
  const row = { id: 7, folio: "TEST-7", claimedByUserId: null, claimKey: "PRIVATE", claimKeyHash: "PRIVATE-HASH", saleNote: "private-note" }
  assert.deepEqual(printCopySummary(row, 1, true), { id: 7, folio: "TEST-7", canPrint: true, digitalClaimed: false, claimedByOwner: false })
  assert.equal(printCopySummary({ ...row, claimedByUserId: 1 }, 1, false).canPrint, false)
})

test("printing validates ownership and current licence before touching a secret", async () => {
  let owner = 2, status = "active", protections = 0
  const store: PrintPreparationStore = {
    copy: async id => id === 7 ? { id, tokenId: 3, folio: "TEST-7", claimKey: "invalid-encrypted-record", claimKeyHash: "hash" } : undefined,
    token: async () => ({ id: 3, ownerUserId: owner, bookId: 10, licenseStatus: status }),
    protect: async () => { protections++ },
  }
  await assert.rejects(preparePrintCopy(1, 7, store), (e: unknown) => e instanceof PrintPreparationError && e.status === 404)
  owner = 1
  for (const licence of ["suspended", "revoked"]) {
    status = licence
    await assert.rejects(preparePrintCopy(1, 7, store), (e: unknown) => e instanceof PrintPreparationError && e.status === 409)
  }
  await assert.rejects(preparePrintCopy(1, 0, store), (e: unknown) => e instanceof PrintPreparationError && e.status === 400)
  await assert.rejects(preparePrintCopy(1, 8, store), (e: unknown) => e instanceof PrintPreparationError && e.status === 404)
  assert.equal(protections, 0)
})

test("legacy protection and retries preserve one copy and its original key without new purchases", async () => {
  const previous = process.env.CLAIM_KEY_SECRET
  process.env.CLAIM_KEY_SECRET = "print-preparation-tests-independent-secret-32-chars"
  const row = { id: 7, tokenId: 3, folio: "TEST-7", claimKey: "ABCD-EFGH", claimKeyHash: "" }
  let protections = 0
  const store: PrintPreparationStore = {
    copy: async () => row,
    token: async () => ({ id: 3, ownerUserId: 1, bookId: 10, licenseStatus: "active" }),
    protect: async (_, protectedKey) => { row.claimKey = protectedKey.ciphertext; row.claimKeyHash = protectedKey.digest; protections++ },
  }
  try {
    const first = await preparePrintCopy(1, 7, store), retry = await preparePrintCopy(1, 7, store)
    assert.deepEqual(first, { bookId: 10, copy: { folio: "TEST-7", key: "ABCD-EFGH" } })
    assert.equal(retry.copy.folio, first.copy.folio)
    // Protected records use the normalised key; both activate the same copy.
    assert.equal(retry.copy.key.replace(/-/g, ""), first.copy.key.replace(/-/g, ""))
    assert.equal(protections, 1); assert.equal(isProtectedClaimKey(row.claimKey), true)
  } finally {
    if (previous === undefined) delete process.env.CLAIM_KEY_SECRET
    else process.env.CLAIM_KEY_SECRET = previous
  }
})
