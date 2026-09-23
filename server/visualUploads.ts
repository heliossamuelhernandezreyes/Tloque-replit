import { createHash } from "node:crypto"
import express, { type Express, type RequestHandler } from "express"
import { Client } from "@replit/object-storage"
import { createLazyAudioStorage } from "./audioStorage"
import { rateLimit } from "./rateLimit"
import { inspectGlb } from "../shared/validate-glb"
import { MODEL_MAX_BYTES } from "../shared/scene-content"

const visualStorage = createLazyAudioStorage(() => {
  const bucketId = process.env.TLOQUE_VISUAL_BUCKET_ID?.trim() || process.env.TLOQUE_AUDIO_BUCKET_ID?.trim()
  return new Client(bucketId ? { bucketId } : undefined)
})
type Dependencies = { storage?: typeof visualStorage; authenticate?: RequestHandler }
export function registerVisualUploadRoutes(app: Express, dependencies: Dependencies = {}) {
  const storage = dependencies.storage ?? visualStorage
  const authenticate: RequestHandler = dependencies.authenticate ?? ((req, res, next) => req.isAuthenticated() ? next() : void res.status(401).json({ message: "Inicia sesión para importar modelos." }))
  app.post("/api/visual/models", authenticate, rateLimit(60_000, 4), express.raw({ type: ["model/gltf-binary", "application/octet-stream"], limit: MODEL_MAX_BYTES }), async (req, res) => {
    if (!Buffer.isBuffer(req.body)) return res.status(415).json({ message: "Selecciona un archivo GLB." })
    let metadata
    try { metadata = inspectGlb(req.body) } catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : "GLB no válido." }) }
    const hash = createHash("sha256").update(req.body).digest("hex"), key = `visual/models/${hash}.glb`
    let client: Client | undefined
    try {
      client = storage.get()
      const exists = await client.exists(key)
      if (!exists.ok) throw exists.error
      if (!exists.value) { const result = await client.uploadFromBytes(key, req.body, { compress: false }); if (!result.ok) throw result.error }
      return res.status(201).json({ source: `/api/visual/models/${hash}.glb`, ...metadata })
    } catch {
      storage.reset(client)
      return res.status(503).json({ message: "No se pudo guardar el modelo. Revisa la conexión de App Storage e inténtalo de nuevo." })
    }
  })
  app.get("/api/visual/models/:file", async (req, res) => {
    const file = String(req.params.file)
    if (!/^[a-f0-9]{64}\.glb$/.test(file)) return res.status(404).end()
    let client: Client | undefined
    try {
      client = storage.get()
      const stream = client.downloadAsStream(`visual/models/${file}`, { decompress: false })
      res.set({ "Content-Type": "model/gltf-binary", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" })
      stream.once("error", () => { storage.reset(client); if (!res.headersSent) { res.set("Cache-Control", "no-store"); res.status(404).end() } else res.destroy() })
      res.on("close", () => stream.destroy())
      stream.pipe(res)
    } catch { storage.reset(client); res.status(503).end() }
  })
}
