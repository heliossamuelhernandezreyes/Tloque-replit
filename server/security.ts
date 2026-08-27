import type { NextFunction, Request, Response } from "express"

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"])

function normalizedOrigin(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    return url.origin
  } catch {
    return null
  }
}

export function configuredPublicOrigin(): string | null {
  const explicit = normalizedOrigin(process.env.APP_URL)
  if (explicit) {
    if (process.env.NODE_ENV === "production" && !explicit.startsWith("https://")) {
      throw new Error("APP_URL must use HTTPS in production")
    }
    return explicit
  }
  const replitDomain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(",")[0]?.trim()
  return replitDomain ? normalizedOrigin(`https://${replitDomain}`) : null
}

export function publicOriginForRequest(req: Request): string {
  const configured = configuredPublicOrigin()
  if (configured) return configured
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_URL must be configured in production")
  }
  const host = req.get("host")
  if (!host || !/^[a-z0-9.:[\]-]+$/i.test(host)) throw new Error("Invalid request host")
  return `${req.protocol}://${host}`
}

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  const isWorkshop = req.path === "/taller-marcos.html"
  const isProduction = process.env.NODE_ENV === "production"

  // Vite y los complementos de desarrollo de Replit inyectan un preámbulo
  // inline antes de cargar React. Bloquearlo hace que @vitejs/plugin-react
  // aborte antes de montar la aplicación y también bloquea el visor de errores:
  // el único síntoma visible termina siendo una pantalla negra. Producción no
  // necesita ese preámbulo y conserva la política estricta.
  //
  // El motor de audio puede cargar módulos WebAssembly. `wasm-unsafe-eval`
  // autoriza únicamente la compilación/instanciación de WASM y evita abrir la
  // política a `unsafe-eval`, que también permitiría evaluación dinámica de JS.
  const scriptPolicy = isWorkshop || !isProduction
    ? "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'"
    : "script-src 'self' 'wasm-unsafe-eval'"
  const connectPolicy = isProduction
    ? "connect-src 'self'"
    : "connect-src 'self' ws: wss: https:"
  const frameAncestors = isWorkshop
    ? "frame-ancestors 'self'"
    : isProduction
      ? "frame-ancestors 'none'"
      : "frame-ancestors 'self' https://replit.com https://*.replit.com"
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    frameAncestors,
    "form-action 'self'",
    scriptPolicy,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    connectPolicy,
    "frame-src 'self'",
    "worker-src 'self' blob:",
  ].join("; "))
  res.setHeader("X-Content-Type-Options", "nosniff")
  // X-Frame-Options no permite declarar replit.com como origen autorizado y
  // prevalecería sobre frame-ancestors en algunos navegadores. En desarrollo
  // dejamos que la CSP limitada controle el Preview; producción sigue en DENY.
  if (isWorkshop) res.setHeader("X-Frame-Options", "SAMEORIGIN")
  else if (isProduction) res.setHeader("X-Frame-Options", "DENY")
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(self)")
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none")
  if (req.secure && isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
  }
  if (req.path.startsWith("/api/auth") || req.path.startsWith("/api/wallet")
      || req.path.startsWith("/api/audiobook") || req.path.startsWith("/api/audiobooks")
      || req.path.startsWith("/api/tokens") || req.path.startsWith("/api/account")
      || req.path.startsWith("/api/payouts")) {
    res.setHeader("Cache-Control", "no-store")
  }
  next()
}

export function sameOriginProtection(req: Request, res: Response, next: NextFunction) {
  if (!STATE_CHANGING.has(req.method)
      || req.path === "/api/payments/webhook"
      || req.path === "/api/payouts/webhook") return next()
  const fetchSite = req.get("sec-fetch-site")
  if (fetchSite === "cross-site") {
    return res.status(403).json({ message: "Origen no permitido" })
  }
  const originHeader = normalizedOrigin(req.get("origin"))
  if (!originHeader) {
    // Los navegadores modernos envían Origin o Sec-Fetch-Site en mutaciones.
    // En producción, una petición autenticada sin ninguno de los dos es
    // indistinguible de un POST de formulario CSRF legado.
    if (process.env.NODE_ENV === "production" && req.isAuthenticated()
        && fetchSite !== "same-origin") {
      return res.status(403).json({ message: "Origen no permitido" })
    }
    return next()
  }

  const configured = configuredPublicOrigin()
  if (configured && originHeader === configured) return next()
  if (process.env.NODE_ENV !== "production") {
    const requestOrigin = normalizedOrigin(`${req.protocol}://${req.get("host") || ""}`)
    if (originHeader === requestOrigin) return next()
  }
  return res.status(403).json({ message: "Origen no permitido" })
}
