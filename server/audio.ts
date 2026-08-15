import type { Express } from "express"
import { and, asc, eq } from "drizzle-orm"
import { z } from "zod"
import {
  audioAssets, audioFavorites, books, chapterAudioAssignments,
} from "@shared/schema"
import { isSafeAudioSource, isSafeHttpsUrl } from "@shared/media"
import { db } from "./db"
import { isAdmin, requireAdmin } from "./auth"
import { rateLimit } from "./rateLimit"

export const audioAssetInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  artist: z.string().trim().max(160).default(""),
  kind: z.enum(["music", "ambience", "system"]).default("music"),
  url: z.string().trim().refine(isSafeAudioSource, "La URL debe ser HTTPS y apuntar a un archivo de audio permitido"),
  emotion: z.string().trim().min(1).max(60).default("neutral"),
  bpm: z.number().int().min(20).max(300).nullable().default(null),
  energy: z.number().min(0).max(1).default(0.5),
  durationSeconds: z.number().int().min(1).max(86_400).nullable().default(null),
  loop: z.boolean().default(true),
  license: z.string().trim().min(2).max(500),
  sourceName: z.string().trim().min(2, "Indica la procedencia del activo").max(200),
  sourceUrl: z.string().trim().max(2_000)
    .refine(v => v === "" || isSafeHttpsUrl(v), "La procedencia debe usar HTTPS")
    .default(""),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
})

const assignmentInputSchema = z.object({
  assetId: z.number().int().positive(),
  volume: z.number().min(0).max(1).default(0.35),
  loop: z.boolean().default(true),
  crossfadeSeconds: z.number().min(0.25).max(20).default(6),
})

function parsePositiveInt(value: unknown): number | null {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

function publicAsset(asset: typeof audioAssets.$inferSelect) {
  const { createdBy: _createdBy, ...safe } = asset
  return safe
}

export function registerAudioRoutes(app: Express) {
  app.get("/api/audio/assets", async (req, res) => {
    try {
      const list = await db.select().from(audioAssets)
        .where(eq(audioAssets.status, "published"))
        .orderBy(asc(audioAssets.kind), asc(audioAssets.title))
      let favorites = new Set<number>()
      if (req.isAuthenticated()) {
        const rows = await db.select().from(audioFavorites)
          .where(eq(audioFavorites.userId, (req.user as any).id))
        favorites = new Set(rows.map(row => row.assetId))
      }
      res.json({ assets: list.map(asset => ({ ...publicAsset(asset), favorite: favorites.has(asset.id) })) })
    } catch (error) {
      console.error("Audio catalog read failed:", error)
      res.status(500).json({ message: "No se pudo cargar la Fonoteca" })
    }
  })

  app.get("/api/admin/audio/assets", requireAdmin, async (_req, res) => {
    try {
      const list = await db.select().from(audioAssets)
        .orderBy(asc(audioAssets.kind), asc(audioAssets.title))
      res.json({ assets: list })
    } catch (error) {
      console.error("Admin audio catalog read failed:", error)
      res.status(500).json({ message: "No se pudo cargar la Fonoteca" })
    }
  })

  app.post("/api/admin/audio/assets", requireAdmin, rateLimit(60_000, 20), async (req, res) => {
    const parsed = audioAssetInputSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Activo inválido" })
    try {
      const [created] = await db.insert(audioAssets).values({
        ...parsed.data,
        createdBy: (req.user as any).id,
      }).returning()
      res.status(201).json({ asset: created })
    } catch (error) {
      console.error("Audio asset create failed:", error)
      res.status(500).json({ message: "No se pudo guardar el activo" })
    }
  })

  app.put("/api/admin/audio/assets/:id", requireAdmin, rateLimit(60_000, 30), async (req, res) => {
    const id = parsePositiveInt(req.params.id)
    if (!id) return res.status(400).json({ message: "ID inválido" })
    const parsed = audioAssetInputSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Activo inválido" })
    try {
      const [updated] = await db.update(audioAssets)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(audioAssets.id, id)).returning()
      if (!updated) return res.status(404).json({ message: "Activo no encontrado" })
      res.json({ asset: updated })
    } catch (error) {
      console.error("Audio asset update failed:", error)
      res.status(500).json({ message: "No se pudo actualizar el activo" })
    }
  })

  // Retirar conserva las asignaciones históricas, pero deja de resolverlas al lector.
  app.delete("/api/admin/audio/assets/:id", requireAdmin, rateLimit(60_000, 30), async (req, res) => {
    const id = parsePositiveInt(req.params.id)
    if (!id) return res.status(400).json({ message: "ID inválido" })
    try {
      const [updated] = await db.update(audioAssets)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(audioAssets.id, id)).returning({ id: audioAssets.id })
      if (!updated) return res.status(404).json({ message: "Activo no encontrado" })
      res.json({ ok: true })
    } catch (error) {
      console.error("Audio asset archive failed:", error)
      res.status(500).json({ message: "No se pudo retirar el activo" })
    }
  })

  app.put("/api/audio/assets/:id/favorite", rateLimit(60_000, 60), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const assetId = parsePositiveInt(req.params.id)
    if (!assetId) return res.status(400).json({ message: "ID inválido" })
    try {
      const [asset] = await db.select({ id: audioAssets.id }).from(audioAssets)
        .where(and(eq(audioAssets.id, assetId), eq(audioAssets.status, "published")))
      if (!asset) return res.status(404).json({ message: "Activo no encontrado" })
      await db.insert(audioFavorites).values({ userId: (req.user as any).id, assetId }).onConflictDoNothing()
      res.json({ favorite: true })
    } catch (error) {
      console.error("Audio favorite failed:", error)
      res.status(500).json({ message: "No se pudo guardar el favorito" })
    }
  })

  app.delete("/api/audio/assets/:id/favorite", rateLimit(60_000, 60), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const assetId = parsePositiveInt(req.params.id)
    if (!assetId) return res.status(400).json({ message: "ID inválido" })
    try {
      await db.delete(audioFavorites).where(and(
        eq(audioFavorites.userId, (req.user as any).id),
        eq(audioFavorites.assetId, assetId),
      ))
      res.json({ favorite: false })
    } catch (error) {
      console.error("Audio unfavorite failed:", error)
      res.status(500).json({ message: "No se pudo quitar el favorito" })
    }
  })

  app.get("/api/books/:id/audio", async (req, res) => {
    const bookId = parsePositiveInt(req.params.id)
    if (!bookId) return res.status(400).json({ message: "ID inválido" })
    try {
      const [book] = await db.select().from(books).where(eq(books.id, bookId))
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      const owner = req.isAuthenticated() && book.authorId === (req.user as any).id
      const admin = req.isAuthenticated() && isAdmin(req.user)
      if (book.status !== "published" && !owner && !admin) {
        return res.status(404).json({ message: "Libro no encontrado" })
      }
      const rows = await db.select({
        id: chapterAudioAssignments.id,
        bookId: chapterAudioAssignments.bookId,
        chapterIndex: chapterAudioAssignments.chapterIndex,
        assetId: chapterAudioAssignments.assetId,
        volume: chapterAudioAssignments.volume,
        loop: chapterAudioAssignments.loop,
        crossfadeSeconds: chapterAudioAssignments.crossfadeSeconds,
        updatedAt: chapterAudioAssignments.updatedAt,
        asset: audioAssets,
      }).from(chapterAudioAssignments)
        .innerJoin(audioAssets, eq(chapterAudioAssignments.assetId, audioAssets.id))
        .where(and(
          eq(chapterAudioAssignments.bookId, bookId),
          eq(audioAssets.status, "published"),
        ))
        .orderBy(asc(chapterAudioAssignments.chapterIndex))
      res.json({ assignments: rows.map(row => ({ ...row, asset: publicAsset(row.asset) })) })
    } catch (error) {
      console.error("Book audio read failed:", error)
      res.status(500).json({ message: "No se pudo cargar la música de la obra" })
    }
  })

  app.put("/api/books/:id/audio/:chapterIndex", rateLimit(60_000, 30), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const bookId = parsePositiveInt(req.params.id)
    const chapterIndex = Number(req.params.chapterIndex)
    if (!bookId || !Number.isInteger(chapterIndex) || chapterIndex < 0) {
      return res.status(400).json({ message: "Capítulo inválido" })
    }
    const parsed = assignmentInputSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Asignación inválida" })
    try {
      const [book] = await db.select().from(books).where(eq(books.id, bookId))
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (book.authorId !== (req.user as any).id && !isAdmin(req.user)) {
        return res.status(403).json({ message: "Solo el autor puede asignar música" })
      }
      const chapterCount = Array.isArray(book.chapters) && book.chapters.length ? book.chapters.length : 1
      if (chapterIndex >= chapterCount) return res.status(400).json({ message: "El capítulo no existe" })
      const [asset] = await db.select().from(audioAssets).where(and(
        eq(audioAssets.id, parsed.data.assetId),
        eq(audioAssets.status, "published"),
      ))
      if (!asset || asset.kind === "system") {
        return res.status(400).json({ message: "El activo no está disponible para lectura" })
      }
      const [assignment] = await db.insert(chapterAudioAssignments).values({
        bookId, chapterIndex, assignedBy: (req.user as any).id, ...parsed.data,
      }).onConflictDoUpdate({
        target: [chapterAudioAssignments.bookId, chapterAudioAssignments.chapterIndex],
        set: { ...parsed.data, assignedBy: (req.user as any).id, updatedAt: new Date() },
      }).returning()
      res.json({ assignment: { ...assignment, asset: publicAsset(asset) } })
    } catch (error) {
      console.error("Book audio assignment failed:", error)
      res.status(500).json({ message: "No se pudo asignar la pista" })
    }
  })

  app.delete("/api/books/:id/audio/:chapterIndex", rateLimit(60_000, 30), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const bookId = parsePositiveInt(req.params.id)
    const chapterIndex = Number(req.params.chapterIndex)
    if (!bookId || !Number.isInteger(chapterIndex) || chapterIndex < 0) {
      return res.status(400).json({ message: "Capítulo inválido" })
    }
    try {
      const [book] = await db.select().from(books).where(eq(books.id, bookId))
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (book.authorId !== (req.user as any).id && !isAdmin(req.user)) {
        return res.status(403).json({ message: "Solo el autor puede quitar música" })
      }
      await db.delete(chapterAudioAssignments).where(and(
        eq(chapterAudioAssignments.bookId, bookId),
        eq(chapterAudioAssignments.chapterIndex, chapterIndex),
      ))
      res.json({ ok: true })
    } catch (error) {
      console.error("Book audio removal failed:", error)
      res.status(500).json({ message: "No se pudo quitar la pista" })
    }
  })
}
