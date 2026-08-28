import type { Request, Response, NextFunction } from "express"
import { createHash } from "crypto"

const store = new Map<string, { count: number; resetAt: number }>()
let requestsSinceSweep = 0

function sweepExpired(now: number) {
  if (++requestsSinceSweep < 500 && store.size < 20_000) return
  requestsSinceSweep = 0
  for (const [key, entry] of store) if (entry.resetAt <= now) store.delete(key)
  // Evita crecimiento sin límite incluso bajo rutas/IPs deliberadamente variables.
  while (store.size > 20_000) store.delete(store.keys().next().value as string)
}

function localDecision(key: string, now: number, windowMs: number, max: number) {
  sweepExpired(now)
  const entry = store.get(key)
  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, resetAt: now + windowMs }
  }
  if (entry.count >= max) return { allowed: false, resetAt: entry.resetAt }
  entry.count += 1
  return { allowed: true, resetAt: entry.resetAt }
}

let distributedFailureLogged = false

async function distributedDecision(key: string, now: number, windowMs: number, max: number) {
  // Importación perezosa: utilidades y pruebas que sólo necesitan construir el
  // middleware no deben exigir DATABASE_URL durante la carga del módulo.
  const { pool } = await import("./db")
  const windowStart = Math.floor(now / windowMs) * windowMs
  const expiresAt = new Date(windowStart + windowMs)
  const bucketKey = createHash("sha256").update(key).digest("base64url")
  const result = await pool.query<{ request_count: number }>(`
    INSERT INTO api_rate_limits (bucket_key, window_start, request_count, expires_at)
    VALUES ($1, $2, 1, $3)
    ON CONFLICT (bucket_key, window_start)
    DO UPDATE SET request_count = api_rate_limits.request_count + 1
    RETURNING request_count
  `, [bucketKey, windowStart, expiresAt])
  if (++requestsSinceSweep % 500 === 0) {
    void pool.query("DELETE FROM api_rate_limits WHERE expires_at < now() - interval '1 minute'")
      .catch(() => undefined)
  }
  return {
    allowed: Number(result.rows[0]?.request_count || 0) <= max,
    resetAt: windowStart + windowMs,
  }
}

export function rateLimit(windowMs: number, max: number, scope?: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    const route = scope || (typeof req.route?.path === "string" ? req.route.path : req.path)
    // Separar cuentas detrás de la misma red evita que una persona agote el
    // cupo de todos los usuarios de una escuela/café. La IP sigue formando
    // parte de la clave para que una cuenta distribuida no ignore el límite.
    const userId = req.isAuthenticated?.() ? (req.user as any)?.id : null
    const key = (req.ip ?? "unknown") + ":" + (userId ?? "anon") + ":" + req.method + ":" + route
    let decision: { allowed: boolean; resetAt: number }
    if (!process.env.DATABASE_URL) {
      decision = localDecision(key, now, windowMs, max)
    } else try {
      decision = await distributedDecision(key, now, windowMs, max)
      distributedFailureLogged = false
    } catch (error) {
      // La aplicación sigue disponible si PostgreSQL está arrancando, pero la
      // degradación queda visible y conserva un límite local de emergencia.
      decision = localDecision(key, now, windowMs, max)
      if (!distributedFailureLogged) {
        distributedFailureLogged = true
        console.error("Distributed rate limit unavailable; using process fallback", error)
      }
    }

    if (!decision.allowed) {
      const retryAfter = Math.max(1, Math.ceil((decision.resetAt - now) / 1000))
      res.setHeader("Retry-After", String(retryAfter))
      return res.status(429).json({ message: "Demasiadas solicitudes. Intenta más tarde." })
    }
    next()
  }
}
