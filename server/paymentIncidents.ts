import type { Express } from "express"
import { and, desc, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "./db"
import { requireAdmin } from "./auth"
import { rateLimit } from "./rateLimit"
import {
  authorEarnings,
  authorPayouts,
  bookTokens,
  walletLedger,
  paymentWebhookEvents,
  paymentIncidents,
  tokenOrders,
  walletOrders,
} from "@shared/schema"
import { paymentExposure, withheldTinta } from "@shared/payment-reconciliation"
import { syncOwnerUnlock } from "./licenseLifecycle"

const INCIDENT_EVENTS = new Set([
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
])

const RESTORED_DISPUTE_STATES = new Set(["won", "prevented", "warning_closed"])

function stripeRef(value: unknown, prefix: string): string {
  const candidate = typeof value === "string" ? value : String((value as any)?.id || "")
  return new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(candidate) ? candidate : ""
}

export type PaymentIncidentInput = {
  eventId: string
  objectId: string
  kind: "refund" | "dispute"
  paymentRef: string
  amountCents: number
  currency: string
  providerStatus: string
  reason: string
  occurredAt: Date
  fundsRestored: boolean
}

export function paymentIncidentFromStripeEvent(event: any): PaymentIncidentInput | null {
  if (!INCIDENT_EVENTS.has(String(event?.type || ""))) return null
  const eventId = stripeRef(event?.id, "evt")
  const object = event?.data?.object || {}
  const dispute = String(event.type).startsWith("charge.dispute.")
  const objectId = stripeRef(object.id, dispute ? "du" : "ch")
  const paymentRef = stripeRef(object.payment_intent, "pi")
  if (!eventId || !objectId || !paymentRef) return null
  const rawAmount = dispute ? object.amount : object.amount_refunded
  if (!Number.isSafeInteger(rawAmount) || rawAmount < 0 || !/^[a-z]{3}$/.test(String(object.currency))) return null
  const amountCents = rawAmount
  const providerStatus = String(dispute ? object.status : (object.refunded ? "refunded" : "partially_refunded")).slice(0, 80)
  return {
    eventId,
    objectId,
    kind: dispute ? "dispute" : "refund",
    paymentRef,
    amountCents,
    currency: String(object.currency || "mxn").toLowerCase().slice(0, 3),
    providerStatus,
    reason: String(dispute ? object.reason : "customer_refund").slice(0, 120),
    occurredAt: new Date(Math.max(0, Number(event.created || object.created || 0)) * 1_000 || Date.now()),
    fundsRestored: dispute && RESTORED_DISPUTE_STATES.has(providerStatus),
  }
}

// Lock order shared by checkout, webhook, reconciliation and manual resolution:
// payment -> wallet owner -> licence/copy. No network request can publish a
// temporarily spendable credit before previously received incidents are applied.
export async function lockPayment(executor: any, paymentRef: string) {
  await executor.execute(sql`select pg_advisory_xact_lock(73003, hashtext(${paymentRef}))`)
}

export async function reconcilePayment(executor: any, paymentRef: string): Promise<void> {
  await lockPayment(executor, paymentRef)
  const incidents = await executor.select().from(paymentIncidents)
    .where(eq(paymentIncidents.paymentRef, paymentRef))
  if (!incidents.length) return
  const [tokenOrder] = await executor.select().from(tokenOrders).where(eq(tokenOrders.paymentRef, paymentRef))
  const [walletOrder] = await executor.select().from(walletOrders).where(eq(walletOrders.paymentRef, paymentRef))
  await executor.update(paymentIncidents).set({
    tokenOrderId: tokenOrder?.id || null, walletOrderId: walletOrder?.id || null, updatedAt: new Date(),
  }).where(eq(paymentIncidents.paymentRef, paymentRef))

  if (walletOrder?.paidAt) {
    await executor.execute(sql`select pg_advisory_xact_lock(${walletOrder.userId})`)
    const exposure = paymentExposure(incidents, walletOrder.amountCents, "mxn")
    const units = withheldTinta(walletOrder.amount, walletOrder.amountCents, exposure.withheldCents)
    const previous = await executor.execute(sql`
      select coalesce(sum(delta), 0)::bigint as units, coalesce(sum(cash_backing_cents), 0)::bigint as cents
      from wallet_ledger where ref_type = 'wallet_order_adjustment' and ref_id = ${walletOrder.id}
    `)
    const delta = -units - Number(previous.rows[0].units)
    const cashBackingCents = -exposure.withheldCents - Number(previous.rows[0].cents)
    if (delta || cashBackingCents) {
      await executor.insert(walletLedger).values({
        userId: walletOrder.userId, currency: "tinta", delta, cashBackingCents,
        reason: "payment_adjustment", refType: "wallet_order_adjustment", refId: walletOrder.id,
      })
    }
    await executor.update(walletOrders).set({ status: exposure.status }).where(eq(walletOrders.id, walletOrder.id))
  }
  if (tokenOrder?.tokenId && tokenOrder.paidAt) {
    await executor.execute(sql`select pg_advisory_xact_lock(${tokenOrder.userId})`)
    const exposure = paymentExposure(incidents, tokenOrder.amountCents, tokenOrder.currency)
    await executor.update(tokenOrders).set({ status: exposure.status }).where(eq(tokenOrders.id, tokenOrder.id))
    await executor.update(bookTokens).set({ licenseStatus: exposure.licenseStatus }).where(eq(bookTokens.id, tokenOrder.tokenId))
    await syncOwnerUnlock(executor, tokenOrder.userId, tokenOrder.bookId)
    const [earning] = await executor.select().from(authorEarnings).where(eq(authorEarnings.orderId, tokenOrder.id))
    if (earning && exposure.licenseStatus !== "active") {
      await executor.update(authorEarnings).set({
        status: earning.status === "accrued" ? "reversed" : earning.status, payoutEligible: false,
      }).where(eq(authorEarnings.id, earning.id))
      if (earning.payoutId) {
        await executor.update(authorPayouts).set({
          status: "attention", failureCode: `payment:${paymentRef}`.slice(0, 200), updatedAt: new Date(),
        }).where(eq(authorPayouts.id, earning.payoutId))
      }
    } else if (earning?.status === "reversed" && !earning.payoutId) {
      await executor.update(authorEarnings).set({ status: "accrued", payoutEligible: tokenOrder.cashBackingCents > 0 })
        .where(eq(authorEarnings.id, earning.id))
    }
  }
}

// Disputes can be reopened and event.created has only second precision. Read
// the provider's current object under the payment lock instead of guessing an
// ordering from event timestamps or treating a terminal snapshot as permanent.
async function currentDispute(input: PaymentIncidentInput, event: any): Promise<PaymentIncidentInput> {
  const response = await fetch(`https://api.stripe.com/v1/disputes/${input.objectId}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error("No se pudo verificar la disputa en Stripe; se reintentará el aviso")
  const object = await response.json()
  const current = paymentIncidentFromStripeEvent({ ...event, data: { object } })
  if (!current || current.objectId !== input.objectId || current.paymentRef !== input.paymentRef) {
    throw new Error("La disputa de Stripe no coincide con el aviso")
  }
  return current
}

export async function recordPaymentIncident(event: any): Promise<boolean> {
  const parsed = paymentIncidentFromStripeEvent(event)
  if (!parsed) {
    if (INCIDENT_EVENTS.has(String(event?.type || ""))) throw new Error("Aviso de incidencia inválido")
    return false
  }
  let verificationPending = false
  await db.transaction(async tx => {
    await lockPayment(tx, parsed.paymentRef)
    const [receipt] = await tx.insert(paymentWebhookEvents).values({
      eventId: parsed.eventId, paymentRef: parsed.paymentRef,
    }).onConflictDoNothing().returning()
    if (!receipt) return
    let input = parsed
    if (parsed.kind === "dispute") {
      try { input = await currentDispute(parsed, event) } catch {
        // A provider outage cannot leave a disputed credit spendable. Apply a
        // temporary hold, but do not acknowledge/deduplicate this event yet.
        verificationPending = true
        input = { ...parsed, fundsRestored: false, providerStatus: "verification_pending" }
        await tx.delete(paymentWebhookEvents).where(eq(paymentWebhookEvents.eventId, parsed.eventId))
      }
    }
    const [existing] = await tx.select().from(paymentIncidents)
      .where(eq(paymentIncidents.providerObjectId, input.objectId))
    if (verificationPending && existing) input.amountCents = Math.max(input.amountCents, existing.amountCents)
    if (existing && (existing.paymentRef !== input.paymentRef || existing.currency !== input.currency)) {
      throw new Error("La incidencia cambió de pago o moneda")
    }
    // charge.refunded contains a cumulative total; an older delivery must not
    // undo a later refund, even when both notifications have the same timestamp.
    if (existing && input.kind === "refund" && input.amountCents <= existing.amountCents) {
      await reconcilePayment(tx, input.paymentRef)
      return
    }
    const changed = !existing || existing.amountCents !== input.amountCents || existing.providerStatus !== input.providerStatus
    const resolution = input.fundsRestored ? "funds_restored" : !changed && existing ? existing.resolution : "open"
    const values = {
      providerEventId: input.eventId, providerObjectId: input.objectId, kind: input.kind,
      paymentRef: input.paymentRef, amountCents: input.amountCents, currency: input.currency,
      providerStatus: input.providerStatus, reason: input.reason, resolution,
      occurredAt: input.occurredAt, updatedAt: new Date(),
      resolvedAt: resolution === "open" ? null : existing?.resolvedAt || new Date(),
      resolutionNote: changed ? "" : existing?.resolutionNote || "",
      adminUserId: changed ? null : existing?.adminUserId || null,
    }
    await tx.insert(paymentIncidents).values(values).onConflictDoUpdate({
      target: paymentIncidents.providerObjectId, set: values,
    })
    await reconcilePayment(tx, input.paymentRef)
  })
  if (verificationPending) throw new Error("Incidencia suspendida preventivamente; Stripe debe reintentar la verificación")
  return true
}

export async function hasOpenPaymentIncidents(executor: any = db): Promise<boolean> {
  const [row] = await executor.select({ id: paymentIncidents.id }).from(paymentIncidents)
    .where(eq(paymentIncidents.resolution, "open")).limit(1)
  return Boolean(row)
}

const resolutionSchema = z.object({
  outcome: z.enum(["funds_restored", "liability_reconciled"]),
  note: z.string().trim().min(3).max(500),
}).strict()

export function registerPaymentIncidentRoutes(app: Express) {
  app.get("/api/admin/payment-incidents", requireAdmin, async (_req, res) => {
    const incidents = await db.select().from(paymentIncidents)
      .orderBy(desc(paymentIncidents.createdAt)).limit(200)
    res.setHeader("Cache-Control", "no-store")
    res.json({ incidents })
  })

  app.post("/api/admin/payment-incidents/:id/resolve", requireAdmin, rateLimit(60_000, 10), async (req, res) => {
    try {
      const id = Number(req.params.id)
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ message: "Incidencia inválida" })
      const input = resolutionSchema.parse(req.body)
      const resolved = await db.transaction(async tx => {
        const [candidate] = await tx.select().from(paymentIncidents).where(eq(paymentIncidents.id, id))
        if (!candidate) return null
        await lockPayment(tx, candidate.paymentRef)
        const [incident] = await tx.select().from(paymentIncidents).where(eq(paymentIncidents.id, id))
        if (!incident || incident.resolution !== "open") return null
        await tx.update(paymentIncidents).set({
          resolution: input.outcome,
          resolutionNote: input.note,
          adminUserId: (req.user as any).id,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(eq(paymentIncidents.id, id), eq(paymentIncidents.resolution, "open")))
        await reconcilePayment(tx, incident.paymentRef)
        return incident
      })
      if (!resolved) return res.status(409).json({ message: "La incidencia ya fue resuelta o no existe" })
      res.json({ ok: true })
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message || "Datos inválidos" })
      res.status(500).json({ message: "No se pudo resolver la incidencia" })
    }
  })
}
