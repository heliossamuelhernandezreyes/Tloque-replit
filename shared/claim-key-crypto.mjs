import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"

const VERSION = "ck1"
const ENCRYPTION_CONTEXT = "tloque-claim-key-encryption-v1"
const HMAC_CONTEXT = "tloque-claim-key-hmac-v1"

function secretMaterial() {
  const explicit = String(process.env.CLAIM_KEY_SECRET || "")
  if (explicit.length >= 32) return explicit
  if (process.env.NODE_ENV === "production") {
    throw new Error("CLAIM_KEY_SECRET must contain at least 32 characters in production")
  }
  const sessionSecret = String(process.env.SESSION_SECRET || "")
  if (sessionSecret.length >= 32) return sessionSecret
  return "tloque-development-only-claim-key-secret"
}

export function assertClaimKeyConfiguration() {
  void secretMaterial()
}

function deriveKey(context) {
  return createHash("sha256").update(context).update("\0").update(secretMaterial()).digest()
}

export function normalizeClaimKey(value) {
  return String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "")
}

function keyDigest(value) {
  return createHmac("sha256", deriveKey(HMAC_CONTEXT)).update(normalizeClaimKey(value)).digest("hex")
}

function sameHex(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false
  const leftBuffer = Buffer.from(left, "hex")
  const rightBuffer = Buffer.from(right, "hex")
  return timingSafeEqual(leftBuffer, rightBuffer)
}

export function isProtectedClaimKey(value) {
  return String(value || "").startsWith(`${VERSION}.`)
}

export function protectClaimKey(plainKey) {
  const normalized = normalizeClaimKey(plainKey)
  if (!/^[A-Z2-9]{8}$/.test(normalized)) throw new Error("Clave de reclamación inválida")
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", deriveKey(ENCRYPTION_CONTEXT), iv)
  cipher.setAAD(Buffer.from(VERSION, "utf8"))
  const encrypted = Buffer.concat([cipher.update(plainKey, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    ciphertext: [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join("."),
    digest: keyDigest(normalized),
  }
}

export function revealClaimKey(stored) {
  if (!isProtectedClaimKey(stored)) return stored
  const [version, ivEncoded, tagEncoded, ciphertextEncoded, ...extra] = stored.split(".")
  if (version !== VERSION || extra.length || !ivEncoded || !tagEncoded || !ciphertextEncoded) {
    throw new Error("Clave de reclamación protegida inválida")
  }
  const iv = Buffer.from(ivEncoded, "base64url")
  const tag = Buffer.from(tagEncoded, "base64url")
  const ciphertext = Buffer.from(ciphertextEncoded, "base64url")
  if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) {
    throw new Error("Clave de reclamación protegida inválida")
  }
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(ENCRYPTION_CONTEXT), iv)
  decipher.setAAD(Buffer.from(VERSION, "utf8"))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
}

export function verifyClaimKey(candidate, stored, storedDigest = "") {
  const candidateDigest = keyDigest(candidate)
  if (/^[a-f0-9]{64}$/.test(storedDigest)) return sameHex(candidateDigest, storedDigest)
  if (isProtectedClaimKey(stored)) {
    try {
      return sameHex(candidateDigest, keyDigest(revealClaimKey(stored)))
    } catch {
      return false
    }
  }
  return sameHex(candidateDigest, keyDigest(stored))
}
