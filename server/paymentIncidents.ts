import type { Express } from "express"
import { and, desc, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "./db"
import { requireAdmin } from "./auth"
import { rateLimit } from "./rateLimit"
import {
  authorEarnings,
  authorPayouts,
  paymentIncidents,
  tokenOrders,
  walletOrders,
} from "@shared/schema"

const INCIDENT_EVENTS = new Set([
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
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
  const amountCents = Number.isSafeInteger(Number(rawAmount)) ? Math.max(0, Number(rawAmount)) : 0
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

async function restoreUnencumberedPayment(executor: any, paymentRef: string) {
  const [otherOpen] = await executor.select({ id: paymentIncidents.id }).from(paymentIncidents).where(and(
    eq(paymentIncidents.paymentRef, paymentRef),
    eq(paymentIncidents.resolution, "open"),
  )).limit(1)
  if (otherOpen) return
  const [tokenOrder] = await executor.select().from(tokenOrders).where(eq(tokenOrders.paymentRef, paymentRef))
  if (tokenOrder) {
    await executor.update(tokenOrders).set({ status: "paid" }).where(eq(tokenOrders.id, tokenOrder.id))
    await executor.update(authorEarnings).set({ status: "accrued", payoutEligible: true }).where(and(
      eq(authorEarnings.orderId, tokenOrder.id),
      eq(authorEarnings.status, "reversed"),
    ))
  }
  await executor.update(walletOrders).set({ status: "paid" }).where(eq(walletOrders.paymentRef, paymentRef))
}

export async function recordPaymentIncident(event: any): Promise<boolean> {
  const input = paymentIncidentFromStripeEvent(event)
  if (!input) return false
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.objectId}))`)
    const [existingIncident] = await tx.select().from(paymentIncidents)
      .where(eq(paymentIncidents.providerObjectId, input.objectId))
    if (existingIncident && (
      existingIncident.occurredAt > input.occurredAt
      || (existingIncident.resolution === "funds_restored" && !input.fundsRestored)
    )) return
    const [tokenOrder] = await tx.select().from(tokenOrders).where(eq(tokenOrders.paymentRef, input.paymentRef))
    const [walletOrder] = await tx.select().from(walletOrders).where(eq(walletOrders.paymentRef, input.paymentRef))
    const resolution = input.fundsRestored ? "funds_restored" : "open"
    await tx.insert(paymentIncidents).values({
      providerEventId: input.eventId,
      providerObjectId: input.objectId,
      kind: input.kind,
      paymentRef: input.paymentRef,
      tokenOrderId: tokenOrder?.id || null,
      walletOrderId: walletOrder?.id || null,
      amountCents: input.amountCents,
      currency: input.currency,
      providerStatus: input.providerStatus,
      reason: input.reason,
      resolution,
      resolvedAt: input.fundsRestored ? new Date() : null,
      occurredAt: input.occurredAt,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: paymentIncidents.providerObjectId,
      set: {
        providerEventId: input.eventId,
        paymentRef: input.paymentRef,
        tokenOrderId: tokenOrder?.id || null,
        walletOrderId: walletOrder?.id || null,
        amountCents: input.amountCents,
        currency: input.currency,
        providerStatus: input.providerStatus,
        reason: input.reason,
        resolution,
        resolvedAt: input.fundsRestored ? new Date() : null,
        updatedAt: new Date(),
      },
    })

    if (input.fundsRestored) {
      await restoreUnencumberedPayment(tx, input.paymentRef)
      return
    }
    if (tokenOrder) {
      await tx.update(tokenOrders).set({ status: input.kind === "refund" ? "refunded" : "payment_attention" })
        .where(eq(tokenOrders.id, tokenOrder.id))
      const [earning] = await tx.select().from(authorEarnings).where(eq(authorEarnings.orderId, tokenOrder.id))
      if (earning?.status === "accrued") {
        await tx.update(authorEarnings).set({ status: "reversed", payoutEligible: false })
          .where(eq(authorEarnings.id, earning.id))
      } else if (earning) {
        await tx.update(authorEarnings).set({ payoutEligible: false }).where(eq(authorEarnings.id, earning.id))
        if (earning.payoutId) {
          await tx.update(authorPayouts).set({
            status: "attention",
            failureCode: `${input.kind}:${input.objectId}`.slice(0, 200),
            updatedAt: new Date(),
          }).where(eq(authorPayouts.id, earning.payoutId))
        }
      }
    }
    if (walletOrder) {
      await tx.update(walletOrders).set({ status: input.kind === "refund" ? "refunded" : "payment_attention" })
        .where(eq(walletOrders.id, walletOrder.id))
    }
  })
  return true
}

// Stripe no garantiza el orden de entrega entre checkout y disputas. Si una
// incidencia llegó primero, enlazarla justo después de confirmar el checkout
// aplica el mismo bloqueo económico sin depender de un reintento del webhook.
export async function reconcileOpenIncidentsForPayment(paymentRef: string): Promise<void> {
  if (!/^pi_[A-Za-z0-9]+$/.test(paymentRef)) return
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${paymentRef}))`)
    const incidents = await tx.select().from(paymentIncidents).where(and(
      eq(paymentIncidents.paymentRef, paymentRef),
      eq(paymentIncidents.resolution, "open"),
    ))
    if (!incidents.length) return
    const [tokenOrder] = await tx.select().from(tokenOrders).where(eq(tokenOrders.paymentRef, paymentRef))
    const [walletOrder] = await tx.select().from(walletOrders).where(eq(walletOrders.paymentRef, paymentRef))
    await tx.update(paymentIncidents).set({
      tokenOrderId: tokenOrder?.id || null,
      walletOrderId: walletOrder?.id || null,
      updatedAt: new Date(),
    }).where(and(eq(paymentIncidents.paymentRef, paymentRef), eq(paymentIncidents.resolution, "open")))
    const incident = incidents.find(row => row.kind === "refund") || incidents[0]
    if (tokenOrder) {
      await tx.update(tokenOrders).set({ status: incident.kind === "refund" ? "refunded" : "payment_attention" })
        .where(eq(tokenOrders.id, tokenOrder.id))
      const [earning] = await tx.select().from(authorEarnings).where(eq(authorEarnings.orderId, tokenOrder.id))
      if (earning?.status === "accrued") {
        await tx.update(authorEarnings).set({ status: "reversed", payoutEligible: false })
          .where(eq(authorEarnings.id, earning.id))
      } else if (earning?.payoutId) {
        await tx.update(authorEarnings).set({ payoutEligible: false }).where(eq(authorEarnings.id, earning.id))
        await tx.update(authorPayouts).set({
          status: "attention",
          failureCode: `${incident.kind}:${incident.providerObjectId}`.slice(0, 200),
          updatedAt: new Date(),
        }).where(eq(authorPayouts.id, earning.payoutId))
      }
    }
    if (walletOrder) {
      await tx.update(walletOrders).set({ status: incident.kind === "refund" ? "refunded" : "payment_attention" })
        .where(eq(walletOrders.id, walletOrder.id))
    }
  })
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
        await tx.execute(sql`select pg_advisory_xact_lock(73002, ${id})`)
        const [incident] = await tx.select().from(paymentIncidents).where(eq(paymentIncidents.id, id))
        if (!incident || incident.resolution !== "open") return null
        await tx.update(paymentIncidents).set({
          resolution: input.outcome,
          resolutionNote: input.note,
          adminUserId: (req.user as any).id,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(eq(paymentIncidents.id, id), eq(paymentIncidents.resolution, "open")))
        if (input.outcome === "funds_restored") {
          await restoreUnencumberedPayment(tx, incident.paymentRef)
        }
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
