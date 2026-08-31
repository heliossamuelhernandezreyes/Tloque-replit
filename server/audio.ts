import type { Express } from "express"
import { and, asc, eq } from "drizzle-orm"
import { z } from "zod"
import {
  audioAssets, audioEventBindings, audioFavorites, books, chapterAudioAssignments,
} from "@shared/schema"
import { isSafeAudioSource, isSafeHttpsUrl, isSafeSoundBankSource } from "@shared/media"
import {
  AUDIO_CONTRACT_VERSION, UI_SOUND_EVENTS, audioRecipeSchema, audioSourceTypeSchema,
  anyLinearScoreRecipeSchema, compileTloqueScore, proceduralRecipeSchema,
  uiSoundEventKeySchema, uiSoundRecipeSchema,
} from "@shared/audio"
import { db } from "./db"
import { isAdmin, requireAdmin } from "./auth"
import { rateLimit } from "./rateLimit"
import { registerAudioUploadRoutes } from "./audioUploads"
import { ORCHESTRAL_SYNTH_MODULE_ID } from "@shared/orchestral-synthesis"

export const audioAssetInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  artist: z.string().trim().max(160).default(""),
  kind: z.enum(["music", "ambience", "system"]).default("music"),
  sourceType: audioSourceTypeSchema.default("stream"),
  url: z.string().trim().max(2_000).default(""),
  recipe: audioRecipeSchema.nullable().default(null),
  musicalKey: z.string().trim().max(16).default(""),
  musicalMode: z.string().trim().max(32).default(""),
  brightness: z.number().min(0).max(1).default(0.5),
  texture: z.string().trim().max(80).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(24).default([]),
  packUrl: z.string().trim().max(2_000).default(""),
  packBytes: z.number().int().positive().max(500_000_000).nullable().default(null),
  packSha256: z.string().trim().toLowerCase().regex(/^$|^[a-f0-9]{64}$/, "Huella SHA-256 inválida").default(""),
  instrumentProgram: z.number().int().min(0).max(127).nullable().default(null),
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
}).superRefine((value, ctx) => {
  if (value.sourceType === "stream" && !isSafeAudioSource(value.url)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "La URL debe ser HTTPS y apuntar a un archivo de audio permitido" })
  }
  if (value.sourceType !== "stream" && value.url && !isSafeAudioSource(value.url)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "La pista de respaldo debe ser audio HTTPS permitido" })
  }
  if (value.sourceType !== "stream" && !value.recipe) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["recipe"], message: "La síntesis necesita una receta válida" })
  }
  if (value.sourceType === "soundfont" && !isSafeSoundBankSource(value.packUrl)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["packUrl"], message: "El banco debe ser una importación interna o una URL HTTPS .sf2, .sf3 o .dls" })
  }
  if (value.sourceType === "soundfont" && value.tags.some(tag => tag.startsWith("module:")) && (!value.packBytes || !value.packSha256)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["packSha256"], message: "Un módulo descargable necesita tamaño y huella SHA-256" })
  }
  if (["procedural", "soundfont"].includes(value.sourceType) && !proceduralRecipeSchema.safeParse(value.recipe).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["recipe"], message: "La receta musical procedural no es válida" })
  }
  if (value.sourceType === "score") {
    const recipe = anyLinearScoreRecipeSchema.safeParse(value.recipe)
    if (!recipe.success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["recipe"], message: "Compila el código TloqueScore antes de guardar" })
    } else {
      const verified = compileTloqueScore(recipe.data.source)
      if (!verified.ok || verified.recipe.plan.sourceHash !== recipe.data.plan.sourceHash) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["recipe"], message: "La partitura compilada no corresponde al código fuente" })
      }
      if (recipe.data.version === 2
        && recipe.data.plan.moduleId !== "builtin"
        && recipe.data.plan.moduleId !== "native-auto"
        && recipe.data.plan.moduleId !== ORCHESTRAL_SYNTH_MODULE_ID
        && !isSafeSoundBankSource(value.packUrl)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["packUrl"], message: `El módulo ${recipe.data.plan.moduleId} necesita un banco SF2/SF3 publicado` })
      }
    }
  }
  if (value.sourceType === "sfx" && !uiSoundRecipeSchema.safeParse(value.recipe).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["recipe"], message: "La receta de microsonido no es válida" })
  }
  if (value.kind === "system" && !["stream", "sfx"].includes(value.sourceType)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceType"], message: "Los sonidos de interfaz usan archivo o receta SFX" })
  }
  if (value.sourceType === "sfx" && value.kind !== "system") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["kind"], message: "Un microsonido SFX pertenece a Sonidos del sistema" })
  }
  if (value.sourceType === "score" && value.kind !== "music") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["kind"], message: "TloqueScore genera temas instrumentales de Música" })
  }
})

const assignmentInputSchema = z.object({
  assetId: z.number().int().positive(),
  volume: z.number().min(0).max(1).default(0.35),
  loop: z.boolean().default(true),
  crossfadeSeconds: z.number().min(0.25).max(20).default(6),
})

const scoreCompileInputSchema = z.object({
  source: z.string().min(1).max(200_000),
}).strict()

const eventBindingInputSchema = z.object({
  assetId: z.number().int().positive(),
  volume: z.number().min(0).max(1).default(0.8),
  cooldownMs: z.number().int().min(0).max(10_000).default(70),
  enabled: z.boolean().default(true),
}).strict()

const MIDI_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const

function normalizedAudioAsset(data: z.infer<typeof audioAssetInputSchema>) {
  if (data.sourceType === "stream" || !data.recipe) return data
  if (data.sourceType === "score") {
    const recipe = anyLinearScoreRecipeSchema.parse(data.recipe)
    return {
      ...data,
      recipe,
      bpm: recipe.plan.bpm,
      musicalMode: `${recipe.plan.meter.numerator}/${recipe.plan.meter.denominator}`,
      texture: data.texture || "partitura lineal TloqueScore",
      tags: [...new Set([...data.tags, "tloque-score", "instrumental", recipe.plan.compilerVersion])].slice(0, 24),
      durationSeconds: Math.max(1, Math.ceil("totalSeconds" in recipe.plan ? recipe.plan.totalSeconds : recipe.plan.totalBeats * 60 / recipe.plan.bpm)),
      loop: recipe.plan.loop,
    }
  }
  if (data.sourceType === "sfx") {
    const recipe = uiSoundRecipeSchema.parse(data.recipe)
    const duration = Math.max(...recipe.voices.map(voice => voice.offset + voice.duration))
    return {
      ...data,
      recipe,
      bpm: null,
      musicalKey: "",
      musicalMode: "",
      texture: data.texture || "microsonido procedural",
      tags: [...new Set([...data.tags, "interface", "procedural-sfx"])].slice(0, 24),
      durationSeconds: Math.max(1, Math.ceil(duration)),
      loop: false,
    }
  }
  const recipe = proceduralRecipeSchema.parse(data.recipe)
  const presetEmotion = {
    quiet_observatory: "contemplative",
    warm_memory: "nostalgic",
    cold_suspense: "suspense",
    deep_focus: "focused",
  }[recipe.preset]
  const automaticTags = [recipe.preset, recipe.scale, data.sourceType]
  return {
    ...data,
    recipe,
    bpm: recipe.bpm,
    musicalKey: `${MIDI_NAMES[recipe.rootMidi % 12]}${Math.floor(recipe.rootMidi / 12) - 1}`,
    musicalMode: recipe.scale,
    brightness: recipe.brightness,
    texture: data.texture || recipe.preset.replaceAll("_", " "),
    emotion: data.emotion === "neutral" ? presetEmotion : data.emotion,
    tags: [...new Set([...data.tags, ...automaticTags])].slice(0, 24),
  }
}

function parsePositiveInt(value: unknown): number | null {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

function publicAsset(asset: typeof audioAssets.$inferSelect) {
  const { createdBy: _createdBy, ...safe } = asset
  return safe
}

export function registerAudioRoutes(app: Express) {
  registerAudioUploadRoutes(app)
  app.get("/api/audio/ui-manifest", async (_req, res) => {
    try {
      const rows = await db.select({
        eventKey: audioEventBindings.eventKey,
        volume: audioEventBindings.volume,
        cooldownMs: audioEventBindings.cooldownMs,
        asset: audioAssets,
      }).from(audioEventBindings)
        .innerJoin(audioAssets, eq(audioEventBindings.assetId, audioAssets.id))
        .where(and(
          eq(audioEventBindings.enabled, true),
          eq(audioAssets.kind, "system"),
          eq(audioAssets.status, "published"),
        ))
        .orderBy(asc(audioEventBindings.eventKey))

      const bindings = rows.flatMap(row => {
        const event = uiSoundEventKeySchema.safeParse(row.eventKey)
        if (!event.success || !["stream", "sfx"].includes(row.asset.sourceType)) return []
        const recipe = row.asset.sourceType === "sfx"
          ? uiSoundRecipeSchema.safeParse(row.asset.recipe)
          : null
        if (recipe && !recipe.success) return []
        return [{
          eventKey: event.data,
          volume: row.volume,
          cooldownMs: row.cooldownMs,
          asset: {
            id: row.asset.id,
            title: row.asset.title,
            sourceType: row.asset.sourceType as "stream" | "sfx",
            url: row.asset.url,
            recipe: recipe?.success ? recipe.data : null,
          },
        }]
      })
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
      res.json({ version: AUDIO_CONTRACT_VERSION, bindings })
    } catch (error) {
      console.error("UI audio manifest read failed:", error)
      res.status(500).json({ message: "No se pudo cargar el mapa de sonidos" })
    }
  })

  app.post("/api/admin/audio/score/compile", requireAdmin, rateLimit(60_000, 60), (req, res) => {
    const parsed = scoreCompileInputSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: "Código TloqueScore inválido" })
    const result = compileTloqueScore(parsed.data.source)
    if (!result.ok) return res.status(400).json(result)
    res.json(result)
  })

  app.get("/api/admin/audio/ui-bindings", requireAdmin, async (_req, res) => {
    try {
      const [bindings, assets] = await Promise.all([
        db.select().from(audioEventBindings).orderBy(asc(audioEventBindings.eventKey)),
        db.select().from(audioAssets)
          .where(and(eq(audioAssets.kind, "system"), eq(audioAssets.status, "published")))
          .orderBy(asc(audioAssets.title)),
      ])
      res.json({ events: UI_SOUND_EVENTS, bindings, assets })
    } catch (error) {
      console.error("Admin UI audio bindings read failed:", error)
      res.status(500).json({ message: "No se pudieron cargar las asignaciones" })
    }
  })

  app.put("/api/admin/audio/ui-bindings/:eventKey", requireAdmin, rateLimit(60_000, 60), async (req, res) => {
    const event = uiSoundEventKeySchema.safeParse(req.params.eventKey)
    const parsed = eventBindingInputSchema.safeParse(req.body)
    if (!event.success || !parsed.success) return res.status(400).json({ message: "Asignación inválida" })
    try {
      const [asset] = await db.select().from(audioAssets).where(and(
        eq(audioAssets.id, parsed.data.assetId),
        eq(audioAssets.kind, "system"),
        eq(audioAssets.status, "published"),
      ))
      if (!asset || !["stream", "sfx"].includes(asset.sourceType)) {
        return res.status(400).json({ message: "Elige un sonido del sistema publicado" })
      }
      const [binding] = await db.insert(audioEventBindings).values({
        eventKey: event.data,
        ...parsed.data,
        updatedBy: (req.user as any).id,
      }).onConflictDoUpdate({
        target: audioEventBindings.eventKey,
        set: { ...parsed.data, updatedBy: (req.user as any).id, updatedAt: new Date() },
      }).returning()
      res.json({ binding })
    } catch (error) {
      console.error("Admin UI audio binding update failed:", error)
      res.status(500).json({ message: "No se pudo guardar la asignación" })
    }
  })

  app.delete("/api/admin/audio/ui-bindings/:eventKey", requireAdmin, rateLimit(60_000, 60), async (req, res) => {
    const event = uiSoundEventKeySchema.safeParse(req.params.eventKey)
    if (!event.success) return res.status(400).json({ message: "Evento inválido" })
    try {
      await db.delete(audioEventBindings).where(eq(audioEventBindings.eventKey, event.data))
      res.json({ ok: true })
    } catch (error) {
      console.error("Admin UI audio binding delete failed:", error)
      res.status(500).json({ message: "No se pudo restaurar el sonido base" })
    }
  })

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
        ...normalizedAudioAsset(parsed.data),
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
        .set({ ...normalizedAudioAsset(parsed.data), updatedAt: new Date() })
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
