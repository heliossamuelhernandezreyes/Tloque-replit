import type { Request, Response, NextFunction } from "express"

const store = new Map<string, { count: number; resetAt: number }>()
let requestsSinceSweep = 0

function sweepExpired(now: number) {
  if (++requestsSinceSweep < 500 && store.size < 20_000) return
  requestsSinceSweep = 0
  for (const [key, entry] of store) if (entry.resetAt <= now) store.delete(key)
  // Evita crecimiento sin límite incluso bajo rutas/IPs deliberadamente variables.
  while (store.size > 20_000) store.delete(store.keys().next().value as string)
}

export function rateLimit(windowMs: number, max: number, scope?: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    sweepExpired(now)
    const route = scope || (typeof req.route?.path === "string" ? req.route.path : req.path)
    // Separar cuentas detrás de la misma red evita que una persona agote el
    // cupo de todos los usuarios de una escuela/café. La IP sigue formando
    // parte de la clave para que una cuenta distribuida no ignore el límite.
    const userId = req.isAuthenticated?.() ? (req.user as any)?.id : null
    const key = (req.ip ?? "unknown") + ":" + (userId ?? "anon") + ":" + req.method + ":" + route
    const entry = store.get(key)

    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }

    if (entry.count >= max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
      res.setHeader("Retry-After", String(retryAfter))
      return res.status(429).json({ message: "Demasiadas solicitudes. Intenta más tarde." })
    }

    entry.count++
    next()
  }
}
