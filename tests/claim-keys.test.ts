import assert from "node:assert/strict"
import test from "node:test"
import {
  assertClaimKeyConfiguration,
  isProtectedClaimKey,
  normalizeClaimKey,
  protectClaimKey,
  revealClaimKey,
  verifyClaimKey,
} from "../server/claimKeys"

test("las claves nuevas se cifran y verifican sin guardar el secreto", () => {
  const previous = process.env.CLAIM_KEY_SECRET
  process.env.CLAIM_KEY_SECRET = "claim-key-test-secret-with-more-than-32-characters"
  try {
    const protectedKey = protectClaimKey("ABCD-EFGH")
    assert.equal(isProtectedClaimKey(protectedKey.ciphertext), true)
    assert.equal(protectedKey.ciphertext.includes("ABCD"), false)
    assert.match(protectedKey.digest, /^[a-f0-9]{64}$/)
    assert.equal(revealClaimKey(protectedKey.ciphertext), "ABCD-EFGH")
    assert.equal(verifyClaimKey("abcd efgh", protectedKey.ciphertext, protectedKey.digest), true)
    assert.equal(verifyClaimKey("ABCD-EFGJ", protectedKey.ciphertext, protectedKey.digest), false)
  } finally {
    if (previous === undefined) delete process.env.CLAIM_KEY_SECRET
    else process.env.CLAIM_KEY_SECRET = previous
  }
})

test("las claves históricas siguen siendo verificables durante la migración perezosa", () => {
  const previous = process.env.CLAIM_KEY_SECRET
  process.env.CLAIM_KEY_SECRET = "legacy-claim-key-secret-with-more-than-32-characters"
  try {
    assert.equal(normalizeClaimKey(" abcd-efgh "), "ABCDEFGH")
    assert.equal(revealClaimKey("ABCD-EFGH"), "ABCD-EFGH")
    assert.equal(verifyClaimKey("ABCDEFGH", "ABCD-EFGH"), true)
    assert.equal(verifyClaimKey("ABCDEFGJ", "ABCD-EFGH"), false)
  } finally {
    if (previous === undefined) delete process.env.CLAIM_KEY_SECRET
    else process.env.CLAIM_KEY_SECRET = previous
  }
})

test("producción falla cerrada sin una clave de protección independiente", () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousClaimSecret = process.env.CLAIM_KEY_SECRET
  try {
    process.env.NODE_ENV = "production"
    delete process.env.CLAIM_KEY_SECRET
    assert.throws(() => assertClaimKeyConfiguration(), /CLAIM_KEY_SECRET/)
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
    if (previousClaimSecret === undefined) delete process.env.CLAIM_KEY_SECRET
    else process.env.CLAIM_KEY_SECRET = previousClaimSecret
  }
})
