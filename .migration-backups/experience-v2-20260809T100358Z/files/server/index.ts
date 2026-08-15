import express, { type Request, Response, NextFunction } from "express"
import { registerRoutes } from "./routes"
import { serveStatic } from "./static"
import { createServer } from "http"
import { setupAuth, setupAuthRoutes, ensureFounderAdmin } from "./auth"

const app        = express()
const httpServer = createServer(app)

declare module "http" {
  interface IncomingMessage { rawBody: unknown }
}

app.use(express.json({
  limit: "25mb",   // Los libros (clásicos) + portadas en base64 son grandes
  verify: (req, _res, buf) => { req.rawBody = buf }
}))
app.use(express.urlencoded({ extended: false, limit: "25mb" }))

// Auth — debe ir antes de las rutas
setupAuth(app)
setupAuthRoutes(app)

export function log(message: string, source = "express") {
  const t = new Date().toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true
  })
  console.log(`${t} [${source}] ${message}`)
}

app.use((req, res, next) => {
  const start = Date.now()
  const path  = req.path
  let captured: Record<string, any> | undefined

  const orig = res.json
  res.json = function (body, ...args) {
    captured = body
    return orig.apply(res, [body, ...args])
  }

  res.on("finish", () => {
    if (path.startsWith("/api")) {
      let line = `${req.method} ${path} ${res.statusCode} in ${Date.now() - start}ms`
      if (captured) line += ` :: ${JSON.stringify(captured)}`
      log(line)
    }
  })
  next()
})

;(async () => {
  // Asegurar que el admin fundador esté en la BD
  await ensureFounderAdmin()

  await registerRoutes(httpServer, app)

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status  = err.status || err.statusCode || 500
    const message = err.message || "Internal Server Error"
    console.error("Internal Server Error:", err)
    if (res.headersSent) return next(err)
    return res.status(status).json({ message })
  })

  if (process.env.NODE_ENV === "production") {
    serveStatic(app)
  } else {
    const { setupVite } = await import("./vite")
    await setupVite(httpServer, app)
  }

  const port = parseInt(process.env.PORT || "5000", 10)
  httpServer.listen({ port, host: "0.0.0.0", reusePort: true }, () => {
    log(`serving on port ${port}`)
  })
})()
