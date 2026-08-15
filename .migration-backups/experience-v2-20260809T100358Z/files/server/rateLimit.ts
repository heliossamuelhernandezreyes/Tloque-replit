import type { Request, Response, NextFunction } from "express"

const store = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(windowMs: number, max: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = (req.ip ?? "unknown") + ":" + req.path
    const now = Date.now()
    const entry = store.get(key)

    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }

    if (entry.count >= max) {
      return res.status(429).json({ message: "Demasiadas solicitudes. Intenta más tarde." })
    }

    entry.count++
    next()
  }
}
