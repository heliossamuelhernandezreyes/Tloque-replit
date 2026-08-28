export function assertClaimKeyConfiguration(): void
export function normalizeClaimKey(value: unknown): string
export function isProtectedClaimKey(value: unknown): boolean
export function protectClaimKey(plainKey: string): { ciphertext: string; digest: string }
export function revealClaimKey(stored: string): string
export function verifyClaimKey(candidate: unknown, stored: string, storedDigest?: string): boolean
