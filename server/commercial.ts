import { createHash } from "node:crypto"
import type { Express } from "express"
import { and, desc, eq, lt, sql } from "drizzle-orm"
import { z } from "zod"
import { authorEarnings, books, tokenOrders } from "@shared/schema"
import { COMMERCE_VERSION, commercialText, settlementWindow } from "@shared/commerce"
import { bookAcceptance, LegalRequirementError, publicationWorkHash } from "./legal"
import { legalConfiguration } from "./legalConfig"
import { payoutHoldDays, payoutMinimumCents } from "./payouts"
import { priceFor, economySnapshotForBook } from "./payments"
import { db } from "./db"
import { requireAdmin } from "./auth"
import { rateLimit } from "./rateLimit"

export const hashEconomicTerms = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")

export async function commercialOffer(book: typeof books.$inferSelect, tx: any) {
  const permission = await bookAcceptance(book, tx)
  if (!permission?.choices.monetization || !permission.choices.permanentDigital || !permission.choices.offline || book.rightsHold) throw new LegalRequirementError("Faltan permisos de la edición antes de preparar su acuerdo comercial.")
  const config = legalConfiguration()
  if (!config.publicationReady) throw new LegalRequirementError("Faltan datos reales del responsable y revisión de publicación.", "LEGAL_SETUP_REQUIRED", 503)
  const terms = {
    version: COMMERCE_VERSION, operator: config.operator, bookId: book.id, title: book.title, author: book.author,
    workHash: publicationWorkHash(book), acceptanceId: permission.receipt.id,
    authorShareBps: economySnapshotForBook(book).authorShareBps, supportUnits: priceFor("support", book).tinta,
    holdDays: payoutHoldDays(), minimumCents: payoutMinimumCents(),
    rights: permission.choices,
  }
  const document = { ...terms, text: commercialText(terms) }
  return { document, hash: hashEconomicTerms(document) }
}

export async function currentCommercialAgreement(book: typeof books.$inferSelect, tx: any) {
  const offer = await commercialOffer(book, tx)
  const result = await tx.execute(sql`select * from commercial_agreements where book_id=${book.id} and author_id=${book.authorId}
    and acceptance_id=${offer.document.acceptanceId} and terms_hash=${offer.hash} order by id desc limit 1`)
  return { ...offer, receipt: result.rows[0] || null }
}

export async function reviewedCommercialAgreement(bookId: number, acceptanceId: number, workHash: string, tx: any) {
  const [book] = await tx.select().from(books).where(eq(books.id, bookId))
  if (!book || book.rightsHold || publicationWorkHash(book) !== workHash) return null
  let current: Awaited<ReturnType<typeof currentCommercialAgreement>>
  try { current = await currentCommercialAgreement(book, tx) } catch (error) { if (error instanceof LegalRequirementError) return null; throw error }
  if (!current.receipt || current.document.acceptanceId !== acceptanceId) return null
  const result = await tx.execute(sql`select action,commercial_agreement_id from commercial_approvals
    where book_id=${bookId} and acceptance_id=${acceptanceId} and work_hash=${workHash} order by id desc limit 1`)
  return result.rows[0]?.action === "approve" && result.rows[0].commercial_agreement_id === current.receipt.id ? current : null
}

export function registerCommercialRoutes(app: Express, database: any = db) {
  app.get("/api/commercial/statement", async (req, res, next) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const before = req.query.before === undefined ? null : Number(req.query.before)
    if (before !== null && (!Number.isSafeInteger(before) || before < 1)) return res.status(400).json({ message: "Página inválida" })
    try {
      const rows = await database.select({ earning: authorEarnings, order: tokenOrders }).from(authorEarnings)
        .innerJoin(tokenOrders, eq(tokenOrders.id, authorEarnings.orderId))
        .where(and(eq(authorEarnings.authorUserId, (req.user as any).id), before ? lt(authorEarnings.id, before) : sql`true`))
        .orderBy(desc(authorEarnings.id)).limit(100)
      const defaults = { holdDays: payoutHoldDays(), minimumCents: payoutMinimumCents() }
      const entries = rows.map(({ earning, order }: any) => ({ ...earning, provider: order.provider, kind: order.kind,
        economics: order.purchaseTerms?.economics || null,
        settlement: settlementWindow(earning.createdAt, order.purchaseTerms?.economics, defaults) }))
      res.setHeader("Cache-Control", "private, no-store"); res.json({ entries, nextCursor: rows.length === 100 ? rows[99].earning.id : null })
    } catch (error) { next(error) }
  })
  app.get("/api/commercial/agreements/mine", async (req, res, next) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    try {
      const rows = await database.execute(sql`select * from commercial_agreements where author_id=${(req.user as any).id} order by id desc limit 100`)
      res.setHeader("Cache-Control", "private, no-store"); res.json(rows.rows)
    } catch (error) { next(error) }
  })
  const showAgreement = (admin = false): import("express").RequestHandler => async (req, res, next) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    try {
      const id = Number(req.params.bookId)
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: "Obra inválida" })
      const [book] = await database.select().from(books).where(eq(books.id, id))
      if (!book || (!admin && book.authorId !== (req.user as any).id)) return res.status(404).json({ message: "Obra no disponible" })
      res.setHeader("Cache-Control", "private, no-store"); res.json(await currentCommercialAgreement(book, database))
    } catch (error) { next(error) }
  }
  app.get("/api/commercial/agreements/:bookId", showAgreement())
  app.get("/api/admin/rights/agreements/:bookId", requireAdmin, showAgreement(true))
  app.post("/api/commercial/agreements/:bookId/accept", rateLimit(60_000, 10), async (req, res, next) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const parsed = z.object({ accepted: z.literal(true), termsHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(req.body)
    const id = Number(req.params.bookId)
    if (!parsed.success || !Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: "Lee y acepta el acuerdo identificado." })
    try {
      const result = await database.transaction(async (tx: any) => {
        const [book] = await tx.select().from(books).where(eq(books.id, id)).for("update")
        if (!book || book.authorId !== (req.user as any).id) return { code: 404 }
        const offer = await currentCommercialAgreement(book, tx)
        if (offer.hash !== parsed.data.termsHash) return { code: 409 }
        const receipt = offer.receipt || (await tx.execute(sql`insert into commercial_agreements(book_id,author_id,acceptance_id,work_hash,terms_hash,terms)
          values (${book.id},${book.authorId},${offer.document.acceptanceId},${offer.document.workHash},${offer.hash},${JSON.stringify(offer.document)}::jsonb) returning *`)).rows[0]
        return { code: 201, receipt }
      })
      res.setHeader("Cache-Control", "private, no-store")
      res.status(result.code).json(result.receipt || { message: result.code === 409 ? "El acuerdo cambió; vuelve a leerlo." : "Obra no disponible" })
    } catch (error) { next(error) }
  })
}
