import type { Express } from "express"
import { createHash } from "node:crypto"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import {
  adaptiveScoreLayers,
  adaptiveScores,
  advancedDirectionProjects,
  audioAssets,
  books,
  directionAgentRuns,
  narrativeProjects,
  paperUsageEvents,
  speechProjects,
  voiceProfiles,
  walletLedger,
} from "@shared/schema"
import { paperChargeFor } from "@shared/paper"
import {
  ADVANCED_DIRECTION_VERSION,
  DIRECTION_AGENT_PROMPT_VERSION,
  advancedDirectionEditableProjectSchema,
  advancedDirectionProjectSchema,
  createAdvancedDirection,
  defaultMusicNode,
  defaultVoiceNote,
  mergeDirectionProposal,
  quoteDirectionAgent,
  type AdvancedDirectionProjectV2,
  type DirectionAgentMode,
} from "@shared/direction"
import { narrativeProjectSchema, type NarrativeProjectV1 } from "@shared/narrative"
import { speechProjectSchema, type SpeechProjectV1 } from "@shared/speech"
import { db } from "./db"
import { isAdmin } from "./auth"
import { hasActiveSubscription } from "./subscription"
import { rateLimit } from "./rateLimit"
import { directChapterWithOracle, oracleConfig, type OracleScoreSummary } from "./oracle"
import { analyzeSpeechWithGroq, speechOracleConfigured } from "./speechOracle"

const ABANDONED_RUN_MS = 15 * 60_000

const quoteBodySchema = z.object({
  requestKey: z.string().uuid(),
  mode: z.enum(["replace_unlocked", "fill_gaps"]).default("replace_unlocked"),
}).strict()

const runBodySchema = z.object({ requestKey: z.string().uuid() }).strict()

const saveBodySchema = z.object({
  expectedRevision: z.number().int().min(0).nullable().optional(),
  runRequestKey: z.string().uuid().optional(),
  project: advancedDirectionEditableProjectSchema,
}).strict()

function positiveInt(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function chapterIndex(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function contentFor(book: typeof books.$inferSelect, index: number): string | null {
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

function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex")
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

interface DirectionCatalog {
  scoreSummaries: OracleScoreSummary[]
  layers: Array<{
    id: number
    scoreId: number
    layerKey: string
    intensityMin: number
    intensityMax: number
    tags: string[]
  }>
  voiceCount: number
}

function stringTags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : []
}

async function directionCatalog(): Promise<DirectionCatalog> {
  const scores = await db.select({
    id: adaptiveScores.id,
    title: adaptiveScores.title,
    bpm: adaptiveScores.bpm,
    tags: adaptiveScores.tags,
  }).from(adaptiveScores).where(eq(adaptiveScores.status, "published")).orderBy(asc(adaptiveScores.title))
  const layers = scores.length > 0
    ? await db.select({
      id: adaptiveScoreLayers.id,
      scoreId: adaptiveScoreLayers.scoreId,
      layerKey: adaptiveScoreLayers.layerKey,
      intensityMin: adaptiveScoreLayers.intensityMin,
      intensityMax: adaptiveScoreLayers.intensityMax,
      tags: adaptiveScoreLayers.tags,
    }).from(adaptiveScoreLayers)
      .innerJoin(audioAssets, eq(adaptiveScoreLayers.assetId, audioAssets.id))
      .where(and(
        inArray(adaptiveScoreLayers.scoreId, scores.map(score => score.id)),
        eq(audioAssets.status, "published"),
      ))
    : []
  const [{ count: voiceCount }] = await db.select({ count: sql<number>`count(*)` })
    .from(voiceProfiles).where(eq(voiceProfiles.status, "published"))
  return {
    scoreSummaries: scores.map(score => ({
      id: score.id,
      title: score.title,
      bpm: score.bpm,
      tags: stringTags(score.tags),
      layerTags: [...new Set(layers.filter(layer => layer.scoreId === score.id).flatMap(layer => stringTags(layer.tags)))],
    })),
    layers: layers.map(layer => ({ ...layer, tags: stringTags(layer.tags) })),
    voiceCount: Number(voiceCount || 0),
  }
}

function layerIdsForProject(project: NarrativeProjectV1, catalog: DirectionCatalog): Map<string, number[]> {
  const result = new Map<string, number[]>()
  for (const region of project.regions) {
    const scoreId = region.scoreId ?? project.defaultScoreId
    if (!scoreId || region.layerTags.length === 0) {
      result.set(region.id, [])
      continue
    }
    const wanted = new Set(region.layerTags.map(tag => tag.toLowerCase()))
    const ids = catalog.layers.filter(layer => {
      if (layer.scoreId !== scoreId) return false
      const compatibleIntensity = region.targetIntensity >= layer.intensityMin && region.targetIntensity <= layer.intensityMax
      const tags = [layer.layerKey, ...layer.tags].map(tag => tag.toLowerCase())
      return compatibleIntensity && tags.some(tag => wanted.has(tag))
    }).slice(0, 12).map(layer => layer.id)
    result.set(region.id, ids)
  }
  return result
}

function directionConfigured(): boolean {
  return Boolean(oracleConfig() && speechOracleConfigured())
}

function emptyVoiceProject(input: {
  bookId: number
  chapterIndex: number
  revision: number
  hash: string
  language: string
}): SpeechProjectV1 {
  return speechProjectSchema.parse({
    version: 1,
    bookId: input.bookId,
    chapterIndex: input.chapterIndex,
    revision: input.revision,
    contentHash: input.hash,
    language: input.language,
    narratorVoiceProfileId: null,
    paragraphPauseMs: 650,
    characters: [],
    spans: [],
  })
}

function emptyMusicProject(bookId: number, index: number, revision: number): NarrativeProjectV1 {
  return narrativeProjectSchema.parse({
    version: 1,
    bookId,
    chapterIndex: index,
    revision,
    directionStyle: "subtle",
    defaultScoreId: null,
    regions: [],
  })
}

async function currentProject(
  book: typeof books.$inferSelect,
  index: number,
  content: string,
  catalog: DirectionCatalog,
): Promise<AdvancedDirectionProjectV2 | null> {
  const hash = contentHash(content)
  const [stored] = await db.select().from(advancedDirectionProjects).where(and(
    eq(advancedDirectionProjects.bookId, book.id),
    eq(advancedDirectionProjects.chapterIndex, index),
  ))
  if (stored) {
    const parsed = advancedDirectionProjectSchema.parse(stored.data)
    // Los offsets de voz y las regiones musicales pertenecen exactamente al
    // texto cuyo hash guardaron. Nunca se mezclan con un manuscrito distinto.
    return parsed.contentHash === hash ? parsed : null
  }

  const [[voice], [music]] = await Promise.all([
    db.select().from(speechProjects).where(and(eq(speechProjects.bookId, book.id), eq(speechProjects.chapterIndex, index))),
    db.select().from(narrativeProjects).where(and(eq(narrativeProjects.bookId, book.id), eq(narrativeProjects.chapterIndex, index))),
  ])
  if (!voice && !music) return null
  const revision = Math.max(1, voice?.revision ?? 0, music?.revision ?? 0)
  const language = String((voice?.data as any)?.language || book.originalLanguage || "es").trim() || "es"
  const voiceProject = voice && voice.contentHash === hash
    ? speechProjectSchema.parse({ ...voice.data, revision })
    : emptyVoiceProject({ bookId: book.id, chapterIndex: index, revision, hash, language })
  const musicProject = music
    ? narrativeProjectSchema.parse({ ...music.data, revision })
    : emptyMusicProject(book.id, index, revision)
  return advancedDirectionProjectSchema.parse({
    version: ADVANCED_DIRECTION_VERSION,
    bookId: book.id,
    chapterIndex: index,
    revision,
    contentHash: hash,
    language: voiceProject.language,
    voiceProject,
    musicProject,
    voiceNotes: voiceProject.spans.map(defaultVoiceNote),
    musicNodes: musicProject.regions.map(region => defaultMusicNode(region, layerIdsForProject(musicProject, catalog).get(region.id) ?? [])),
    agentAudit: null,
  })
}

async function assertPublishedMusicNodes(
  project: AdvancedDirectionProjectV2,
  executor: Pick<typeof db, "select"> = db,
): Promise<void> {
  const scoreIds = [...new Set(project.musicNodes
    .map(node => node.scoreId)
    .filter((id): id is number => typeof id === "number"))]
  if (scoreIds.length > 0) {
    const scores = await executor.select({ id: adaptiveScores.id, status: adaptiveScores.status })
      .from(adaptiveScores).where(inArray(adaptiveScores.id, scoreIds))
    const published = new Set(scores.filter(score => score.status === "published").map(score => score.id))
    if (scoreIds.some(id => !published.has(id))) {
      throw new Error("La propuesta contiene una partitura no publicada")
    }
  }

  const ids = [...new Set(project.musicNodes.flatMap(node => node.layerIds))]
  if (ids.length === 0) return
  const rows = await executor.select({
    id: adaptiveScoreLayers.id,
    scoreId: adaptiveScoreLayers.scoreId,
    scoreStatus: adaptiveScores.status,
    assetStatus: audioAssets.status,
  }).from(adaptiveScoreLayers)
    .innerJoin(adaptiveScores, eq(adaptiveScoreLayers.scoreId, adaptiveScores.id))
    .innerJoin(audioAssets, eq(adaptiveScoreLayers.assetId, audioAssets.id))
    .where(inArray(adaptiveScoreLayers.id, ids))
  const byId = new Map(rows.map(row => [row.id, row]))
  for (const node of project.musicNodes) {
    for (const layerId of node.layerIds) {
      const layer = byId.get(layerId)
      if (!layer || layer.scoreStatus !== "published" || layer.assetStatus !== "published" || layer.scoreId !== node.scoreId) {
        throw new Error("La propuesta contiene un nodo musical no publicado o incompatible")
      }
    }
  }
}

async function recoverAbandonedRuns(userId: number): Promise<number> {
  const candidates = await db.select({ id: directionAgentRuns.id })
    .from(directionAgentRuns)
    .where(and(
      eq(directionAgentRuns.userId, userId),
      eq(directionAgentRuns.status, "processing"),
      sql`${directionAgentRuns.startedAt} < ${new Date(Date.now() - ABANDONED_RUN_MS)}`,
    ))
  let recovered = 0
  for (const candidate of candidates) {
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(81733423, ${candidate.id})`)
      const [run] = await tx.select().from(directionAgentRuns).where(eq(directionAgentRuns.id, candidate.id))
      const abandoned = run?.status === "processing"
        && run.startedAt
        && run.startedAt.getTime() < Date.now() - ABANDONED_RUN_MS
      if (!run || !abandoned) return
      await tx.update(directionAgentRuns).set({
        status: "failed",
        errorCode: "ABANDONED_PROCESS_RECOVERED",
        finishedAt: new Date(),
      }).where(eq(directionAgentRuns.id, run.id))
      if (run.reservedPaper > 0) await tx.insert(walletLedger).values({
        userId: run.userId,
        currency: "papel",
        delta: run.reservedPaper,
        reason: "refund_ai",
        refType: "direction_agent_run",
        refId: run.id,
      })
      recovered += 1
    })
  }
  return recovered
}

async function refundFailedRun(runId: number, errorCode: string): Promise<void> {
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(81733423, ${runId})`)
    const [run] = await tx.select().from(directionAgentRuns).where(eq(directionAgentRuns.id, runId))
    if (!run || run.status !== "processing") return
    await tx.update(directionAgentRuns).set({
      status: "failed",
      errorCode: errorCode.slice(0, 160),
      finishedAt: new Date(),
    }).where(eq(directionAgentRuns.id, run.id))
    if (run.reservedPaper > 0) await tx.insert(walletLedger).values({
      userId: run.userId,
      currency: "papel",
      delta: run.reservedPaper,
      reason: "refund_ai",
      refType: "direction_agent_run",
      refId: run.id,
    })
  })
}

export function registerDirectionAgentRoutes(app: Express) {
  app.get("/api/books/:id/direction/:chapterIndex", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const bookId = positiveInt(req.params.id)
    const index = chapterIndex(req.params.chapterIndex)
    if (!bookId || index === null) return res.status(400).json({ message: "Capítulo inválido" })
    try {
      const [book] = await db.select().from(books).where(eq(books.id, bookId))
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (!canEdit(book, req.user)) return res.status(403).json({ message: "Sólo el autor puede abrir la partitura avanzada" })
      const content = contentFor(book, index)
      if (content === null) return res.status(400).json({ message: "El capítulo no existe" })
      const catalog = await directionCatalog()
      const project = await currentProject(book, index, content, catalog)
      res.json({
        contentHash: contentHash(content),
        project,
        stale: Boolean(project && project.contentHash !== contentHash(content)),
        agent: {
          configured: directionConfigured(),
          paperBalance: await paperBalance((req.user as any).id),
          promptVersion: DIRECTION_AGENT_PROMPT_VERSION,
        },
      })
    } catch (error) {
      console.error("Advanced direction read failed:", error)
      res.status(500).json({ message: "No se pudo cargar la partitura avanzada" })
    }
  })

  app.post("/api/books/:id/direction/:chapterIndex/quote", rateLimit(60_000, 12), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const bookId = positiveInt(req.params.id)
    const index = chapterIndex(req.params.chapterIndex)
    const parsed = quoteBodySchema.safeParse(req.body)
    if (!bookId || index === null || !parsed.success) return res.status(400).json({ message: "Cotización inválida" })
    if (!hasActiveSubscription(req.user as any, "oracle")) return res.status(403).json({ message: "El Director Artificial requiere un plan con Oráculo activo" })
    if (!directionConfigured()) return res.status(503).json({ message: "El Director Artificial todavía no está configurado" })
    const userId = (req.user as any).id as number
    try {
      await recoverAbandonedRuns(userId)
      const [prior] = await db.select().from(directionAgentRuns).where(eq(directionAgentRuns.requestKey, parsed.data.requestKey))
      if (prior) {
        if (prior.userId !== userId || prior.bookId !== bookId || prior.chapterIndex !== index) return res.status(409).json({ message: "La solicitud ya fue utilizada" })
        if (prior.status !== "quoted") return res.status(409).json({ message: "Esta clave de solicitud ya terminó; solicita una cotización nueva" })
        return res.json({
          requestKey: prior.requestKey,
          estimatedPaper: prior.estimatedPaper,
          maximumPaper: prior.maximumPaper,
          paperBalance: await paperBalance(userId),
          expiresAt: prior.expiresAt,
          replayed: true,
        })
      }
      const [book] = await db.select().from(books).where(eq(books.id, bookId))
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (!canEdit(book, req.user)) return res.status(403).json({ message: "Sólo el autor puede cotizar la dirección" })
      const content = contentFor(book, index)
      if (content === null || content.trim().length < 40) return res.status(400).json({ message: "Escribe un poco más antes de analizar" })
      const catalog = await directionCatalog()
      const quote = quoteDirectionAgent(content.length, catalog.layers.length + catalog.voiceCount + catalog.scoreSummaries.length)
      const expiresAt = new Date(Date.now() + 10 * 60_000)
      await db.insert(directionAgentRuns).values({
        requestKey: parsed.data.requestKey,
        userId,
        bookId,
        chapterIndex: index,
        contentHash: contentHash(content),
        mode: parsed.data.mode,
        status: "quoted",
        promptVersion: DIRECTION_AGENT_PROMPT_VERSION,
        estimatedInputUnits: quote.estimatedInputUnits,
        estimatedOutputUnits: quote.estimatedOutputUnits,
        estimatedPaper: quote.estimatedPaper,
        maximumPaper: quote.maximumPaper,
        expiresAt,
      })
      res.json({
        requestKey: parsed.data.requestKey,
        estimatedPaper: quote.estimatedPaper,
        maximumPaper: quote.maximumPaper,
        paperBalance: await paperBalance(userId),
        expiresAt,
        replayed: false,
      })
    } catch (error) {
      console.error("Direction quote failed:", error)
      res.status(500).json({ message: "No se pudo calcular el uso de Papel" })
    }
  })

  app.post("/api/books/:id/direction/:chapterIndex/run", rateLimit(60_000, 3), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const bookId = positiveInt(req.params.id)
    const index = chapterIndex(req.params.chapterIndex)
    const parsed = runBodySchema.safeParse(req.body)
    if (!bookId || index === null || !parsed.success) return res.status(400).json({ message: "Solicitud inválida" })
    if (!hasActiveSubscription(req.user as any, "oracle")) return res.status(403).json({ message: "El Director Artificial requiere un plan con Oráculo activo" })
    if (!directionConfigured()) return res.status(503).json({ message: "El Director Artificial todavía no está configurado" })
    const userId = (req.user as any).id as number
    let runId = 0
    try {
      await recoverAbandonedRuns(userId)
      const [book] = await db.select().from(books).where(eq(books.id, bookId))
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (!canEdit(book, req.user)) return res.status(403).json({ message: "Sólo el autor puede ejecutar la dirección" })
      const content = contentFor(book, index)
      if (content === null) return res.status(400).json({ message: "El capítulo no existe" })
      const hash = contentHash(content)
      const reservation = await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${parsed.data.requestKey}))`)
        const [run] = await tx.select().from(directionAgentRuns).where(eq(directionAgentRuns.requestKey, parsed.data.requestKey))
        if (!run || run.userId !== userId || run.bookId !== bookId || run.chapterIndex !== index) return { kind: "missing" as const }
        if (run.status === "ready" && run.proposal) return { kind: "ready" as const, run }
        if (run.status === "processing") return { kind: "processing" as const, run }
        if (run.status !== "quoted") return { kind: "closed" as const, run }
        if (run.expiresAt.getTime() < Date.now()) {
          await tx.update(directionAgentRuns).set({ status: "expired", finishedAt: new Date() }).where(eq(directionAgentRuns.id, run.id))
          return { kind: "expired" as const, run }
        }
        if (run.contentHash !== hash) return { kind: "stale" as const, run }
        await tx.execute(sql`select pg_advisory_xact_lock(${userId})`)
        if (await paperBalance(userId, tx as any) < run.maximumPaper) return { kind: "insufficient" as const, run }
        if (run.maximumPaper > 0) await tx.insert(walletLedger).values({
          userId,
          currency: "papel",
          delta: -run.maximumPaper,
          reason: "reserve_ai",
          refType: "direction_agent_run",
          refId: run.id,
        })
        const [processing] = await tx.update(directionAgentRuns).set({
          status: "processing",
          reservedPaper: run.maximumPaper,
          startedAt: new Date(),
        }).where(eq(directionAgentRuns.id, run.id)).returning()
        return { kind: "reserved" as const, run: processing }
      })
      if (reservation.kind === "missing") return res.status(404).json({ message: "Solicita primero una cotización" })
      if (reservation.kind === "ready") return res.json({ proposal: reservation.run.proposal, paperCharged: reservation.run.chargedPaper, replayed: true })
      if (reservation.kind === "processing") return res.status(409).json({ message: "El Director Artificial ya está analizando este capítulo" })
      if (reservation.kind === "expired") return res.status(409).json({ message: "La cotización venció; calcula una nueva" })
      if (reservation.kind === "stale") return res.status(409).json({ message: "El manuscrito cambió después de cotizar" })
      if (reservation.kind === "insufficient") return res.status(402).json({ message: `Necesitas ${reservation.run.maximumPaper} de Papel disponible para reservar esta operación` })
      if (reservation.kind === "closed") return res.status(409).json({ message: "Esta cotización ya no puede ejecutarse" })
      runId = reservation.run.id

      const catalog = await directionCatalog()
      const current = await currentProject(book, index, content, catalog)
      const nextRevision = (current?.revision ?? 0) + 1
      const [speech, music] = await Promise.all([
        analyzeSpeechWithGroq({
          bookId,
          chapterIndex: index,
          revision: nextRevision,
          content,
          contentHash: hash,
        }),
        directChapterWithOracle({
          bookId,
          chapterIndex: index,
          revision: nextRevision,
          content,
          scores: catalog.scoreSummaries,
        }),
      ])
      const rawProposal = createAdvancedDirection({
        revision: nextRevision,
        voiceProject: speech.project,
        musicProject: music.project,
        musicLayerIds: layerIdsForProject(music.project, catalog),
        provider: music.provider === "groq" ? "groq" : `${music.provider}+groq`,
        model: `${music.model} · ${speech.model}`,
      })
      const mode = reservation.run.mode as DirectionAgentMode
      const proposal = mergeDirectionProposal(current, rawProposal, mode)
      await assertPublishedMusicNodes(proposal)
      const actualInputUnits = (speech.inputTokens || Math.ceil(content.length / 3))
        + (music.usage.inputTokens || Math.ceil(content.length / 3))
      const actualOutputUnits = (speech.outputTokens || Math.ceil(JSON.stringify(speech.project).length / 4))
        + (music.usage.outputTokens || Math.ceil(JSON.stringify(music.project).length / 4))
      const measuredPaper = paperChargeFor("oracle", actualInputUnits, actualOutputUnits)
      const chargedPaper = Math.min(reservation.run.maximumPaper, measuredPaper)
      await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(81733423, ${runId})`)
        const [run] = await tx.select().from(directionAgentRuns).where(eq(directionAgentRuns.id, runId))
        if (!run || run.status !== "processing") throw new Error("RUN_STATE_CHANGED")
        const [usage] = await tx.insert(paperUsageEvents).values({
          userId,
          requestKey: run.requestKey,
          feature: "oracle",
          provider: rawProposal.agentAudit?.provider || "director_artificial",
          inputUnits: actualInputUnits,
          outputUnits: actualOutputUnits,
          paperCharged: chargedPaper,
          metadata: {
            kind: "direction_agent_v2",
            bookId,
            chapterIndex: index,
            promptVersion: DIRECTION_AGENT_PROMPT_VERSION,
            quoteCapApplied: measuredPaper > run.maximumPaper,
          },
        }).returning()
        void usage
        const refund = run.reservedPaper - chargedPaper
        if (refund > 0) await tx.insert(walletLedger).values({
          userId,
          currency: "papel",
          delta: refund,
          reason: "refund_ai",
          refType: "direction_agent_run",
          refId: run.id,
        })
        await tx.update(directionAgentRuns).set({
          status: "ready",
          provider: rawProposal.agentAudit?.provider || "director_artificial",
          model: rawProposal.agentAudit?.model || "",
          actualInputUnits,
          actualOutputUnits,
          chargedPaper,
          proposal,
          finishedAt: new Date(),
        }).where(eq(directionAgentRuns.id, run.id))
      })
      res.json({ proposal, paperCharged: chargedPaper, replayed: false })
    } catch (error) {
      if (runId) await refundFailedRun(runId, error instanceof Error ? error.message : "UNKNOWN")
      console.error("Direction Agent failed:", error)
      res.status(502).json({ message: error instanceof Error ? error.message : "El Director Artificial no pudo analizar el capítulo" })
    }
  })

  app.put("/api/books/:id/direction/:chapterIndex", rateLimit(60_000, 30), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const bookId = positiveInt(req.params.id)
    const index = chapterIndex(req.params.chapterIndex)
    const parsed = saveBodySchema.safeParse(req.body)
    if (!bookId || index === null || !parsed.success) return res.status(400).json({ message: "Partitura avanzada inválida" })
    try {
      const [book] = await db.select().from(books).where(eq(books.id, bookId))
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (!canEdit(book, req.user)) return res.status(403).json({ message: "Sólo el autor puede guardar la partitura" })
      const content = contentFor(book, index)
      if (content === null) return res.status(400).json({ message: "El capítulo no existe" })
      const hash = contentHash(content)
      const outcome = await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`direction:${bookId}:${index}`}))`)
        const [current] = await tx.select().from(advancedDirectionProjects).where(and(
          eq(advancedDirectionProjects.bookId, bookId),
          eq(advancedDirectionProjects.chapterIndex, index),
        ))
        const [[legacyVoice], [legacyMusic]] = current ? [[], []] : await Promise.all([
          tx.select({ revision: speechProjects.revision }).from(speechProjects).where(and(
            eq(speechProjects.bookId, bookId), eq(speechProjects.chapterIndex, index),
          )),
          tx.select({ revision: narrativeProjects.revision }).from(narrativeProjects).where(and(
            eq(narrativeProjects.bookId, bookId), eq(narrativeProjects.chapterIndex, index),
          )),
        ])
        const baseRevision = current?.revision ?? Math.max(legacyVoice?.revision ?? 0, legacyMusic?.revision ?? 0)
        const expected = parsed.data.expectedRevision
        if (expected !== undefined && expected !== null && baseRevision !== expected) return { conflict: baseRevision, project: null }
        const revision = baseRevision + 1
        const project = advancedDirectionProjectSchema.parse({
          ...parsed.data.project,
          version: ADVANCED_DIRECTION_VERSION,
          bookId,
          chapterIndex: index,
          revision,
          contentHash: hash,
          language: parsed.data.project.language,
          voiceProject: {
            ...parsed.data.project.voiceProject,
            bookId,
            chapterIndex: index,
            revision,
            contentHash: hash,
            language: parsed.data.project.language,
          },
          musicProject: {
            ...parsed.data.project.musicProject,
            bookId,
            chapterIndex: index,
            revision,
          },
        })
        // Usa la misma transacción. Con DB_POOL_MAX=1, consultar por la conexión
        // global desde aquí bloquearía la única conexión disponible.
        await assertPublishedMusicNodes(project, tx as any)
        const [saved] = await tx.insert(advancedDirectionProjects).values({
          bookId,
          chapterIndex: index,
          revision,
          contentHash: hash,
          data: project,
          createdBy: (req.user as any).id,
        }).onConflictDoUpdate({
          target: [advancedDirectionProjects.bookId, advancedDirectionProjects.chapterIndex],
          set: { revision, contentHash: hash, data: project, updatedAt: new Date() },
        }).returning()
        await tx.insert(speechProjects).values({
          bookId,
          chapterIndex: index,
          revision,
          contentHash: hash,
          data: project.voiceProject,
          createdBy: (req.user as any).id,
        }).onConflictDoUpdate({
          target: [speechProjects.bookId, speechProjects.chapterIndex],
          set: { revision, contentHash: hash, data: project.voiceProject, updatedAt: new Date() },
        })
        await tx.insert(narrativeProjects).values({
          bookId,
          chapterIndex: index,
          revision,
          data: project.musicProject,
          createdBy: (req.user as any).id,
        }).onConflictDoUpdate({
          target: [narrativeProjects.bookId, narrativeProjects.chapterIndex],
          set: { revision, data: project.musicProject, updatedAt: new Date() },
        })
        if (parsed.data.runRequestKey) await tx.update(directionAgentRuns).set({ status: "applied" })
          .where(and(
            eq(directionAgentRuns.requestKey, parsed.data.runRequestKey),
            eq(directionAgentRuns.userId, (req.user as any).id),
            eq(directionAgentRuns.status, "ready"),
          ))
        return { conflict: null, project: saved.data }
      })
      if (outcome.conflict !== null) return res.status(409).json({
        message: outcome.conflict === 0 ? "La partitura todavía no existe" : "La partitura cambió en otra sesión",
        revision: outcome.conflict,
      })
      res.json({ project: outcome.project })
    } catch (error) {
      console.error("Advanced direction save failed:", error)
      res.status(500).json({ message: error instanceof Error ? error.message : "No se pudo guardar la partitura avanzada" })
    }
  })
}
