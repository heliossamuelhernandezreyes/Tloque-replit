import { createHash } from "node:crypto"
import type { Express } from "express"
import { and, asc, eq, inArray, or, sql } from "drizzle-orm"
import { z } from "zod"
import {
  adaptiveScoreLayers,
  adaptiveScores,
  advancedDirectionProjects,
  audioAssets,
  books,
  experienceProfiles,
  narrativeProjects,
  paperUsageEvents,
  walletLedger,
} from "@shared/schema"
import {
  compileNarrativeProject,
  experienceProfileSchema,
  narrativeProjectSchema,
  paragraphCountFor,
  type NarrativeProjectV1,
} from "@shared/narrative"
import { advancedDirectionProjectSchema } from "@shared/direction"
import {
  musicBrainAudioLayerSchema,
  musicBrainScoreForDirection,
  musicBrainScoreForExperience,
  type MusicBrainScoreV1,
} from "@shared/music-brain"
import { paperChargeFor } from "@shared/paper"
import { db } from "./db"
import { isAdmin } from "./auth"
import { rateLimit } from "./rateLimit"
import { hasActiveSubscription } from "./subscription"
import {
  directChapterWithOracle,
  oracleConfig,
  type OracleScoreSummary,
} from "./oracle"

const projectBodySchema = z.object({
  expectedRevision: z.number().int().min(0).nullable().optional(),
  project: narrativeProjectSchema.omit({
    bookId: true,
    chapterIndex: true,
    revision: true,
  }),
}).strict()

const oracleBodySchema = z.object({
  requestKey: z.string().uuid(),
}).strict()

function parsePositiveInt(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function parseChapterIndex(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function chapterContent(book: typeof books.$inferSelect, chapterIndex: number): string | null {
  const chapters = Array.isArray(book.chapters) ? book.chapters as Array<{ content?: unknown }> : []
  if (chapters.length > 0) {
    if (chapterIndex >= chapters.length) return null
    return typeof chapters[chapterIndex]?.content === "string" ? chapters[chapterIndex].content as string : ""
  }
  return chapterIndex === 0 ? book.content : null
}

function canEditBook(book: typeof books.$inferSelect, user: any): boolean {
  return !!user && (book.authorId === user.id || isAdmin(user))
}

function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex")
}

async function loadBook(bookId: number) {
  const [book] = await db.select().from(books).where(eq(books.id, bookId))
  return book
}

async function paperBalance(userId: number, executor: Pick<typeof db, "select"> = db): Promise<number> {
  const [row] = await executor.select({
    balance: sql<number>`coalesce(sum(${walletLedger.delta}), 0)`,
  }).from(walletLedger).where(and(
    eq(walletLedger.userId, userId),
    eq(walletLedger.currency, "papel"),
  ))
  return Number(row?.balance || 0)
}

async function oracleCatalog(): Promise<OracleScoreSummary[]> {
  const scores = await db.select({
    id: adaptiveScores.id,
    title: adaptiveScores.title,
    bpm: adaptiveScores.bpm,
    tags: adaptiveScores.tags,
  }).from(adaptiveScores).where(eq(adaptiveScores.status, "published"))
  if (scores.length === 0) return []
  const layers = await db.select({
    scoreId: adaptiveScoreLayers.scoreId,
    tags: adaptiveScoreLayers.tags,
  }).from(adaptiveScoreLayers).where(inArray(
    adaptiveScoreLayers.scoreId,
    scores.map(score => score.id),
  ))
  return scores.map(score => ({
    id: score.id,
    title: score.title,
    bpm: score.bpm,
    tags: Array.isArray(score.tags) ? score.tags.filter((tag): tag is string => typeof tag === "string") : [],
    layerTags: [...new Set(layers
      .filter(layer => layer.scoreId === score.id)
      .flatMap(layer => Array.isArray(layer.tags) ? layer.tags : [])
      .filter((tag): tag is string => typeof tag === "string"))],
  }))
}

async function readerAudioLayers(score: MusicBrainScoreV1 | null) {
  if (!score) return []
  const explicitIds = [...new Set(score.regions.flatMap(region => region.layerIds))]
  const implicitScoreIds = [...new Set(score.regions
    .filter(region => region.scoreId && region.layerIds.length === 0)
    .map(region => region.scoreId as number))]
  if (!explicitIds.length && !implicitScoreIds.length) return []
  const selection = or(
    explicitIds.length ? inArray(adaptiveScoreLayers.id, explicitIds) : undefined,
    implicitScoreIds.length ? inArray(adaptiveScoreLayers.scoreId, implicitScoreIds) : undefined,
  )
  if (!selection) return []
  const rows = await db.select({
    id: adaptiveScoreLayers.id,
    scoreId: adaptiveScoreLayers.scoreId,
    assetId: adaptiveScoreLayers.assetId,
    title: audioAssets.title,
    url: audioAssets.url,
    loop: audioAssets.loop,
    defaultGain: adaptiveScoreLayers.defaultGain,
    syncBars: adaptiveScoreLayers.syncBars,
  }).from(adaptiveScoreLayers)
    .innerJoin(adaptiveScores, eq(adaptiveScoreLayers.scoreId, adaptiveScores.id))
    .innerJoin(audioAssets, eq(adaptiveScoreLayers.assetId, audioAssets.id))
    .where(and(
      selection,
      eq(adaptiveScores.status, "published"),
      eq(audioAssets.status, "published"),
      eq(audioAssets.sourceType, "stream"),
    ))
    .orderBy(asc(adaptiveScoreLayers.scoreId), asc(adaptiveScoreLayers.position))
  return rows.filter(row => Boolean(row.url)).map(row => musicBrainAudioLayerSchema.parse(row))
}

export function registerNarrativeRoutes(app: Express) {
  // Manifiesto ligero. El runtime obtiene archivos de audio por assetId desde
  // Fonoteca; el autor y Oráculo solo ven capas compatibles y metadatos.
  app.get("/api/audio/scores", async (_req, res) => {
    try {
      const scores = await db.select().from(adaptiveScores)
        .where(eq(adaptiveScores.status, "published"))
        .orderBy(asc(adaptiveScores.title))
      if (scores.length === 0) return res.json({ scores: [] })

      const layers = await db.select({
        id: adaptiveScoreLayers.id,
        scoreId: adaptiveScoreLayers.scoreId,
        assetId: adaptiveScoreLayers.assetId,
        layerKey: adaptiveScoreLayers.layerKey,
        family: adaptiveScoreLayers.family,
        role: adaptiveScoreLayers.role,
        intensityMin: adaptiveScoreLayers.intensityMin,
        intensityMax: adaptiveScoreLayers.intensityMax,
        defaultGain: adaptiveScoreLayers.defaultGain,
        syncBars: adaptiveScoreLayers.syncBars,
        tags: adaptiveScoreLayers.tags,
        position: adaptiveScoreLayers.position,
        assetTitle: audioAssets.title,
        assetUrl: audioAssets.url,
        assetLoop: audioAssets.loop,
      }).from(adaptiveScoreLayers)
        .innerJoin(audioAssets, eq(adaptiveScoreLayers.assetId, audioAssets.id))
        .where(and(
          inArray(adaptiveScoreLayers.scoreId, scores.map(score => score.id)),
          eq(audioAssets.status, "published"),
        ))
        .orderBy(asc(adaptiveScoreLayers.scoreId), asc(adaptiveScoreLayers.position))

      res.json({
        scores: scores.map(score => ({
          ...score,
          createdBy: undefined,
          layers: layers.filter(layer => layer.scoreId === score.id),
        })),
      })
    } catch (error) {
      console.error("Adaptive score catalog read failed:", error)
      res.status(500).json({ message: "No se pudo cargar el catálogo musical adaptativo" })
    }
  })

  app.get("/api/books/:id/narrative/:chapterIndex", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const bookId = parsePositiveInt(req.params.id)
    const chapterIndex = parseChapterIndex(req.params.chapterIndex)
    if (!bookId || chapterIndex === null) return res.status(400).json({ message: "Capítulo inválido" })
    try {
      const book = await loadBook(bookId)
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (!canEditBook(book, req.user)) return res.status(403).json({ message: "Solo el autor puede dirigir este capítulo" })
      const content = chapterContent(book, chapterIndex)
      if (content === null) return res.status(400).json({ message: "El capítulo no existe" })

      const [project] = await db.select().from(narrativeProjects).where(and(
        eq(narrativeProjects.bookId, bookId),
        eq(narrativeProjects.chapterIndex, chapterIndex),
      ))
      const [profile] = await db.select().from(experienceProfiles).where(and(
        eq(experienceProfiles.bookId, bookId),
        eq(experienceProfiles.chapterIndex, chapterIndex),
      ))
      const hash = contentHash(content)
      const stale = Boolean(project && project.contentHash !== hash)
      res.json({
        contentHash: hash,
        paragraphCount: paragraphCountFor(content),
        project: stale ? null : project?.data ?? null,
        stale,
        profile: profile?.data ?? null,
        profileStatus: profile?.status ?? null,
        oracle: {
          eligible: hasActiveSubscription(req.user as any, "oracle"),
          configured: oracleConfig() !== null,
          paperBalance: await paperBalance((req.user as any).id),
        },
      })
    } catch (error) {
      console.error("Narrative project read failed:", error)
      res.status(500).json({ message: "No se pudo cargar la dirección narrativa" })
    }
  })

  // Oráculo sólo prepara una propuesta lateral. Nunca cambia el manuscrito,
  // nunca publica y nunca participa durante la lectura.
  app.post("/api/books/:id/narrative/:chapterIndex/oracle", rateLimit(60_000, 3), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const bookId = parsePositiveInt(req.params.id)
    const chapterIndex = parseChapterIndex(req.params.chapterIndex)
    if (!bookId || chapterIndex === null) return res.status(400).json({ message: "Capítulo inválido" })
    const parsed = oracleBodySchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: "Solicitud de Oráculo inválida" })
    const userId = (req.user as any).id as number
    if (!hasActiveSubscription(req.user as any, "oracle")) return res.status(403).json({ message: "Oráculo requiere una suscripción Estética o Audio activa" })
    if (!oracleConfig()) return res.status(503).json({ message: "Oráculo aún no está configurado" })

    try {
      const [prior] = await db.select().from(paperUsageEvents)
        .where(eq(paperUsageEvents.requestKey, parsed.data.requestKey))
      if (prior) {
        if (prior.userId !== userId) return res.status(409).json({ message: "La solicitud ya fue utilizada" })
        const savedProject = (prior.metadata as any)?.project
        if (savedProject) return res.json({
          project: narrativeProjectSchema.parse(savedProject),
          paperCharged: prior.paperCharged,
          replayed: true,
        })
      }

      const book = await loadBook(bookId)
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (!canEditBook(book, req.user)) return res.status(403).json({ message: "Solo el autor puede dirigir este capítulo" })
      const content = chapterContent(book, chapterIndex)
      if (content === null) return res.status(400).json({ message: "El capítulo no existe" })
      if (content.trim().length < 80) return res.status(400).json({ message: "Escribe un poco más antes de usar Oráculo" })

      const [current] = await db.select().from(narrativeProjects).where(and(
        eq(narrativeProjects.bookId, bookId),
        eq(narrativeProjects.chapterIndex, chapterIndex),
      ))
      const estimatedInput = Math.ceil(content.length / 4)
      const estimatedPaper = paperChargeFor("oracle", estimatedInput, 4_000)
      if (await paperBalance(userId) < estimatedPaper) {
        return res.status(402).json({ message: `Necesitas aproximadamente ${estimatedPaper} de Papel para analizar este capítulo` })
      }

      const result = await directChapterWithOracle({
        bookId,
        chapterIndex,
        revision: Math.max(1, current?.revision ?? 1),
        content,
        scores: await oracleCatalog(),
      })
      const inputTokens = result.usage.inputTokens || estimatedInput
      const outputTokens = result.usage.outputTokens || Math.ceil(JSON.stringify(result.project).length / 4)
      const charged = paperChargeFor("oracle", inputTokens, outputTokens)

      await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(${userId})`)
        const available = await paperBalance(userId, tx as any)
        if (available < charged) throw new Error("PAPER_BALANCE_CHANGED")
        const [usage] = await tx.insert(paperUsageEvents).values({
          userId,
          requestKey: parsed.data.requestKey,
          feature: "oracle",
          provider: result.provider,
          inputUnits: inputTokens,
          outputUnits: outputTokens,
          paperCharged: charged,
          metadata: {
            bookId,
            chapterIndex,
            model: result.model,
            project: result.project,
          },
        }).returning()
        if (charged > 0) await tx.insert(walletLedger).values({
          userId,
          currency: "papel",
          delta: -charged,
          reason: "spend_ai",
          refType: "paper_usage",
          refId: usage.id,
        })
      })
      res.json({ project: result.project, paperCharged: charged, replayed: false })
    } catch (error) {
      if (error instanceof Error && error.message === "PAPER_BALANCE_CHANGED") {
        return res.status(409).json({ message: "Tu saldo de Papel cambió; vuelve a intentarlo" })
      }
      console.error("Oracle narrative direction failed:", error)
      const message = error instanceof Error ? error.message : "Oráculo no pudo analizar el capítulo"
      res.status(502).json({ message })
    }
  })

  app.put("/api/books/:id/narrative/:chapterIndex", rateLimit(60_000, 30), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const bookId = parsePositiveInt(req.params.id)
    const chapterIndex = parseChapterIndex(req.params.chapterIndex)
    if (!bookId || chapterIndex === null) return res.status(400).json({ message: "Capítulo inválido" })
    const parsed = projectBodySchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Proyecto inválido" })

    try {
      const book = await loadBook(bookId)
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (!canEditBook(book, req.user)) return res.status(403).json({ message: "Solo el autor puede dirigir este capítulo" })
      const content = chapterContent(book, chapterIndex)
      if (content === null) return res.status(400).json({ message: "El capítulo no existe" })
      const hash = contentHash(content)

      const outcome = await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`narrative:${bookId}:${chapterIndex}`}))`)
        const [current] = await tx.select().from(narrativeProjects).where(and(
          eq(narrativeProjects.bookId, bookId), eq(narrativeProjects.chapterIndex, chapterIndex),
        ))
        const expected = parsed.data.expectedRevision
        if (current && expected !== undefined && expected !== null && expected !== current.revision) {
          return { conflict: current.revision, saved: null }
        }
        if (!current && expected !== undefined && expected !== null && expected !== 0) {
          return { conflict: 0, saved: null }
        }
        const revision = (current?.revision ?? 0) + 1
        const project: NarrativeProjectV1 = narrativeProjectSchema.parse({
          ...parsed.data.project, version: 1, bookId, chapterIndex, revision,
        })
        const [saved] = await tx.insert(narrativeProjects).values({
          bookId, chapterIndex, revision, contentHash: hash, data: project, createdBy: (req.user as any).id,
        }).onConflictDoUpdate({
          target: [narrativeProjects.bookId, narrativeProjects.chapterIndex],
          set: { revision, contentHash: hash, data: project, updatedAt: new Date() },
        }).returning()
        return { conflict: null, saved }
      })
      if (outcome.conflict !== null) {
        return res.status(409).json({
          message: outcome.conflict === 0 ? "La dirección todavía no existe" : "La dirección cambió en otra sesión",
          revision: outcome.conflict,
        })
      }
      res.json({ project: outcome.saved!.data })
    } catch (error) {
      console.error("Narrative project save failed:", error)
      res.status(500).json({ message: "No se pudo guardar la dirección narrativa" })
    }
  })

  app.post("/api/books/:id/narrative/:chapterIndex/compile", rateLimit(60_000, 20), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const bookId = parsePositiveInt(req.params.id)
    const chapterIndex = parseChapterIndex(req.params.chapterIndex)
    if (!bookId || chapterIndex === null) return res.status(400).json({ message: "Capítulo inválido" })
    try {
      const book = await loadBook(bookId)
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (!canEditBook(book, req.user)) return res.status(403).json({ message: "Solo el autor puede compilar este capítulo" })
      const content = chapterContent(book, chapterIndex)
      if (content === null) return res.status(400).json({ message: "El capítulo no existe" })
      const [stored] = await db.select().from(narrativeProjects).where(and(
        eq(narrativeProjects.bookId, bookId),
        eq(narrativeProjects.chapterIndex, chapterIndex),
      ))
      if (!stored) return res.status(404).json({ message: "Guarda primero la dirección del capítulo" })
      if (stored.contentHash !== contentHash(content)) {
        return res.status(409).json({ message: "El manuscrito cambió; vuelve a guardar o analizar la música" })
      }

      const project = narrativeProjectSchema.parse(stored.data)
      const profile = compileNarrativeProject(project, paragraphCountFor(content))
      const validProfile = experienceProfileSchema.parse(profile)
      const [saved] = await db.insert(experienceProfiles).values({
        bookId,
        chapterIndex,
        revision: validProfile.revision,
        sourceProjectRevision: project.revision,
        status: "draft",
        data: validProfile,
        compiledBy: (req.user as any).id,
      }).onConflictDoUpdate({
        target: [experienceProfiles.bookId, experienceProfiles.chapterIndex],
        set: {
          revision: validProfile.revision,
          sourceProjectRevision: project.revision,
          status: "draft",
          data: validProfile,
          compiledBy: (req.user as any).id,
          compiledAt: new Date(),
          publishedAt: null,
        },
      }).returning()
      res.json({ profile: saved.data, status: saved.status })
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo compilar"
      res.status(400).json({ message })
    }
  })

  app.post("/api/books/:id/narrative/:chapterIndex/publish", rateLimit(60_000, 20), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const bookId = parsePositiveInt(req.params.id)
    const chapterIndex = parseChapterIndex(req.params.chapterIndex)
    if (!bookId || chapterIndex === null) return res.status(400).json({ message: "Capítulo inválido" })
    try {
      const book = await loadBook(bookId)
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (!canEditBook(book, req.user)) return res.status(403).json({ message: "Solo el autor puede publicar esta dirección" })
      const content = chapterContent(book, chapterIndex)
      const [project] = await db.select({
        revision: narrativeProjects.revision,
        contentHash: narrativeProjects.contentHash,
      }).from(narrativeProjects).where(and(
        eq(narrativeProjects.bookId, bookId),
        eq(narrativeProjects.chapterIndex, chapterIndex),
      ))
      const [currentProfile] = await db.select().from(experienceProfiles).where(and(
        eq(experienceProfiles.bookId, bookId),
        eq(experienceProfiles.chapterIndex, chapterIndex),
      ))
      if (!project || !currentProfile || content === null
          || project.contentHash !== contentHash(content)
          || currentProfile.sourceProjectRevision !== project.revision
          || experienceProfileSchema.parse(currentProfile.data).paragraphCount !== paragraphCountFor(content)) {
        return res.status(409).json({ message: "Compila nuevamente la dirección del capítulo" })
      }
      const [profile] = await db.update(experienceProfiles).set({
        status: "approved",
        publishedAt: new Date(),
      }).where(and(
        eq(experienceProfiles.bookId, bookId),
        eq(experienceProfiles.chapterIndex, chapterIndex),
      )).returning()
      if (!profile) return res.status(404).json({ message: "Compila primero la dirección" })
      res.json({ profile: profile.data, status: profile.status })
    } catch (error) {
      console.error("Experience profile publish failed:", error)
      res.status(500).json({ message: "No se pudo publicar la dirección" })
    }
  })

  // El lector recibe contratos compactos ya derivados. El manuscrito, las
  // notas editoriales y la procedencia del agente nunca salen en esta respuesta.
  app.get("/api/books/:id/experience/:chapterIndex", async (req, res) => {
    const bookId = parsePositiveInt(req.params.id)
    const chapterIndex = parseChapterIndex(req.params.chapterIndex)
    if (!bookId || chapterIndex === null) return res.status(400).json({ message: "Capítulo inválido" })
    try {
      const book = await loadBook(bookId)
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      const owner = req.isAuthenticated() && canEditBook(book, req.user)
      if (book.status !== "published" && !owner) return res.status(404).json({ message: "Libro no encontrado" })
      const conditions = [
        eq(experienceProfiles.bookId, bookId),
        eq(experienceProfiles.chapterIndex, chapterIndex),
      ]
      if (!owner) conditions.push(eq(experienceProfiles.status, "approved"))
      const [profile] = await db.select().from(experienceProfiles).where(and(...conditions))
      if (!profile) return res.json({ profile: null, musicBrain: null, audioLayers: [] })
      const compactProfile = experienceProfileSchema.parse(profile.data)
      const [advanced] = await db.select().from(advancedDirectionProjects).where(and(
        eq(advancedDirectionProjects.bookId, bookId),
        eq(advancedDirectionProjects.chapterIndex, chapterIndex),
        eq(advancedDirectionProjects.revision, profile.sourceProjectRevision),
      ))
      const advancedProject = advancedDirectionProjectSchema.safeParse(advanced?.data)
      const musicBrain = advancedProject.success && advancedProject.data.musicProject.regions.length > 0
        ? musicBrainScoreForDirection(advancedProject.data)
        : compactProfile.regions.length > 0 ? musicBrainScoreForExperience(compactProfile) : null
      res.json({ profile: compactProfile, musicBrain, audioLayers: await readerAudioLayers(musicBrain) })
    } catch (error) {
      console.error("Experience profile read failed:", error)
      res.status(500).json({ message: "No se pudo cargar la experiencia narrativa" })
    }
  })
}
