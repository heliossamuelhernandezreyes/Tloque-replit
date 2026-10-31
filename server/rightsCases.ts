import { randomUUID } from "node:crypto"
import type { Express } from "express"
import { and, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { books, bookRevisions, notifications } from "@shared/schema"
import { db } from "./db"
import { requireAdmin } from "./auth"
import { rateLimit } from "./rateLimit"
import { bookAcceptance } from "./legal"
import { publicationWorkHash } from "./editionFingerprint"

const noticeSchema = z.object({
  bookId: z.number().int().positive(), name: z.string().trim().min(2).max(200),
  email: z.string().trim().email().max(254), work: z.string().trim().min(10).max(2000),
  location: z.string().trim().min(5).max(2000), rightsBasis: z.string().trim().min(20).max(4000),
  goodFaith: z.literal(true),
}).strict()
const counterSchema = z.object({ publicId: z.string().uuid(), evidence: z.string().trim().min(20).max(6000), authorized: z.literal(true) }).strict()
const decisionSchema = z.object({
  expectedStatus: z.enum(["received", "removed", "counter_received", "counter_notified", "proceedings", "restored", "rejected", "closed"]),
  action: z.enum(["removed", "counter_notified", "proceedings", "restored", "rejected", "closed"]),
  note: z.string().trim().min(10).max(4000), reference: z.string().trim().max(2000).default(""),
  notifiedAt: z.string().datetime({ offset: true }).optional(), deadlineAt: z.string().datetime({ offset: true }).optional(),
  resolutionConfirmed: z.boolean().default(false),
}).strict()

// This is only a minimum. The reviewer must extend it for the applicable
// holidays/suspensions and retain the calendar used; no automatic restoration.
export function minimumCounterDeadline(notifiedAt: Date) {
  const result = new Date(notifiedAt)
  for (let days = 0; days < 15;) {
    result.setUTCDate(result.getUTCDate() + 1)
    if (result.getUTCDay() !== 0 && result.getUTCDay() !== 6) days++
  }
  return result
}

export async function commercialApproval(bookId: number, acceptanceId: number, workHash: string, tx: any) {
  const result = await tx.execute(sql`select action from commercial_approvals
    where book_id=${bookId} and acceptance_id=${acceptanceId} and work_hash=${workHash}
    order by id desc limit 1`)
  return result.rows[0]?.action === "approve"
}

export function registerRightsRoutes(app: Express, database: any = db) {
  app.post("/api/rights/notices", rateLimit(3_600_000, 5, "rights-notices"), async (req, res, next) => {
    try {
      const parsed = noticeSchema.safeParse(req.body)
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message })
      const input = parsed.data
      const result = await database.transaction(async (tx: any) => {
        const [book] = await tx.select().from(books).where(eq(books.id, input.bookId))
        if (!book) return null
        const publicId = randomUUID()
        const inserted = await tx.execute(sql`insert into copyright_cases
          (public_id,book_id,author_id,claimant_name,claimant_email,work_description,location,rights_basis)
          values (${publicId},${book.id},${book.authorId},${input.name},${input.email},${input.work},${input.location},${input.rightsBasis}) returning id,created_at`)
        await tx.execute(sql`insert into copyright_case_events(case_id,actor_id,action,note)
          values (${inserted.rows[0].id},${req.isAuthenticated() ? (req.user as any).id : null},'received','Aviso recibido con declaración afirmativa de buena fe; requiere verificación y atención expedita.')`)
        return { folio: publicId, receivedAt: inserted.rows[0].created_at, status: "received" }
      })
      if (!result) return res.status(404).json({ message: "No se encuentra la obra indicada." })
      res.setHeader("Cache-Control", "no-store")
      res.status(201).json({ ...result, message: "Aviso recibido. Conserva el folio. La recepción no determina quién tiene razón ni ejecuta por sí sola una retirada." })
    } catch (error) { next(error) }
  })

  app.get("/api/rights/cases/mine", async (req, res, next) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    try {
      const result = await database.execute(sql`select public_id,book_id,status,created_at,deadline_at,work_description,location,rights_basis
        from copyright_cases where author_id=${(req.user as any).id} order by id desc limit 100`)
      res.setHeader("Cache-Control", "private, no-store"); res.json(result.rows)
    } catch (error) { next(error) }
  })

  app.post("/api/rights/counter-notices", rateLimit(3_600_000, 10), async (req, res, next) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
    const parsed = counterSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: "Indica el folio, tu autorización y la evidencia del contraaviso." })
    try {
      const result = await database.transaction(async (tx: any) => {
        const found = await tx.execute(sql`select book_id from copyright_cases where public_id=${parsed.data.publicId} and author_id=${(req.user as any).id}`)
        if (!found.rows[0]) return { code: 404 }
        await tx.select().from(books).where(eq(books.id, found.rows[0].book_id)).for("update")
        const row = await tx.execute(sql`select * from copyright_cases where public_id=${parsed.data.publicId} for update`)
        if (row.rows[0].status !== "removed") return { code: 409 }
        await tx.execute(sql`update copyright_cases set status='counter_received',counter_notice=${JSON.stringify({ evidence: parsed.data.evidence, authorized: true, actorId: (req.user as any).id, receivedAt: new Date().toISOString() })}::jsonb,updated_at=now() where id=${row.rows[0].id}`)
        await tx.execute(sql`insert into copyright_case_events(case_id,actor_id,action,note) values (${row.rows[0].id},${(req.user as any).id},'counter_received','Contraaviso recibido; pendiente de revisión y notificación al reclamante.')`)
        return { code: 201 }
      })
      res.status(result.code).json({ message: result.code === 201 ? "Contraaviso registrado. No restaura automáticamente el contenido ni acredita que se haya notificado al reclamante." : "Expediente no disponible para esta actuación." })
    } catch (error) { next(error) }
  })

  app.get("/api/admin/rights", requireAdmin, async (_req, res, next) => {
    try {
      const [cases, approvals] = await Promise.all([
        database.execute(sql`select * from copyright_cases order by id desc limit 100`),
        database.execute(sql`select * from commercial_approvals order by id desc limit 100`),
      ])
      res.setHeader("Cache-Control", "private, no-store"); res.json({ cases: cases.rows, approvals: approvals.rows })
    } catch (error) { next(error) }
  })
  app.get("/api/admin/rights/cases/:id/events", requireAdmin, async (req, res, next) => {
    const id = Number(req.params.id)
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: "Expediente inválido" })
    try {
      const events = await database.execute(sql`select * from copyright_case_events where case_id=${id} order by id`)
      res.setHeader("Cache-Control", "private, no-store"); res.json(events.rows)
    } catch (error) { next(error) }
  })

  app.post("/api/admin/rights/approvals", requireAdmin, async (req, res, next) => {
    const parsed = z.object({ bookId: z.number().int().positive(), revision: z.number().int().positive(), action: z.enum(["approve", "withdraw"]), agreementRef: z.string().trim().min(5).max(2000), evidenceRef: z.string().trim().min(5).max(2000), confirmedRightsAndAgreement: z.literal(true) }).strict().safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: "Identifica la versión, el acuerdo efectivo y la evidencia revisada." })
    try {
      const result = await database.transaction(async (tx: any) => {
        const [book] = await tx.select().from(books).where(and(eq(books.id, parsed.data.bookId), eq(books.revision, parsed.data.revision))).for("update")
        if (!book || book.rightsHold) return false
        const permission = await bookAcceptance(book, tx)
        if (!permission?.choices.monetization || !permission.choices.permanentDigital || !permission.choices.offline) return false
        await tx.execute(sql`insert into commercial_approvals(book_id,acceptance_id,work_hash,actor_id,action,agreement_ref,evidence_ref)
          values (${book.id},${permission.receipt.id},${publicationWorkHash(book)},${(req.user as any).id},${parsed.data.action},${parsed.data.agreementRef},${parsed.data.evidenceRef})`)
        return true
      })
      res.status(result ? 201 : 409).json({ message: result ? "Revisión registrada. El registro no acredita por sí solo un permiso de autoridad." : "La versión cambió, está bloqueada o aún faltan permisos expresos del titular." })
    } catch (error) { next(error) }
  })

  app.patch("/api/admin/rights/cases/:id", requireAdmin, async (req, res, next) => {
    const id = Number(req.params.id), parsed = decisionSchema.safeParse(req.body)
    if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) return res.status(400).json({ message: "Actuación inválida" })
    const input = parsed.data
    try {
      const result = await database.transaction(async (tx: any) => {
        const found = await tx.execute(sql`select book_id from copyright_cases where id=${id}`)
        if (!found.rows[0]) return { code: 404, message: "Expediente no encontrado" }
        const [book] = await tx.select().from(books).where(eq(books.id, found.rows[0].book_id)).for("update")
        const locked = await tx.execute(sql`select * from copyright_cases where id=${id} for update`), row = locked.rows[0]
        if (row.status !== input.expectedStatus) return { code: 409, message: "El expediente cambió; actualiza la bandeja." }
        const allowed: Record<string, string[]> = {
          received: ["removed", "rejected", "closed"], removed: ["proceedings", "restored"],
          counter_received: ["counter_notified", "proceedings", "restored"], counter_notified: ["proceedings", "restored"],
          proceedings: ["restored"], restored: ["closed"], rejected: ["closed"], closed: [],
        }
        if (!allowed[row.status]?.includes(input.action)) return { code: 409, message: "La actuación no corresponde al estado del expediente." }
        if (["counter_notified", "proceedings"].includes(input.action) && input.reference.length < 5) return { code: 400, message: "Registra la evidencia de entrega o el procedimiento iniciado." }
        if (input.action === "counter_notified") {
          if (!input.notifiedAt || !input.deadlineAt || Date.parse(input.notifiedAt) > Date.now() || Date.parse(input.deadlineAt) < minimumCounterDeadline(new Date(input.notifiedAt)).getTime()) return { code: 400, message: "Registra la entrega efectuada y al menos 15 días de lunes a viernes; amplía el vencimiento por festivos o suspensiones del calendario aplicable." }
          await tx.execute(sql`update copyright_cases set notified_at=${new Date(input.notifiedAt)},deadline_at=${new Date(input.deadlineAt)} where id=${id}`)
        }
        if (input.action === "proceedings") await tx.execute(sql`update copyright_cases set proceeding_ref=${input.reference} where id=${id}`)
        if (input.action === "removed") {
          const previousHold = book.rightsHold ? await tx.execute(sql`select prior_status from copyright_cases
            where book_id=${book.id} and prior_status is not null and status in ('removed','counter_received','counter_notified','proceedings') order by id limit 1`) : null
          const priorStatus = previousHold?.rows[0]?.prior_status ?? book.status
          await tx.execute(sql`update copyright_cases set prior_status=${priorStatus},held_work_hash=${publicationWorkHash(book)} where id=${id}`)
          const [held] = await tx.update(books).set({ rightsHold: true, status: "review", revision: sql`${books.revision}+1`, updatedAt: new Date() }).where(eq(books.id, book.id)).returning()
          await tx.insert(bookRevisions).values({ bookId: held.id, revision: held.revision, snapshot: held, changeType: "unpublish", createdBy: (req.user as any).id })
          if (row.author_id) await tx.insert(notifications).values({ userId: row.author_id, kind: "system", title: "Reclamación de derechos", body: `Se retiró la obra ${book.id} para revisión. Folio ${row.public_id}. Consulta Derechos de autor para ver el aviso y presentar un contraaviso.`, destination: "/rights", dedupeKey: `rights-removed:${id}` }).onConflictDoNothing()
        }
        if (input.action === "restored") {
          const resolved = input.resolutionConfirmed && input.reference.length >= 5
          if (!resolved && (!row.counter_notice || !row.notified_at || !row.deadline_at || new Date(row.deadline_at).getTime() > Date.now() || row.proceeding_ref)) return { code: 409, message: "El plazo no ha terminado, falta una notificación o existe un procedimiento. Otra vía de restauración necesita la resolución o retirada del reclamante documentada." }
          if (publicationWorkHash(book) !== row.held_work_hash) return { code: 409, message: "El contenido cambió durante la reclamación; revisa la nueva versión antes de retirar el bloqueo." }
          const others = await tx.execute(sql`select id from copyright_cases where book_id=${book.id} and id<>${id} and status in ('removed','counter_received','counter_notified','proceedings') limit 1`)
          if (!others.rows.length) {
            const [restored] = await tx.update(books).set({ rightsHold: false, status: book.status === "review" ? row.prior_status || "draft" : book.status, revision: sql`${books.revision}+1`, updatedAt: new Date() }).where(eq(books.id, book.id)).returning()
            await tx.insert(bookRevisions).values({ bookId: restored.id, revision: restored.revision, snapshot: restored, changeType: "restore", createdBy: (req.user as any).id })
          }
        }
        await tx.execute(sql`update copyright_cases set status=${input.action},updated_at=now() where id=${id}`)
        await tx.execute(sql`insert into copyright_case_events(case_id,actor_id,action,note) values (${id},${(req.user as any).id},${input.action},${input.note + (input.reference ? " Referencia: " + input.reference : "")})`)
        return { code: 200, message: "Actuación registrada." }
      })
      res.status(result.code).json({ message: result.message })
    } catch (error) { next(error) }
  })
}
