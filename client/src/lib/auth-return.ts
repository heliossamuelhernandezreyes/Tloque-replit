import { AUTH_RETURN_TTL, safeAuthReturn } from "@shared/auth-return"

const KEY = "tloque_login_return_v1"
type Pending = { path: string; key: string; expires: number }
function pending(): Pending | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || "null")
    if (value && typeof value.path === "string" && typeof value.key === "string" && value.expires > Date.now()) return value
    sessionStorage.removeItem(KEY)
  } catch { /* The app also supports browsers without session storage. */ }
  return null
}
export function loginReturnPath(): string {
  const url = new URL(window.location.href)
  const path = safeAuthReturn(url.pathname + url.search + url.hash)
  const old = pending()
  const claim = /^\/claim\//i.test(url.pathname)
  const key = claim ? new URLSearchParams(url.hash.slice(1)).get("key") || url.searchParams.get("key") || "" : ""
  const value = { path, key: key.length <= 256 ? key : "", expires: Date.now() + AUTH_RETURN_TTL }
  // A failed login can be retried from the login screen without losing its destination.
  const target = path === "/?auth=error" && old ? old : value
  try { sessionStorage.setItem(KEY, JSON.stringify(target)) } catch { /* no secret in OAuth URL */ }
  if (claim && key) window.history.replaceState(null, "", path)
  return target.path
}
export function loginClaimKey(folio: string): string {
  const value = pending()
  if (!value || new URL(value.path, window.location.origin).pathname.toUpperCase() !== `/CLAIM/${folio.toUpperCase()}`) return ""
  return value.key
}
export function clearLoginClaimKey(folio: string): void {
  if (!loginClaimKey(folio)) return
  try { sessionStorage.removeItem(KEY) } catch { /* best effort */ }
}
