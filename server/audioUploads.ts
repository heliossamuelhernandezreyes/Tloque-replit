import { createHash } from "node:crypto"
import type { Client } from "@replit/object-storage"
import express, { type Express } from "express"
import { requireAdmin } from "./auth"
import { audioStorage } from "./audioStorage"
import { curatedAudioModuleSource, downloadCuratedAudioModule } from "./audioModuleInstaller"
import { rateLimit } from "./rateLimit"
import { detectSoundBankType } from "./soundBankDetection"

const MAX_UPLOAD_BYTES = 96 * 1024 * 1024
const MAX_MODULE_UPLOAD_BYTES = 500 * 1024 * 1024

function audioType(bytes: Buffer): { extension: "mp3" | "wav"; mimeType: string } | null {
  const wav = bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WAVE"
  if (wav) return { extension: "wav", mimeType: "audio/wav" }
  const id3 = bytes.length >= 3 && bytes.subarray(0, 3).toString("ascii") === "ID3"
  const frame = bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
  if (id3 || frame) return { extension: "mp3", mimeType: "audio/mpeg" }
  return null
}

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message)
  return String(error || "App Storage no disponible")
}

export function registerAudioUploadRoutes(app: Express) {
  app.get("/api/admin/audio/uploads/status", requireAdmin, async (_req, res) => {
    let storage: Client | undefined
    try {
      storage = audioStorage.get()
      const result = await storage.list({ maxResults: 1, prefix: "audio/fonoteca/" })
      if (!result.ok) throw result.error
      res.json({ ready: true, maxUploadBytes: MAX_UPLOAD_BYTES, maxModuleUploadBytes: MAX_MODULE_UPLOAD_BYTES })
    } catch (error) {
      audioStorage.reset(storage)
      res.status(503).json({
        ready: false,
        maxUploadBytes: MAX_UPLOAD_BYTES,
        maxModuleUploadBytes: MAX_MODULE_UPLOAD_BYTES,
        message: "Conecta un bucket en App Storage de Replit para recibir MP3/WAV",
        detail: process.env.NODE_ENV === "development" ? errorMessage(error) : undefined,
      })
    }
  })

  app.post(
    "/api/admin/audio/uploads",
    requireAdmin,
    rateLimit(60_000, 8),
    express.raw({ type: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "application/octet-stream"], limit: MAX_UPLOAD_BYTES }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ message: "Selecciona un MP3 o WAV" })
      const detected = audioType(req.body)
      if (!detected) return res.status(415).json({ message: "El contenido no es un MP3 o WAV válido" })
      const sha256 = createHash("sha256").update(req.body).digest("hex")
      const objectName = `audio/fonoteca/${sha256}.${detected.extension}`
      let storage: Client | undefined
      try {
        storage = audioStorage.get()
        const exists = await storage.exists(objectName)
        if (!exists.ok) throw exists.error
        if (!exists.value) {
          const uploaded = await storage.uploadFromBytes(objectName, req.body, { compress: false })
          if (!uploaded.ok) throw uploaded.error
        }
        let originalName = "audio"
        try { originalName = decodeURIComponent(req.get("X-Tloque-Filename") || "audio") } catch { /* nombre opcional */ }
        res.status(201).json({
          url: `/api/audio/uploads/${sha256}.${detected.extension}`,
          sha256,
          bytes: req.body.length,
          mimeType: detected.mimeType,
          originalName: originalName.slice(0, 180),
          deduplicated: exists.value,
        })
      } catch (error) {
        audioStorage.reset(storage)
        console.error("Audio upload failed:", error)
        res.status(503).json({ message: "App Storage no está listo. Conecta un bucket en Replit e inténtalo de nuevo." })
      }
    },
  )

  app.post(
    "/api/admin/audio/module-catalog/:sourceId/install",
    requireAdmin,
    rateLimit(60_000, 3),
    express.json({ limit: "8kb" }),
    async (req, res) => {
      const sourceId = Array.isArray(req.params.sourceId) ? req.params.sourceId[0] : req.params.sourceId
      const source = curatedAudioModuleSource(sourceId || "")
      if (!source?.install) return res.status(404).json({ message: "El módulo no está disponible para instalación" })
      if (req.body?.acknowledgement !== source.install.acknowledgement) {
        return res.status(400).json({ message: "Debes aceptar el aviso de licencia y procedencia para instalar este banco" })
      }
      let storage: Client | undefined
      try {
        const downloaded = await downloadCuratedAudioModule(source)
        const objectName = `audio/modules/${downloaded.sha256}.${downloaded.extension}`
        storage = audioStorage.get()
        const exists = await storage.exists(objectName)
        if (!exists.ok) throw exists.error
        if (!exists.value) {
          const uploaded = await storage.uploadFromBytes(objectName, downloaded.bytes, { compress: false })
          if (!uploaded.ok) throw uploaded.error
        }
        res.status(201).json({
          url: `/api/audio/modules/${downloaded.sha256}.${downloaded.extension}`,
          sha256: downloaded.sha256,
          bytes: downloaded.bytes.length,
          mimeType: downloaded.mimeType,
          extension: downloaded.extension,
          originalName: source.install.fileName,
          deduplicated: exists.value,
          source: {
            id: source.id,
            name: source.name,
            license: source.license,
            repositoryUrl: source.repositoryUrl,
            moduleId: source.install.moduleId,
            version: source.install.version,
            pinnedCommit: source.install.pinnedCommit,
            tags: source.install.tags,
          },
        })
      } catch (error) {
        audioStorage.reset(storage)
        console.error("Curated sound bank installation failed:", error)
        res.status(502).json({ message: "No se pudo descargar y verificar el banco fijado. Inténtalo de nuevo." })
      }
    },
  )

  app.post(
    "/api/admin/audio/module-uploads",
    requireAdmin,
    rateLimit(60_000, 4),
    express.raw({ type: ["application/octet-stream", "audio/soundfont", "application/x-sf2"], limit: MAX_MODULE_UPLOAD_BYTES }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ message: "Selecciona un banco SF2, SF3 o DLS" })
      let originalName = "instrumentos"
      try { originalName = decodeURIComponent(req.get("X-Tloque-Filename") || "instrumentos") } catch { /* nombre opcional */ }
      const detected = detectSoundBankType(req.body, originalName)
      if (!detected) return res.status(415).json({ message: "El contenido no es un banco SF2, SF3 o DLS válido" })
      const sha256 = createHash("sha256").update(req.body).digest("hex")
      const objectName = `audio/modules/${sha256}.${detected.extension}`
      let storage: Client | undefined
      try {
        storage = audioStorage.get()
        const exists = await storage.exists(objectName)
        if (!exists.ok) throw exists.error
        if (!exists.value) {
          const uploaded = await storage.uploadFromBytes(objectName, req.body, { compress: false })
          if (!uploaded.ok) throw uploaded.error
        }
        res.status(201).json({
          url: `/api/audio/modules/${sha256}.${detected.extension}`,
          sha256,
          bytes: req.body.length,
          mimeType: detected.mimeType,
          extension: detected.extension,
          originalName: originalName.slice(0, 180),
          deduplicated: exists.value,
        })
      } catch (error) {
        audioStorage.reset(storage)
        console.error("Sound bank upload failed:", error)
        res.status(503).json({ message: "App Storage no está listo para recibir el módulo instrumental." })
      }
    },
  )

  app.get("/api/audio/uploads/:file", rateLimit(60_000, 240), (req, res) => {
    const file = Array.isArray(req.params.file) ? req.params.file[0] : req.params.file
    const match = /^([a-f0-9]{64})\.(mp3|wav)$/.exec(file || "")
    if (!match) return res.status(404).end()
    const objectName = `audio/fonoteca/${match[1]}.${match[2]}`
    res.setHeader("Content-Type", match[2] === "wav" ? "audio/wav" : "audio/mpeg")
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable")
    let storage: Client | undefined
    try {
      storage = audioStorage.get()
      const stream = storage.downloadAsStream(objectName, { decompress: false })
      stream.once("error", error => {
        audioStorage.reset(storage)
        console.error("Audio stream failed:", error)
        if (!res.headersSent) res.status(404).end()
        else res.destroy(error)
      })
      stream.pipe(res)
    } catch (error) {
      audioStorage.reset(storage)
      console.error("Audio stream initialization failed:", error)
      res.status(503).end()
    }
  })

  app.get("/api/audio/modules/:file", rateLimit(60_000, 240), (req, res) => {
    const file = Array.isArray(req.params.file) ? req.params.file[0] : req.params.file
    const match = /^([a-f0-9]{64})\.(sf2|sf3|dls)$/.exec(file || "")
    if (!match) return res.status(404).end()
    const objectName = `audio/modules/${match[1]}.${match[2]}`
    res.setHeader("Content-Type", "application/octet-stream")
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable")
    let storage: Client | undefined
    try {
      storage = audioStorage.get()
      const stream = storage.downloadAsStream(objectName, { decompress: false })
      stream.once("error", error => {
        audioStorage.reset(storage)
        console.error("Sound bank stream failed:", error)
        if (!res.headersSent) res.status(404).end()
        else res.destroy(error)
      })
      stream.pipe(res)
    } catch (error) {
      audioStorage.reset(storage)
      console.error("Sound bank stream initialization failed:", error)
      res.status(503).end()
    }
  })
}
