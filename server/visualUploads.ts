import { createHash } from "node:crypto"
import express, { type Express, type RequestHandler } from "express"
import { Client } from "@replit/object-storage"
import { createLazyAudioStorage } from "./audioStorage"
import { rateLimit } from "./rateLimit"
import { inspectGlb } from "../shared/validate-glb"
import { MODEL_MAX_BYTES } from "../shared/scene-content"
import { and, eq, sql } from "drizzle-orm"
import { db } from "./db"
import { visualUploads } from "@shared/schema"

export const MODEL_ACCOUNT_QUOTA = 200 * 1024 * 1024
export async function reserveVisualUpload(userId: number, hash: string, bytes: number): Promise<boolean> {
  return db.transaction(async tx => {
    // A global cap also bounds creation across multiple fresh accounts. Keep
    // failed reservations: retrying the same content is safe and quota-neutral.
    await tx.execute(sql`select pg_advisory_xact_lock(72004, 0)`)
    const [prior] = await tx.select().from(visualUploads).where(and(eq(visualUploads.userId, userId), eq(visualUploads.hash, hash)))
    if (prior) return true
    const [usage] = await tx.select({ total: sql<number>`coalesce(sum(${visualUploads.bytes}), 0)`, own: sql<number>`coalesce(sum(${visualUploads.bytes}) filter(where ${visualUploads.userId} = ${userId}), 0)`, count: sql<number>`count(*) filter(where ${visualUploads.userId} = ${userId})` }).from(visualUploads)
    const globalLimit = Math.max(MODEL_ACCOUNT_QUOTA, Math.min(100 * 1024 ** 3, Number(process.env.TLOQUE_MODEL_QUOTA_BYTES) || 2 * 1024 ** 3))
    if (Number(usage.own) + bytes > MODEL_ACCOUNT_QUOTA || Number(usage.count) >= 50 || Number(usage.total) + bytes > globalLimit) return false
    await tx.insert(visualUploads).values({ userId, hash, bytes })
    return true
  })
}

async function finishVisualUpload(userId: number, hash: string) {
  await db.update(visualUploads).set({ status: "ready" }).where(and(eq(visualUploads.userId, userId), eq(visualUploads.hash, hash)))
}

const visualStorage = createLazyAudioStorage(() => {
  const bucketId = process.env.TLOQUE_VISUAL_BUCKET_ID?.trim() || process.env.TLOQUE_AUDIO_BUCKET_ID?.trim()
  return new Client(bucketId ? { bucketId } : undefined)
})
type Dependencies = { storage?: typeof visualStorage; authenticate?: RequestHandler; reserve?: typeof reserveVisualUpload; finish?: typeof finishVisualUpload }
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
      const userId = (req.user as any)?.id
      if (!await (dependencies.reserve ?? reserveVisualUpload)(userId, hash, req.body.length)) return res.status(413).json({ message: "Alcanzaste el límite de modelos: 50 archivos o 200 MB por cuenta, o el almacenamiento total está lleno." })
      client = storage.get()
      const exists = await client.exists(key)
      if (!exists.ok) throw exists.error
      if (!exists.value) { const result = await client.uploadFromBytes(key, req.body, { compress: false }); if (!result.ok) throw result.error }
      await (dependencies.finish ?? finishVisualUpload)(userId, hash)
      return res.status(201).json({ source: `/api/visual/models/${hash}.glb`, ...metadata })
    } catch {
      storage.reset(client)
      return res.status(503).json({ message: "No se pudo guardar el modelo. Revisa la conexión de App Storage e inténtalo de nuevo." })
    }
  })
  app.get("/api/visual/uploads", authenticate, async (req, res) => {
    const assets = await db.select().from(visualUploads).where(eq(visualUploads.userId, (req.user as any).id)).limit(50)
    res.setHeader("Cache-Control", "private, no-store")
    res.json({ assets, usedBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0), limitBytes: MODEL_ACCOUNT_QUOTA, limitFiles: 50 })
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
