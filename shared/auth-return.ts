/** Only application destinations may survive an OAuth round trip. Never API URLs. */
export function safeAuthReturn(value: unknown): string {
  if (typeof value !== "string" || value.length > 2000 || !value.startsWith("/")
      || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|5c|2f)/i.test(value)) return "/"
  try {
    const url = new URL(value, "https://tloque.invalid")
    if (url.origin !== "https://tloque.invalid" || !/^\/(?:$|library(?:\?|$)|profile(?:\?|$)|inbox$|editions$|book\/\d+$|read\/[^/]+\/\d+$|claim\/[a-z0-9-]+$|editor(?:\/direction)?$|tarjetas(?:\/\d+)?$|marcos$|admin(?:\/[a-z0-9/-]+)?$)/i.test(url.pathname)) return "/"
    // Claim secrets live only in the originating tab, never in OAuth parameters.
    url.searchParams.delete("key")
    return url.pathname + url.search + (/^\/claim\//i.test(url.pathname) ? "" : url.hash)
  } catch { return "/" }
}

export const AUTH_RETURN_TTL = 15 * 60 * 1000

