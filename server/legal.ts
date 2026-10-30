import { createHash, randomUUID } from "node:crypto"
import type { Express, RequestHandler } from "express"
import { Router } from "express"
import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "./db"
import { books, legalAcceptances, privacyRequests, privacyRequestEvents } from "@shared/schema"
import { legalDocuments, LEGAL_VERSION, publicationAcceptanceSchema, privacyRequestSchema, type PublicationAcceptance, type RightsOption } from "@shared/legal"
import { legalConfiguration } from "./legalConfig"
import { hasCapability, requireAdmin } from "./auth"
import { rateLimit } from "./rateLimit"

export class LegalRequirementError extends Error {
  constructor(message: string, public readonly code = "LEGAL_ACCEPTANCE_REQUIRED", public readonly status = 428) { super(message) }
}
export function publicLegalBundle() {
  const config = legalConfiguration()
  const documents = legalDocuments(config.operator)
  const hash = createHash("sha256").update(JSON.stringify(documents)).digest("hex")
  return { version: LEGAL_VERSION, hash, documents, operator: config.operator,
    identityReady: config.identityReady, publicationReady: config.publicationReady,
    commercialReady: config.commercialReady, gachaReady: config.gachaReady }
}

type Executor = Pick<typeof db, "insert" | "select">
export function publicationWorkHash(book: typeof books.$inferSelect) {
  return createHash("sha256").update(JSON.stringify({
    id: book.id, authorId: book.authorId, title: book.title, author: book.author, type: book.type,
    content: book.content, chapters: book.chapters, coverUrl: book.coverUrl, coverFx: book.coverFx,
    backCoverUrl: book.backCoverUrl, premiumCoverUrl: book.premiumCoverUrl, premiumBackUrl: book.premiumBackUrl,
  })).digest("hex")
}
export async function recordPublicationAcceptance(tx: Executor, book: typeof books.$inferSelect, actorId: number | null | undefined, input?: PublicationAcceptance, previous?: typeof books.$inferSelect) {
  if (book.status !== "published") return
  // A comment preference/operational update does not manufacture new consent.
  // Content, ownership, category or artwork changes require another acceptance.
  if (!input && previous?.status === "published" && publicationWorkHash(previous) === publicationWorkHash(book)) return
  const bundle = publicLegalBundle()
  if (!bundle.publicationReady) throw new LegalRequirementError("La publicación necesita completar los datos del responsable y su revisión de condiciones. Tu borrador puede conservarse.", "LEGAL_SETUP_REQUIRED", 503)
  const parsed = publicationAcceptanceSchema.safeParse(input)
  if (!actorId || !parsed.success) throw new LegalRequirementError("Revisa y confirma los derechos de esta versión antes de publicarla.")
  const acceptance = parsed.data
  if (acceptance.documentHash !== bundle.hash) throw new LegalRequirementError("Las condiciones cambiaron. Vuelve a leerlas antes de confirmar.", "LEGAL_DOCUMENT_CHANGED", 409)
  if (book.authorId !== actorId && acceptance.origin === "original") {
    throw new LegalRequirementError("Para publicar una obra de otra persona debes documentar el permiso o la versión de dominio público.")
  }
  const workHash = publicationWorkHash(book)
  await tx.insert(legalAcceptances).values({
    userId: actorId, bookId: book.id, bookRevision: book.revision, documentVersion: bundle.version,
    documentHash: bundle.hash, documents: bundle.documents, workHash,
    declaration: { ...acceptance, workTitle: book.title, economicCategory: book.type, authorShareBps: book.type === "story" ? 5000 : 9000 },
  })
}

export async function hasBookRight(bookId: number, revision: number, right: RightsOption, executor: Pick<typeof db, "select"> = db) {
  const [book] = await executor.select().from(books).where(and(eq(books.id, bookId), eq(books.revision, revision))).limit(1)
  if (!book) return false
  const [receipt] = await executor.select({ declaration: legalAcceptances.declaration }).from(legalAcceptances)
    .where(and(eq(legalAcceptances.bookId, bookId), eq(legalAcceptances.workHash, publicationWorkHash(book))))
    .orderBy(desc(legalAcceptances.id)).limit(1)
  const parsed = publicationAcceptanceSchema.safeParse(receipt?.declaration && typeof receipt.declaration === "object"
    ? Object.fromEntries(Object.entries(receipt.declaration).filter(([key]) => !["economicCategory", "authorShareBps", "workTitle"].includes(key))) : undefined)
  return parsed.success && parsed.data.choices[right] === true
}

/** Checks are server-side and do not touch valid deliveries/webhooks or free reading. */
export function createLegalFeatureBoundary(database: typeof db = db): RequestHandler {
  // Use Express's own route matcher, including decoded params, case and final
  // slashes, so an alternate spelling cannot skip a check on the same endpoint.
  const boundary = Router()
  boundary.post(["/api/tokens/acquire", "/api/wallet/buy", "/api/cards/:id/buy", "/api/frames/:id/buy"], (_req, res, next) => {
    if (!legalConfiguration().commercialReady) {
      return res.status(503).json({ code: "COMMERCIAL_REVIEW_PENDING", message: "Las nuevas compras siguen pendientes de habilitación comercial. Tus adquisiciones anteriores se conservan." })
    }
    next()
  })
  boundary.post(["/api/books/:id/audiobook/:chapterIndex/request", "/api/books/:id/speech/:chapterIndex/publish"], async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const bookId = Number(req.params.id), chapterIndex = Number(req.params.chapterIndex)
      if (!Number.isSafeInteger(bookId) || bookId < 1 || !Number.isSafeInteger(chapterIndex) || chapterIndex < 0) {
        return res.status(400).json({ message: "Capítulo inválido" })
      }
      const [book] = await database.select().from(books).where(eq(books.id, bookId))
      if (!book || (book.status !== "published" && book.authorId !== (req.user as any).id && !hasCapability(req.user, "manageCatalog"))) {
        return res.status(404).json({ message: "Libro no encontrado" })
      }
      if (!await hasBookRight(book.id, book.revision, "audio", database)) {
        return res.status(428).json({ code: "AUDIO_RIGHTS_REQUIRED", message: "El titular debe autorizar el audio para esta versión antes de ofrecerlo a lectores." })
      }
      next()
    } catch (error) { next(error) }
  })
  return boundary
}

export function registerLegalRoutes(app: Express, database: typeof db = db) {
  app.use(createLegalFeatureBoundary(database))
  app.get("/api/legal/documents", (_req, res) => {
    res.setHeader("Cache-Control", "no-store")
    res.json(publicLegalBundle())
  })
  app.get("/api/legal/receipts", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      res.setHeader("Cache-Control", "private, no-store")
      res.json(await database.select().from(legalAcceptances).where(eq(legalAcceptances.userId, (req.user as any).id)).orderBy(desc(legalAcceptances.id)).limit(100))
    } catch (error) { next(error) }
  })
  app.post("/api/privacy/requests", rateLimit(60 * 60_000, 5, "privacy-requests"), async (req, res, next) => {
    try {
      const parsed = privacyRequestSchema.safeParse(req.body)
      if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message })
      const userId = req.isAuthenticated() ? (req.user as any).id : null
      const received = await database.transaction(async tx => {
        const [row] = await tx.insert(privacyRequests).values({ ...parsed.data, publicId: randomUUID(), userId }).returning()
        await tx.insert(privacyRequestEvents).values({ requestId: row.id, actorId: userId, status: "received", note: "Solicitud recibida; identidad y alcance pendientes de verificar." })
        return row
      })
      res.setHeader("Cache-Control", "no-store")
      // The public UUID cannot be used to retrieve personal details.
      res.status(201).json({ folio: received.publicId, receivedAt: received.createdAt, status: "received",
        message: "Solicitud recibida. La atención requiere verificar tu identidad y alcance; no se ha ejecutado ninguna eliminación ni entrega de datos." })
    } catch (error) { next(error) }
  })
  app.get("/api/admin/privacy/requests", requireAdmin, async (_req, res, next) => {
    try {
      res.setHeader("Cache-Control", "private, no-store")
      res.json(await database.select().from(privacyRequests).orderBy(desc(privacyRequests.id)).limit(100))
    } catch (error) { next(error) }
  })
  app.patch("/api/admin/privacy/requests/:id", requireAdmin, rateLimit(60_000, 20), async (req, res, next) => {
    try {
      const id = Number(req.params.id)
      const parsed = z.object({ status: z.enum(["verification", "processing", "answered", "closed"]), note: z.string().trim().min(5).max(2000) }).strict().safeParse(req.body)
      if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) return res.status(400).json({ message: "Estado o nota inválidos" })
      const row = await database.transaction(async tx => {
        const [changed] = await tx.update(privacyRequests).set({ status: parsed.data.status, updatedAt: new Date() }).where(eq(privacyRequests.id, id)).returning()
        if (!changed) return null
        await tx.insert(privacyRequestEvents).values({ requestId: id, actorId: (req.user as any).id, ...parsed.data })
        return changed
      })
      if (!row) return res.status(404).json({ message: "Solicitud no encontrada" })
      res.json(row)
    } catch (error) { next(error) }
  })
}
