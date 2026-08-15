import type { Express, Request } from "express"
import { createHash, timingSafeEqual } from "node:crypto"
import { realpath } from "node:fs/promises"
import path from "node:path"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import {
  audiobookCache,
  audiobookJobs,
  bookCards,
  books,
  paperUsageEvents,
  speechProfiles,
  speechProjects,
  unlockedBooks,
  userCards,
  voiceProfiles,
  walletLedger,
} from "@shared/schema"
import { paperChargeFor } from "@shared/paper"
import {
  assertAudiobookCharacterCount,
  audiobookPreflight,
  compileSpeechProject,
  speechCacheMaterial,
  speechProfileSchema,
  speechProjectSchema,
  type SpeechProjectV1,
} from "@shared/speech"
import { isSafeHttpsUrl, isSafeStorageKey } from "@shared/media"
import { db } from "./db"
import { isAdmin } from "./auth"
import { rateLimit } from "./rateLimit"
import { hasActiveSubscription } from "./subscription"
import { analyzeSpeechWithGroq, speechOracleConfigured } from "./speechOracle"

const projectBodySchema = z.object({
  expectedRevision: z.number().int().min(0).nullable().optional(),
  project: speechProjectSchema.omit({
    bookId: true,
    chapterIndex: true,
    revision: true,
    contentHash: true,
  }),
}).strict()

const requestKeySchema = z.object({ requestKey: z.string().uuid() }).strict()
const completeJobSchema = z.object({
  storageKey: z.string().trim().min(1).max(1_000)
    .refine(isSafeStorageKey, "Clave de almacenamiento inválida"),
  mimeType: z.enum(["audio/mpeg", "audio/mp4", "audio/ogg"]).default("audio/mpeg"),
  durationSeconds: z.number().int().positive().max(86_400),
  actualCharacters: z.number().int().positive(),
}).strict()
const failJobSchema = z.object({
  errorCode: z.string().trim().min(1).max(100),
}).strict()
const voiceInputSchema = z.object({
  label: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1_000).default(""),
  providerVoiceId: z.string().trim().min(1).max(300),
  language: z.string().trim().min(2).max(12).default("es"),
  role: z.enum(["narrator", "dialogue", "both"]).default("both"),
  license: z.string().trim().min(1).max(1_000),
  sourceUrl: z.string().trim().max(2_000).refine(value => {
    if (!value) return true
    try { return new URL(value).protocol === "https:" } catch { return false }
  }, "La procedencia debe usar HTTPS").default(""),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
}).strict()

function positiveInt(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function chapterIndex(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function chapterContent(book: typeof books.$inferSelect, index: number): string | null {
  const chapters = Array.isArray(book.chapters) ? book.chapters as Array<{ content?: unknown }> : []
  if (chapters.length > 0) {
    if (index >= chapters.length) return null
    return typeof chapters[index]?.content === "string" ? chapters[index].content as string : ""
  }
  return index === 0 ? book.content : null
}

function canEdit(book: typeof books.$inferSelect, user: any): boolean {
  return Boolean(user) && (book.authorId === user.id || isAdmin(user))
}

export function speechContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex")
}

function cacheKeyFor(profile: unknown, modelId: string): string {
  const parsed = speechProfileSchema.parse(profile)
  return createHash("sha256").update(speechCacheMaterial(parsed, modelId), "utf8").digest("hex")
}

function elevenModelId(): string {
  return String(process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2")
}

function generationEnabled(): boolean {
  return String(process.env.AUDIOBOOK_GENERATION_ENABLED || "").toLowerCase() === "true"
    && Boolean(String(process.env.AUDIOBOOK_WORKER_TOKEN || "").trim())
}

async function loadBook(id: number) {
  const [book] = await db.select().from(books).where(eq(books.id, id))
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

async function publishedVoiceIds(): Promise<Set<number>> {
  const voices = await db.select({ id: voiceProfiles.id }).from(voiceProfiles)
    .where(eq(voiceProfiles.status, "published"))
  return new Set(voices.map(voice => voice.id))
}

async function profileVoicesAvailable(profile: z.infer<typeof speechProfileSchema>): Promise<boolean> {
  const available = await publishedVoiceIds()
  return profile.segments.every(segment => available.has(segment.voiceProfileId))
}

export type AudiobookAccessReason = "subscription" | "author" | "admin" | "book" | "card" | null

// La generación sigue requiriendo plan Audio y Papel. La reproducción de una
// copia ya generada también pertenece permanentemente a quien compró/reclamó
// la obra o posee una de sus tarjetas.
async function audiobookAccessReason(
  book: typeof books.$inferSelect,
  user: any,
): Promise<AudiobookAccessReason> {
  if (!user) return null
  if (isAdmin(user)) return "admin"
  if (book.authorId === user.id) return "author"
  if (hasActiveSubscription(user, "elevenlabs")) return "subscription"
  const [[unlocked], [card]] = await Promise.all([
    db.select({ id: unlockedBooks.id }).from(unlockedBooks).where(and(
      eq(unlockedBooks.userId, user.id),
      eq(unlockedBooks.bookId, book.id),
    )).limit(1),
    db.select({ id: userCards.id }).from(userCards)
      .innerJoin(bookCards, eq(userCards.cardId, bookCards.id))
      .where(and(eq(userCards.userId, user.id), eq(bookCards.bookId, book.id)))
      .limit(1),
  ])
  if (unlocked) return "book"
  if (card) return "card"
  return null
}

function workerAuthorized(req: Request): boolean {
  const expected = Buffer.from(String(process.env.AUDIOBOOK_WORKER_TOKEN || ""), "utf8")
  const supplied = Buffer.from(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""), "utf8")
  return expected.length >= 24 && expected.length === supplied.length && timingSafeEqual(expected, supplied)
}

async function refundFailedJob(job: typeof audiobookJobs.$inferSelect, errorCode: string) {
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(81733422, ${job.id})`)
    await tx.execute(sql`select pg_advisory_xact_lock(${job.userId})`)
    const [current] = await tx.select().from(audiobookJobs).where(eq(audiobookJobs.id, job.id))
    if (!current || (current.status !== "queued" && current.status !== "processing")) return
    await tx.update(audiobookJobs).set({ status: "failed", errorCode, finishedAt: new Date() })
      .where(eq(audiobookJobs.id, job.id))
    if (current.reservedPaper > 0) await tx.insert(walletLedger).values({
      userId: current.userId,
      currency: "papel",
      delta: current.reservedPaper,
      reason: "refund_ai",
      refType: "audiobook_job",
      refId: current.id,
    })
  })
}

export function registerSpeechRoutes(app: Express) {
  app.get("/api/voices", async (req, res) => {
    try {
      const language = String(req.query.language || "").trim().toLowerCase()
      const conditions = [eq(voiceProfiles.status, "published")]
      if (language) conditions.push(eq(voiceProfiles.language, language))
      const voices = await db.select({
        id: voiceProfiles.id,
        label: voiceProfiles.label,
        description: voiceProfiles.description,
        language: voiceProfiles.language,
        role: voiceProfiles.role,
        license: voiceProfiles.license,
      }).from(voiceProfiles).where(and(...conditions)).orderBy(asc(voiceProfiles.label))
      res.json({ voices })
    } catch (error) {
      console.error("Voice catalog read failed:", error)
      res.status(500).json({ message: "No se pudo cargar el catálogo de voces" })
    }
  })

  app.post("/api/admin/voices", rateLimit(60_000, 20), async (req, res) => {
    if (!req.isAuthenticated() || !isAdmin(req.user)) return res.status(403).json({ message: "Acceso de administrador requerido" })
    const parsed = voiceInputSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Voz inválida" })
    try {
      const [voice] = await db.insert(voiceProfiles).values({
        ...parsed.data,
        provider: "elevenlabs",
        createdBy: (req.user as any).id,
      }).returning()
      res.status(201).json({ voice })
    } catch (error) {
      console.error("Voice catalog create failed:", error)
      res.status(409).json({ message: "La voz ya existe o no pudo guardarse" })
    }
  })

  app.put("/api/admin/voices/:id", rateLimit(60_000, 30), async (req, res) => {
    if (!req.isAuthenticated() || !isAdmin(req.user)) return res.status(403).json({ message: "Acceso de administrador requerido" })
    const id = positiveInt(req.params.id)
    const parsed = voiceInputSchema.safeParse(req.body)
    if (!id || !parsed.success) return res.status(400).json({ message: "Voz inválida" })
    try {
      const [voice] = await db.update(voiceProfiles).set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(voiceProfiles.id, id)).returning()
      if (!voice) return res.status(404).json({ message: "Voz no encontrada" })
      res.json({ voice })
    } catch (error) {
      console.error("Voice catalog update failed:", error)
      res.status(409).json({ message: "La voz ya existe o no pudo guardarse" })
    }
  })

  app.get("/api/books/:id/speech/:chapterIndex", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const bookId = positiveInt(req.params.id)
    const index = chapterIndex(req.params.chapterIndex)
    if (!bookId || index === null) return res.status(400).json({ message: "Capítulo inválido" })
    try {
      const book = await loadBook(bookId)
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (!canEdit(book, req.user)) return res.status(403).json({ message: "Sólo el autor puede dirigir las voces" })
      const content = chapterContent(book, index)
      if (content === null) return res.status(400).json({ message: "El capítulo no existe" })
      const hash = speechContentHash(content)
      const [project] = await db.select().from(speechProjects).where(and(
        eq(speechProjects.bookId, bookId), eq(speechProjects.chapterIndex, index),
      ))
      const [profile] = await db.select().from(speechProfiles).where(and(
        eq(speechProfiles.bookId, bookId), eq(speechProfiles.chapterIndex, index),
      ))
      res.json({
        contentHash: hash,
        project: project?.data ?? null,
        stale: Boolean(project && project.contentHash !== hash),
        profile: profile?.data ?? null,
        profileStatus: profile?.status ?? null,
        oracle: {
          eligible: hasActiveSubscription(req.user as any, "oracle"),
          configured: speechOracleConfigured(),
          paperBalance: await paperBalance((req.user as any).id),
        },
      })
    } catch (error) {
      console.error("Speech project read failed:", error)
      res.status(500).json({ message: "No se pudo cargar la dirección de voz" })
    }
  })

  app.put("/api/books/:id/speech/:chapterIndex", rateLimit(60_000, 30), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const bookId = positiveInt(req.params.id)
    const index = chapterIndex(req.params.chapterIndex)
    const parsed = projectBodySchema.safeParse(req.body)
    if (!bookId || index === null || !parsed.success) return res.status(400).json({ message: "Dirección de voz inválida" })
    try {
      const book = await loadBook(bookId)
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (!canEdit(book, req.user)) return res.status(403).json({ message: "Sólo el autor puede dirigir las voces" })
      const content = chapterContent(book, index)
      if (content === null) return res.status(400).json({ message: "El capítulo no existe" })
      const contentHash = speechContentHash(content)
      const outcome = await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`speech:${bookId}:${index}`}))`)
        const [current] = await tx.select().from(speechProjects).where(and(
          eq(speechProjects.bookId, bookId), eq(speechProjects.chapterIndex, index),
        ))
        const expected = parsed.data.expectedRevision
        if (current && expected !== undefined && expected !== null && current.revision !== expected) {
          return { conflict: current.revision, saved: null }
        }
        if (!current && expected !== undefined && expected !== null && expected !== 0) {
          return { conflict: 0, saved: null }
        }
        const revision = (current?.revision ?? 0) + 1
        const project: SpeechProjectV1 = speechProjectSchema.parse({
          ...parsed.data.project, version: 1, bookId, chapterIndex: index, revision, contentHash,
        })
        const [saved] = await tx.insert(speechProjects).values({
          bookId, chapterIndex: index, revision, contentHash, data: project,
          createdBy: (req.user as any).id,
        }).onConflictDoUpdate({
          target: [speechProjects.bookId, speechProjects.chapterIndex],
          set: { revision, contentHash, data: project, updatedAt: new Date() },
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
      console.error("Speech project save failed:", error)
      res.status(500).json({ message: "No se pudo guardar la dirección de voz" })
    }
  })

  app.post("/api/books/:id/speech/:chapterIndex/oracle", rateLimit(60_000, 3), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const bookId = positiveInt(req.params.id)
    const index = chapterIndex(req.params.chapterIndex)
    const parsed = requestKeySchema.safeParse(req.body)
    if (!bookId || index === null || !parsed.success) return res.status(400).json({ message: "Solicitud inválida" })
    if (!hasActiveSubscription(req.user as any, "oracle")) {
      return res.status(403).json({ message: "Oráculo requiere una suscripción Estética o Audio activa" })
    }
    if (!speechOracleConfigured()) return res.status(503).json({ message: "El análisis de voz con Groq no está configurado" })
    const userId = (req.user as any).id as number
    try {
      const [prior] = await db.select().from(paperUsageEvents).where(eq(paperUsageEvents.requestKey, parsed.data.requestKey))
      if (prior) {
        if (prior.userId !== userId) return res.status(409).json({ message: "La solicitud ya fue utilizada" })
        const saved = (prior.metadata as any)?.speechProject
        if (saved) return res.json({ project: speechProjectSchema.parse(saved), paperCharged: prior.paperCharged, replayed: true })
      }
      const book = await loadBook(bookId)
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (!canEdit(book, req.user)) return res.status(403).json({ message: "Sólo el autor puede analizar las voces" })
      const content = chapterContent(book, index)
      if (content === null || content.trim().length < 40) return res.status(400).json({ message: "Escribe un poco más antes de analizar" })
      const [current] = await db.select().from(speechProjects).where(and(
        eq(speechProjects.bookId, bookId), eq(speechProjects.chapterIndex, index),
      ))
      const estimatedInput = Math.ceil(content.length / 3)
      const estimatedPaper = paperChargeFor("oracle", estimatedInput, 12_000)
      if (await paperBalance(userId) < estimatedPaper) {
        return res.status(402).json({ message: `Necesitas aproximadamente ${estimatedPaper} de Papel para analizar este capítulo` })
      }
      const result = await analyzeSpeechWithGroq({
        bookId,
        chapterIndex: index,
        revision: Math.max(1, current?.revision ?? 1),
        content,
        contentHash: speechContentHash(content),
      })
      const inputUnits = result.inputTokens || estimatedInput
      const outputUnits = result.outputTokens || Math.ceil(JSON.stringify(result.project).length / 4)
      const charged = paperChargeFor("oracle", inputUnits, outputUnits)
      await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(${userId})`)
        if (await paperBalance(userId, tx as any) < charged) throw new Error("PAPER_BALANCE_CHANGED")
        const [usage] = await tx.insert(paperUsageEvents).values({
          userId,
          requestKey: parsed.data.requestKey,
          feature: "oracle",
          provider: "groq",
          inputUnits,
          outputUnits,
          paperCharged: charged,
          metadata: { bookId, chapterIndex: index, model: result.model, kind: "speech", speechProject: result.project },
        }).returning()
        if (charged > 0) await tx.insert(walletLedger).values({
          userId, currency: "papel", delta: -charged,
          reason: "spend_ai", refType: "paper_usage", refId: usage.id,
        })
      })
      res.json({ project: result.project, paperCharged: charged, replayed: false })
    } catch (error) {
      if (error instanceof Error && error.message === "PAPER_BALANCE_CHANGED") {
        return res.status(409).json({ message: "Tu saldo de Papel cambió; vuelve a intentarlo" })
      }
      console.error("Speech Oracle failed:", error)
      res.status(502).json({ message: error instanceof Error ? error.message : "Groq no pudo analizar el capítulo" })
    }
  })

  app.post("/api/books/:id/speech/:chapterIndex/compile", rateLimit(60_000, 20), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const bookId = positiveInt(req.params.id)
    const index = chapterIndex(req.params.chapterIndex)
    if (!bookId || index === null) return res.status(400).json({ message: "Capítulo inválido" })
    try {
      const book = await loadBook(bookId)
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (!canEdit(book, req.user)) return res.status(403).json({ message: "Sólo el autor puede compilar las voces" })
      const content = chapterContent(book, index)
      if (content === null) return res.status(400).json({ message: "El capítulo no existe" })
      const [stored] = await db.select().from(speechProjects).where(and(
        eq(speechProjects.bookId, bookId), eq(speechProjects.chapterIndex, index),
      ))
      if (!stored) return res.status(404).json({ message: "Guarda primero la dirección de voz" })
      const contentHash = speechContentHash(content)
      const project = speechProjectSchema.parse(stored.data)
      const profile = compileSpeechProject(project, content, contentHash, await publishedVoiceIds())
      const [saved] = await db.insert(speechProfiles).values({
        bookId,
        chapterIndex: index,
        revision: profile.revision,
        sourceProjectRevision: project.revision,
        contentHash,
        status: "draft",
        characterCount: profile.characterCount,
        data: profile,
        compiledBy: (req.user as any).id,
      }).onConflictDoUpdate({
        target: [speechProfiles.bookId, speechProfiles.chapterIndex],
        set: {
          revision: profile.revision,
          sourceProjectRevision: project.revision,
          contentHash,
          status: "draft",
          characterCount: profile.characterCount,
          data: profile,
          compiledBy: (req.user as any).id,
          compiledAt: new Date(),
          publishedAt: null,
        },
      }).returning()
      res.json({ profile: saved.data, status: saved.status, estimatedPaper: paperChargeFor("elevenlabs", profile.characterCount) })
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "No se pudo compilar la dirección de voz" })
    }
  })

  app.post("/api/books/:id/speech/:chapterIndex/publish", rateLimit(60_000, 20), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const bookId = positiveInt(req.params.id)
    const index = chapterIndex(req.params.chapterIndex)
    if (!bookId || index === null) return res.status(400).json({ message: "Capítulo inválido" })
    try {
      const book = await loadBook(bookId)
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (!canEdit(book, req.user)) return res.status(403).json({ message: "Sólo el autor puede publicar las voces" })
      const content = chapterContent(book, index)
      const [profile] = await db.select().from(speechProfiles).where(and(
        eq(speechProfiles.bookId, bookId), eq(speechProfiles.chapterIndex, index),
      ))
      const [project] = await db.select({ revision: speechProjects.revision }).from(speechProjects).where(and(
        eq(speechProjects.bookId, bookId), eq(speechProjects.chapterIndex, index),
      ))
      if (!profile || !project || content === null
          || profile.contentHash !== speechContentHash(content)
          || profile.sourceProjectRevision !== project.revision) {
        return res.status(409).json({ message: "Compila nuevamente la dirección del capítulo" })
      }
      const compiled = speechProfileSchema.parse(profile.data)
      if (!await profileVoicesAvailable(compiled)) {
        return res.status(409).json({ message: "Una voz ya no está disponible; compila nuevamente" })
      }
      const [published] = await db.update(speechProfiles).set({ status: "approved", publishedAt: new Date() })
        .where(eq(speechProfiles.id, profile.id)).returning()
      res.json({ profile: published.data, status: published.status })
    } catch (error) {
      console.error("Speech profile publish failed:", error)
      res.status(500).json({ message: "No se pudo publicar la dirección de voz" })
    }
  })

  app.get("/api/books/:id/audiobook/:chapterIndex", async (req, res) => {
    const bookId = positiveInt(req.params.id)
    const index = chapterIndex(req.params.chapterIndex)
    if (!bookId || index === null) return res.status(400).json({ message: "Capítulo inválido" })
    try {
      const book = await loadBook(bookId)
      if (!book || book.status !== "published") return res.status(404).json({ message: "Libro no encontrado" })
      const content = chapterContent(book, index)
      const [profileRow] = await db.select().from(speechProfiles).where(and(
        eq(speechProfiles.bookId, bookId),
        eq(speechProfiles.chapterIndex, index),
        eq(speechProfiles.status, "approved"),
      ))
      if (!profileRow || content === null || profileRow.contentHash !== speechContentHash(content)) {
        return res.json({ authorReady: false, cached: false, estimatedPaper: null, canRequest: false })
      }
      const profile = speechProfileSchema.parse(profileRow.data)
      if (!await profileVoicesAvailable(profile)) {
        return res.json({ authorReady: false, cached: false, estimatedPaper: null, canRequest: false })
      }
      const cacheKey = cacheKeyFor(profile, elevenModelId())
      const [cached] = await db.select().from(audiobookCache).where(and(
        eq(audiobookCache.cacheKey, cacheKey), eq(audiobookCache.status, "ready"),
      ))
      const [activeJob] = await db.select().from(audiobookJobs).where(and(
        eq(audiobookJobs.cacheKey, cacheKey), inArray(audiobookJobs.status, ["queued", "processing"]),
      ))
      const subscriber = req.isAuthenticated() && hasActiveSubscription(req.user as any, "elevenlabs")
      const accessReason = cached && req.isAuthenticated()
        ? await audiobookAccessReason(book, req.user)
        : null
      const balance = req.isAuthenticated() ? await paperBalance((req.user as any).id) : 0
      const preflight = audiobookPreflight(profile.characterCount, balance)
      res.json({
        authorReady: true,
        cached: Boolean(cached),
        generating: Boolean(activeJob),
        estimatedPaper: preflight.estimatedPaper,
        paperBalance: req.isAuthenticated() ? balance : null,
        subscriptionRequired: !subscriber,
        playbackAccess: Boolean(accessReason),
        accessReason,
        canRequest: subscriber && preflight.allowed && !cached && !activeJob && generationEnabled(),
        playbackUrl: accessReason && cached ? `/api/audiobooks/${cached.id}/stream` : null,
      })
    } catch (error) {
      console.error("Audiobook availability failed:", error)
      res.status(500).json({ message: "No se pudo consultar el audiolibro" })
    }
  })

  app.post("/api/books/:id/audiobook/:chapterIndex/request", rateLimit(60_000, 4), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    if (!hasActiveSubscription(req.user as any, "elevenlabs")) {
      return res.status(403).json({ message: "Los audiolibros generados requieren una suscripción Audio activa" })
    }
    if (!generationEnabled()) return res.status(503).json({ message: "La generación de audiolibros aún no está habilitada" })
    const bookId = positiveInt(req.params.id)
    const index = chapterIndex(req.params.chapterIndex)
    const parsed = requestKeySchema.safeParse(req.body)
    if (!bookId || index === null || !parsed.success) return res.status(400).json({ message: "Solicitud inválida" })
    const userId = (req.user as any).id as number
    try {
      const [priorJob] = await db.select().from(audiobookJobs).where(eq(audiobookJobs.requestKey, parsed.data.requestKey))
      if (priorJob) {
        if (priorJob.userId !== userId) return res.status(409).json({ message: "La solicitud ya fue utilizada" })
        const [priorCache] = priorJob.status === "ready"
          ? await db.select().from(audiobookCache).where(and(
            eq(audiobookCache.cacheKey, priorJob.cacheKey), eq(audiobookCache.status, "ready"),
          ))
          : [undefined]
        return res.status(priorJob.status === "queued" || priorJob.status === "processing" ? 202 : 200).json({
          cacheHit: Boolean(priorCache),
          replayed: true,
          jobId: priorJob.id,
          status: priorJob.status,
          paperReserved: 0,
          playbackUrl: priorCache ? `/api/audiobooks/${priorCache.id}/stream` : null,
        })
      }
      const book = await loadBook(bookId)
      if (!book || book.status !== "published") return res.status(404).json({ message: "Libro no encontrado" })
      const content = chapterContent(book, index)
      const [profileRow] = await db.select().from(speechProfiles).where(and(
        eq(speechProfiles.bookId, bookId), eq(speechProfiles.chapterIndex, index), eq(speechProfiles.status, "approved"),
      ))
      if (!profileRow || content === null || profileRow.contentHash !== speechContentHash(content)) {
        return res.status(409).json({ message: "El autor todavía no terminó la dirección de voz" })
      }
      const profile = speechProfileSchema.parse(profileRow.data)
      if (!await profileVoicesAvailable(profile)) {
        return res.status(409).json({ message: "Una voz ya no está disponible; el autor debe revisar el capítulo" })
      }
      const modelId = elevenModelId()
      const cacheKey = cacheKeyFor(profile, modelId)
      const estimatedPaper = audiobookPreflight(profile.characterCount, await paperBalance(userId)).estimatedPaper
      let result: { kind: "cached"; cacheId: number } | { kind: "waiting"; jobId: number } | { kind: "queued"; jobId: number }
      result = await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${cacheKey}))`)
        await tx.execute(sql`select pg_advisory_xact_lock(${userId})`)
        const [cached] = await tx.select().from(audiobookCache).where(and(
          eq(audiobookCache.cacheKey, cacheKey), eq(audiobookCache.status, "ready"),
        ))
        if (cached) return { kind: "cached" as const, cacheId: cached.id }
        const [active] = await tx.select().from(audiobookJobs).where(and(
          eq(audiobookJobs.cacheKey, cacheKey), inArray(audiobookJobs.status, ["queued", "processing"]),
        ))
        if (active) return { kind: "waiting" as const, jobId: active.id }
        if (await paperBalance(userId, tx as any) < estimatedPaper) throw new Error("INSUFFICIENT_PAPER")
        const [job] = await tx.insert(audiobookJobs).values({
          requestKey: parsed.data.requestKey,
          cacheKey,
          userId,
          bookId,
          chapterIndex: index,
          speechProfileRevision: profile.revision,
          contentHash: profile.contentHash,
          modelId,
          status: "queued",
          estimatedPaper,
          reservedPaper: estimatedPaper,
          expectedCharacters: profile.characterCount,
          actualCharacters: 0,
          provider: "elevenlabs",
        }).returning()
        if (estimatedPaper > 0) await tx.insert(walletLedger).values({
          userId,
          currency: "papel",
          delta: -estimatedPaper,
          reason: "reserve_ai",
          refType: "audiobook_job",
          refId: job.id,
        })
        return { kind: "queued" as const, jobId: job.id }
      })
      if (result.kind === "cached") return res.json({ cacheHit: true, paperCharged: 0, playbackUrl: `/api/audiobooks/${result.cacheId}/stream` })
      res.status(result.kind === "queued" ? 202 : 200).json({ cacheHit: false, waiting: result.kind === "waiting", jobId: result.jobId, paperReserved: result.kind === "queued" ? estimatedPaper : 0 })
    } catch (error) {
      if (error instanceof Error && error.message === "INSUFFICIENT_PAPER") {
        return res.status(402).json({ message: "No tienes suficiente Papel para generar este capítulo" })
      }
      console.error("Audiobook request failed:", error)
      res.status(500).json({ message: "No se pudo solicitar el audiolibro" })
    }
  })

  app.get("/api/audiobook/jobs/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const id = positiveInt(req.params.id)
    if (!id) return res.status(400).json({ message: "Trabajo inválido" })
    const [job] = await db.select().from(audiobookJobs).where(eq(audiobookJobs.id, id))
    if (!job || (job.userId !== (req.user as any).id && !isAdmin(req.user))) return res.status(404).json({ message: "Trabajo no encontrado" })
    const [cached] = job.status === "ready"
      ? await db.select().from(audiobookCache).where(and(eq(audiobookCache.cacheKey, job.cacheKey), eq(audiobookCache.status, "ready")))
      : [undefined]
    res.json({ id: job.id, status: job.status, errorCode: job.errorCode, playbackUrl: cached ? `/api/audiobooks/${cached.id}/stream` : null })
  })

  app.get("/api/audiobooks/:id/stream", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const id = positiveInt(req.params.id)
    if (!id) return res.status(400).json({ message: "Audiolibro inválido" })
    const [cached] = await db.select().from(audiobookCache).where(and(eq(audiobookCache.id, id), eq(audiobookCache.status, "ready")))
    if (!cached) return res.status(404).json({ message: "Audiolibro no encontrado" })
    const book = await loadBook(cached.bookId)
    if (!book || !await audiobookAccessReason(book, req.user)) {
      return res.status(403).json({ message: "No tienes acceso a este audiolibro" })
    }
    res.setHeader("Cache-Control", "private, no-store")
    const localRoot = String(process.env.AUDIOBOOK_STORAGE_DIR || "").trim()
    if (localRoot) {
      if (!isSafeStorageKey(cached.storageKey)) return res.status(400).json({ message: "Clave de audio inválida" })
      try {
        const root = await realpath(path.resolve(localRoot))
        const file = await realpath(path.resolve(root, cached.storageKey))
        if (file !== root && file.startsWith(`${root}${path.sep}`)) return res.sendFile(file)
      } catch { /* no revelar si la clave o el objeto faltan */ }
      return res.status(404).json({ message: "Audio no encontrado" })
    }
    const signer = String(process.env.AUDIOBOOK_SIGNING_URL || "").trim()
    if (signer && isSafeHttpsUrl(signer, 2_000)) {
      const response = await fetch(signer, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.AUDIOBOOK_WORKER_TOKEN || ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ storageKey: cached.storageKey, expiresInSeconds: 300 }),
        signal: AbortSignal.timeout(8_000),
      })
      const payload = await response.json().catch(() => null) as any
      if (response.ok && typeof payload?.url === "string" && isSafeHttpsUrl(payload.url, 4_000)) {
        return res.redirect(302, payload.url)
      }
    }
    res.status(503).json({ message: "El almacenamiento de audiolibros no está configurado" })
  })

  // Protocolo mínimo para un worker propio o de un colaborador. El token nunca
  // se entrega al cliente y las operaciones son idempotentes por estado/jobId.
  app.post("/api/internal/audiobook/jobs/claim", async (req, res) => {
    if (!workerAuthorized(req)) return res.status(401).json({ message: "Worker no autorizado" })
    const claimed = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(81733421)`)
      const [job] = await tx.select().from(audiobookJobs).where(eq(audiobookJobs.status, "queued"))
        .orderBy(asc(audiobookJobs.createdAt)).limit(1)
      if (!job) return null
      const [profileRow] = await tx.select().from(speechProfiles).where(and(
        eq(speechProfiles.bookId, job.bookId),
        eq(speechProfiles.chapterIndex, job.chapterIndex),
        eq(speechProfiles.revision, job.speechProfileRevision),
        eq(speechProfiles.status, "approved"),
      ))
      if (!profileRow) {
        return { failedJob: job }
      }
      await tx.update(audiobookJobs).set({ status: "processing", startedAt: new Date() }).where(eq(audiobookJobs.id, job.id))
      const profile = speechProfileSchema.parse(profileRow.data)
      const voiceIds = [...new Set(profile.segments.map(segment => segment.voiceProfileId))]
      const voices = await tx.select({
        id: voiceProfiles.id,
        provider: voiceProfiles.provider,
        providerVoiceId: voiceProfiles.providerVoiceId,
      }).from(voiceProfiles).where(and(inArray(voiceProfiles.id, voiceIds), eq(voiceProfiles.status, "published")))
      if (voices.length !== voiceIds.length) return { failedJob: job, errorCode: "VOICE_MISSING" }
      return { job, profile, voices, modelId: job.modelId }
    })
    if (claimed && "failedJob" in claimed) {
      const errorCode = claimed.errorCode || "PROFILE_MISSING"
      if (claimed.failedJob) await refundFailedJob(claimed.failedJob, errorCode)
      return res.status(409).json({ message: errorCode === "VOICE_MISSING" ? "Una voz ya no está disponible" : "El perfil ya no está disponible" })
    }
    if (!claimed) return res.status(204).send()
    res.json(claimed)
  })

  app.post("/api/internal/audiobook/jobs/:id/complete", async (req, res) => {
    if (!workerAuthorized(req)) return res.status(401).json({ message: "Worker no autorizado" })
    const id = positiveInt(req.params.id)
    const parsed = completeJobSchema.safeParse(req.body)
    if (!id || !parsed.success) return res.status(400).json({ message: "Resultado inválido" })
    try {
      await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(81733422, ${id})`)
        const [job] = await tx.select().from(audiobookJobs).where(eq(audiobookJobs.id, id))
        if (!job) throw new Error("JOB_NOT_FOUND")
        if (job.status === "ready") return
        if (job.status !== "processing") throw new Error("JOB_NOT_PROCESSING")
        await tx.execute(sql`select pg_advisory_xact_lock(${job.userId})`)
        assertAudiobookCharacterCount(job.expectedCharacters, parsed.data.actualCharacters)
        const actualPaper = paperChargeFor("elevenlabs", parsed.data.actualCharacters)
        if (actualPaper > job.reservedPaper) throw new Error("USAGE_EXCEEDED_RESERVATION")
        await tx.insert(audiobookCache).values({
          cacheKey: job.cacheKey,
          bookId: job.bookId,
          chapterIndex: job.chapterIndex,
          speechProfileRevision: job.speechProfileRevision,
          contentHash: job.contentHash,
          modelId: job.modelId,
          storageKey: parsed.data.storageKey,
          mimeType: parsed.data.mimeType,
          durationSeconds: parsed.data.durationSeconds,
          characterCount: parsed.data.actualCharacters,
          status: "ready",
          generatedAt: new Date(),
        }).onConflictDoUpdate({
          target: audiobookCache.cacheKey,
          set: {
            storageKey: parsed.data.storageKey,
            mimeType: parsed.data.mimeType,
            durationSeconds: parsed.data.durationSeconds,
            characterCount: parsed.data.actualCharacters,
            status: "ready",
            generatedAt: new Date(),
          },
        })
        await tx.update(audiobookJobs).set({
          status: "ready", actualCharacters: parsed.data.actualCharacters, finishedAt: new Date(), errorCode: "",
        }).where(eq(audiobookJobs.id, id))
        await tx.insert(paperUsageEvents).values({
          userId: job.userId,
          requestKey: `audiobook:${job.requestKey}`,
          feature: "elevenlabs",
          provider: "elevenlabs",
          inputUnits: parsed.data.actualCharacters,
          outputUnits: 0,
          paperCharged: actualPaper,
          metadata: { jobId: job.id, bookId: job.bookId, chapterIndex: job.chapterIndex, cacheKey: job.cacheKey },
        }).onConflictDoNothing()
        const refund = job.reservedPaper - actualPaper
        if (refund > 0) await tx.insert(walletLedger).values({
          userId: job.userId, currency: "papel", delta: refund,
          reason: "refund_ai", refType: "audiobook_job", refId: job.id,
        })
      })
      res.json({ ok: true })
    } catch (error) {
      res.status(409).json({ message: error instanceof Error ? error.message : "No se pudo cerrar el trabajo" })
    }
  })

  app.post("/api/internal/audiobook/jobs/:id/fail", async (req, res) => {
    if (!workerAuthorized(req)) return res.status(401).json({ message: "Worker no autorizado" })
    const id = positiveInt(req.params.id)
    const parsed = failJobSchema.safeParse(req.body)
    if (!id || !parsed.success) return res.status(400).json({ message: "Fallo inválido" })
    const [job] = await db.select().from(audiobookJobs).where(eq(audiobookJobs.id, id))
    if (!job) return res.status(404).json({ message: "Trabajo no encontrado" })
    await refundFailedJob(job, parsed.data.errorCode)
    res.json({ ok: true })
  })
}
