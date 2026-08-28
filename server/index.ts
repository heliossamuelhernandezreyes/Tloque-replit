import express, { type Request, Response, NextFunction } from "express"
import { registerRoutes } from "./routes"
import { serveStatic } from "./static"
import { createServer } from "http"
import { setupAuth, setupAuthRoutes, ensureFounderAdmin } from "./auth"
import { sameOriginProtection, securityHeaders } from "./security"
import { rateLimit } from "./rateLimit"
import { registerNativeSamplePackRoutes } from "./nativeSamplePackRoutes"
import { randomUUID } from "crypto"
import { pool } from "./db"
import { assertClaimKeyConfiguration } from "./claimKeys"

assertClaimKeyConfiguration()

const app        = express()
const httpServer = createServer(app)
if (process.env.NODE_ENV === "production" || process.env.REPL_ID) app.set("trust proxy", 1)

declare global {
  namespace Express {
    interface Request { rawBody?: Buffer; requestId?: string }
  }
}

let shuttingDown = false

// Las cabeceras también deben acompañar errores tempranos del parser (p. ej.
// un cuerpo que exceda el límite).
app.use(securityHeaders)
app.use((req, res, next) => {
  const incoming = String(req.headers["x-request-id"] || "").trim()
  req.requestId = /^[a-zA-Z0-9._:-]{8,128}$/.test(incoming) ? incoming : randomUUID()
  res.setHeader("X-Request-Id", req.requestId)
  next()
})
// Primera barrera antes de leer JSON o abrir la sesión. Usa una clave común por
// IP para que variar rutas inexistentes no permita evadir el límite.
app.use("/api", rateLimit(60_000, 300, "api-global"))
app.use(express.json({
  limit: "12mb",
  verify: (req, _res, buf) => {
    const incoming = req as any
    if (incoming.originalUrl === "/api/payments/webhook"
        || incoming.originalUrl === "/api/payouts/webhook") {
      incoming.rawBody = Buffer.from(buf)
    }
  }
}))
app.use(express.urlencoded({ extended: false, limit: "1mb" }))

// Auth — debe ir antes de las rutas
setupAuth(app)
app.use(sameOriginProtection)
setupAuthRoutes(app)

export function log(message: string, source = "express") {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", source, message }))
}

app.use((req, res, next) => {
  const start = Date.now()
  const path  = req.path
  const originalJson = res.json.bind(res)
  res.json = ((body: any) => {
    if (res.statusCode >= 500 && !res.locals.publicErrorMessage) {
      return originalJson({ message: "Internal Server Error" })
    }
    return originalJson(body)
  }) as typeof res.json
  res.on("finish", () => {
    if (path.startsWith("/api")) {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: res.statusCode >= 500 ? "error" : "info",
        source: "http",
        requestId: req.requestId,
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: Date.now() - start,
      }))
    }
  })
  next()
})

app.get("/healthz", (_req, res) => {
  res.status(shuttingDown ? 503 : 200).json({ ok: !shuttingDown })
})

app.get("/readyz", async (_req, res) => {
  if (shuttingDown) return res.status(503).json({ ready: false })
  try {
    await pool.query("select 1")
    res.json({ ready: true })
  } catch {
    res.status(503).json({ ready: false })
  }
})

;(async () => {
  // Asegurar que el admin fundador esté en la BD
  await ensureFounderAdmin()

  // Los paquetes nativos tienen un router curado independiente. Se registra
  // antes del router legado de uploads para que cada instrumento conserve su
  // identidad, manifest y procedencia exactos.
  registerNativeSamplePackRoutes(app)
  await registerRoutes(httpServer, app)

  // Una ruta API inexistente nunca debe caer al index.html con estado 200.
  // Además de confundir al cliente, ese fallback ocultaba errores de versión.
  app.all("/api/{*path}", (_req, res) => {
    res.status(404).json({ message: "API route not found" })
  })

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status  = err.status || err.statusCode || 500
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      source: "express",
      requestId: _req.requestId,
      message: "Internal Server Error",
      error: err instanceof Error ? err.message : String(err),
    }))
    if (res.headersSent) return next(err)
    const message = status >= 500 ? "Internal Server Error" : (err.message || "Request failed")
    return res.status(status).json({ message })
  })

  // El Preview de Replit corre sobre una conexión móvil y la gráfica de
  // módulos de Vite supera los dos mil módulos. Servir el bundle ya compilado
  // evita miles de solicitudes individuales sin relajar las validaciones de
  // producción durante el desarrollo.
  const serveBuiltClient = process.env.NODE_ENV === "production"
    || process.env.SERVE_STATIC === "true"
  if (serveBuiltClient) {
    serveStatic(app)
  } else {
    const { setupVite } = await import("./vite")
    await setupVite(httpServer, app)
  }

  const port = Number(process.env.PORT || 5000)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535")
  }
  httpServer.listen({ port, host: "0.0.0.0", reusePort: true }, () => {
    log(`serving on port ${port}`)
  })

  const shutdown = (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    log(`received ${signal}; draining connections`, "shutdown")
    const forced = setTimeout(() => {
      console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "error", source: "shutdown", message: "forced exit after drain timeout" }))
      process.exit(1)
    }, 10_000)
    forced.unref()
    httpServer.close(() => {
      void pool.end().finally(() => {
        clearTimeout(forced)
        process.exit(0)
      })
    })
  }
  process.once("SIGTERM", () => shutdown("SIGTERM"))
  process.once("SIGINT", () => shutdown("SIGINT"))
})().catch(error => {
  console.error("Tloque could not start:", error)
  process.exitCode = 1
})
