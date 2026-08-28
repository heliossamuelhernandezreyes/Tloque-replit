import type { Express } from "express"
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm"
import { db } from "./db"
import {
  authorEarnings,
  authorPayoutAccounts,
  authorPayouts,
  users,
} from "@shared/schema"
import { isSafeHttpsUrl } from "@shared/media"
import { requireAdmin } from "./auth"
import { rateLimit } from "./rateLimit"
import { publicOriginForRequest } from "./security"
import { stripeForm, verifyStripeWebhook } from "./payments"
import { hasOpenPaymentIncidents } from "./paymentIncidents"

const ACTIVE_PAYOUT_STATES = ["requested", "processing", "processing_unknown"]

export function payoutSystemEnabled(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY
    && process.env.STRIPE_CONNECT_WEBHOOK_SECRET
    && process.env.STRIPE_CONNECT_ENABLED === "true"
    && process.env.PAYOUTS_READY === "true",
  )
}

export function payoutHoldDays(): number {
  const parsed = Number(process.env.PAYOUT_HOLD_DAYS || 30)
  if (!Number.isFinite(parsed)) return 30
  return Math.max(7, Math.min(180, Math.floor(parsed)))
}

export function payoutMinimumCents(): number {
  const parsed = Number(process.env.PAYOUT_MIN_CENTS || 10_000)
  if (!Number.isFinite(parsed)) return 10_000
  return Math.max(1_000, Math.min(10_000_000, Math.floor(parsed)))
}

export class StripeConnectError extends Error {
  constructor(message: string, public readonly definitive: boolean, public readonly code = "stripe_error") {
    super(message)
  }
}

async function stripeConnectRequest<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: Record<string, unknown>; idempotencyKey?: string } = {},
): Promise<T> {
  const secret = String(process.env.STRIPE_SECRET_KEY || "")
  if (!secret) throw new StripeConnectError("Stripe no está configurado", true, "not_configured")
  let response: Response
  try {
    response = await fetch(`https://api.stripe.com${path}`, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
        ...(options.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: options.body ? stripeForm(options.body).join("&") : undefined,
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    throw new StripeConnectError(
      error instanceof Error ? error.message : "No se pudo contactar a Stripe",
      false,
      "network_unknown",
    )
  }
  const payload: any = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new StripeConnectError(
      String(payload?.error?.message || "Stripe rechazó la operación"),
      response.status < 500 && response.status !== 429,
      String(payload?.error?.code || payload?.error?.type || "stripe_rejected"),
    )
  }
  return payload as T
}

type StripeAccount = {
  id: string
  country?: string
  default_currency?: string
  details_submitted?: boolean
  payouts_enabled?: boolean
  capabilities?: { transfers?: string }
  requirements?: { currently_due?: string[]; disabled_reason?: string | null }
}

export function payoutAccountSnapshot(account: StripeAccount) {
  const requirementsDue = Array.isArray(account.requirements?.currently_due)
    ? account.requirements!.currently_due!.filter(value => typeof value === "string").slice(0, 100)
    : []
  return {
    country: String(account.country || "").slice(0, 2).toUpperCase(),
    currency: String(account.default_currency || "mxn").slice(0, 3).toLowerCase(),
    detailsSubmitted: account.details_submitted === true,
    payoutsEnabled: account.payouts_enabled === true,
    transfersActive: account.capabilities?.transfers === "active",
    disabledReason: String(account.requirements?.disabled_reason || "").slice(0, 200),
    requirementsDue,
  }
}

export function payoutAccountReady(account: StripeAccount): boolean {
  const state = payoutAccountSnapshot(account)
  return state.detailsSubmitted
    && state.payoutsEnabled
    && state.transfersActive
    && !state.disabledReason
}

async function createStripeAccount(user: { id: number; email: string }): Promise<StripeAccount> {
  return stripeConnectRequest<StripeAccount>("/v1/accounts", {
    method: "POST",
    idempotencyKey: `tloque-connect-account-${user.id}`,
    // No se fija país aquí: es inmutable y debe escogerlo el titular durante
    // el onboarding de Stripe. Las capacidades se configuran en Connect.
    body: {
      type: "express",
      email: user.email,
      "metadata[tloque_user_id]": String(user.id),
      "business_profile[product_description]": "Royalties de obras literarias publicadas en Tloque",
    },
  })
}

async function retrieveStripeAccount(accountId: string): Promise<StripeAccount> {
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) {
    throw new StripeConnectError("Cuenta Stripe inválida", true, "invalid_account")
  }
  return stripeConnectRequest<StripeAccount>(`/v1/accounts/${encodeURIComponent(accountId)}`)
}

async function createStripeAccountLink(accountId: string, origin: string): Promise<string> {
  const payload = await stripeConnectRequest<{ url?: string }>("/v1/account_links", {
    method: "POST",
    body: {
      account: accountId,
      refresh_url: `${origin}/api/payouts/onboarding/refresh`,
      return_url: `${origin}/author/me?payout=return`,
      type: "account_onboarding",
      "collection_options[fields]": "eventually_due",
    },
  })
  if (!isSafeHttpsUrl(String(payload.url || ""), 4_000)) {
    throw new StripeConnectError("Stripe no devolvió un enlace seguro", true, "invalid_link")
  }
  return String(payload.url)
}

async function createStripeTransfer(input: {
  payoutId: number
  authorUserId: number
  amountCents: number
  currency: string
  accountId: string
}): Promise<string> {
  const payload = await stripeConnectRequest<{ id?: string }>("/v1/transfers", {
    method: "POST",
    idempotencyKey: `tloque-author-payout-${input.payoutId}`,
    body: {
      amount: input.amountCents,
      currency: input.currency,
      destination: input.accountId,
      transfer_group: `TLOQUE_PAYOUT_${input.payoutId}`,
      "metadata[payout_id]": String(input.payoutId),
      "metadata[author_user_id]": String(input.authorUserId),
    },
  })
  if (!/^tr_[A-Za-z0-9]+$/.test(String(payload.id || ""))) {
    throw new StripeConnectError("Stripe no confirmó la transferencia", false, "missing_transfer")
  }
  return String(payload.id)
}

async function storeAccountSnapshot(userId: number, account: StripeAccount) {
  const snapshot = payoutAccountSnapshot(account)
  await db.insert(authorPayoutAccounts).values({
    userId,
    providerAccountId: account.id,
    ...snapshot,
    lastSyncedAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: authorPayoutAccounts.userId,
    set: { ...snapshot, lastSyncedAt: new Date(), updatedAt: new Date() },
  })
  return snapshot
}

async function releaseReservedEarnings(payoutId: number, status: "failed" | "rejected" | "reversed", failureCode: string, adminUserId?: number) {
  await db.transaction(async tx => {
    await tx.update(authorPayouts).set({
      status,
      failureCode: failureCode.slice(0, 200),
      adminUserId: adminUserId || null,
      processedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(authorPayouts.id, payoutId))
    await tx.update(authorEarnings).set({ status: "accrued", payoutId: null }).where(and(
      eq(authorEarnings.payoutId, payoutId),
      eq(authorEarnings.status, "reserved"),
    ))
  })
}

export function registerPayoutRoutes(app: Express) {
  app.get("/api/payouts/mine", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id as number
      const cutoff = new Date(Date.now() - payoutHoldDays() * 86_400_000)
      const [account, earnings, recent] = await Promise.all([
        db.select().from(authorPayoutAccounts).where(eq(authorPayoutAccounts.userId, userId)).then(rows => rows[0] || null),
        db.select().from(authorEarnings).where(eq(authorEarnings.authorUserId, userId)),
        db.select().from(authorPayouts).where(eq(authorPayouts.authorUserId, userId))
          .orderBy(desc(authorPayouts.requestedAt)).limit(10),
      ])
      const eligible = earnings.filter(row => row.payoutEligible && row.status === "accrued")
      const available = eligible.filter(row => row.createdAt <= cutoff)
      const held = eligible.filter(row => row.createdAt > cutoff)
      res.json({
        enabled: payoutSystemEnabled(),
        holdDays: payoutHoldDays(),
        minimumCents: payoutMinimumCents(),
        currency: "mxn",
        availableCents: available.reduce((sum, row) => sum + row.authorCents, 0),
        heldCents: held.reduce((sum, row) => sum + row.authorCents, 0),
        account: account ? {
          connected: true,
          ready: account.detailsSubmitted && account.payoutsEnabled && account.transfersActive && !account.disabledReason,
          detailsSubmitted: account.detailsSubmitted,
          payoutsEnabled: account.payoutsEnabled,
          transfersActive: account.transfersActive,
          disabledReason: account.disabledReason,
          requirementsDue: account.requirementsDue,
          lastSyncedAt: account.lastSyncedAt,
        } : { connected: false, ready: false },
        payouts: recent.map(row => ({
          id: row.id, amountCents: row.amountCents, currency: row.currency,
          status: row.status, requestedAt: row.requestedAt, completedAt: row.completedAt,
        })),
      })
    } catch {
      res.status(500).json({ message: "No se pudo cargar la liquidación" })
    }
  })

  app.post("/api/payouts/onboarding", rateLimit(60_000, 4), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      if (!payoutSystemEnabled()) return res.status(503).json({ message: "Las liquidaciones aún no están activas" })
      const user = req.user as any
      let [stored] = await db.select().from(authorPayoutAccounts).where(eq(authorPayoutAccounts.userId, user.id))
      if (!stored) {
        const created = await createStripeAccount({ id: user.id, email: user.email })
        await storeAccountSnapshot(user.id, created)
        ;[stored] = await db.select().from(authorPayoutAccounts).where(eq(authorPayoutAccounts.userId, user.id))
      }
      const account = await retrieveStripeAccount(stored.providerAccountId)
      await storeAccountSnapshot(user.id, account)
      const url = await createStripeAccountLink(account.id, publicOriginForRequest(req))
      res.status(201).json({ url })
    } catch (error: any) {
      res.status(502).json({ message: error?.message || "No se pudo iniciar la verificación" })
    }
  })

  app.get("/api/payouts/onboarding/refresh", async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect("/")
    try {
      const userId = (req.user as any).id as number
      const [stored] = await db.select().from(authorPayoutAccounts).where(eq(authorPayoutAccounts.userId, userId))
      if (!stored || !payoutSystemEnabled()) return res.redirect("/author/me?payout=unavailable")
      const url = await createStripeAccountLink(stored.providerAccountId, publicOriginForRequest(req))
      return res.redirect(url)
    } catch {
      return res.redirect("/author/me?payout=error")
    }
  })

  app.post("/api/payouts/request", rateLimit(60_000, 3), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      if (!payoutSystemEnabled()) return res.status(503).json({ message: "Las liquidaciones aún no están activas" })
      const userId = (req.user as any).id as number
      const [stored] = await db.select().from(authorPayoutAccounts).where(eq(authorPayoutAccounts.userId, userId))
      if (!stored) return res.status(409).json({ message: "Primero completa la verificación de Stripe" })
      const stripeAccount = await retrieveStripeAccount(stored.providerAccountId)
      const account = await storeAccountSnapshot(userId, stripeAccount)
      if (!payoutAccountReady(stripeAccount)) {
        return res.status(409).json({ message: "Tu cuenta de liquidación todavía requiere información o verificación", account })
      }

      const cutoff = new Date(Date.now() - payoutHoldDays() * 86_400_000)
      const result = await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(${userId})`)
        const active = await tx.select().from(authorPayouts).where(and(
          eq(authorPayouts.authorUserId, userId),
          inArray(authorPayouts.status, ACTIVE_PAYOUT_STATES),
        ))
        if (active.length) return { state: "active" as const, payout: active[0] }
        const eligible = await tx.select().from(authorEarnings).where(and(
          eq(authorEarnings.authorUserId, userId),
          eq(authorEarnings.status, "accrued"),
          eq(authorEarnings.payoutEligible, true),
          eq(authorEarnings.currency, "mxn"),
          lte(authorEarnings.createdAt, cutoff),
        ))
        const amountCents = eligible.reduce((sum, row) => sum + row.authorCents, 0)
        if (amountCents < payoutMinimumCents()) return { state: "minimum" as const, amountCents }
        const [payout] = await tx.insert(authorPayouts).values({
          authorUserId: userId, amountCents, currency: "mxn", status: "requested",
        }).returning()
        await tx.update(authorEarnings).set({ status: "reserved", payoutId: payout.id })
          .where(inArray(authorEarnings.id, eligible.map(row => row.id)))
        return { state: "requested" as const, payout }
      })
      if (result.state === "active") return res.status(409).json({ message: "Ya existe una liquidación en proceso", payout: result.payout })
      if (result.state === "minimum") return res.status(409).json({
        message: "Aún no alcanzas el mínimo de liquidación",
        availableCents: result.amountCents,
        minimumCents: payoutMinimumCents(),
      })
      res.status(201).json({ payout: result.payout })
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "No se pudo solicitar la liquidación" })
    }
  })

  app.get("/api/admin/payouts", requireAdmin, async (_req, res) => {
    const rows = await db.select({ payout: authorPayouts, authorName: users.name, authorEmail: users.email })
      .from(authorPayouts)
      .innerJoin(users, eq(authorPayouts.authorUserId, users.id))
      .orderBy(desc(authorPayouts.requestedAt)).limit(200)
    res.json({ payouts: rows })
  })

  app.post("/api/admin/payouts/:id/approve", requireAdmin, rateLimit(60_000, 10), async (req, res) => {
    const payoutId = Number(req.params.id)
    if (!Number.isSafeInteger(payoutId) || payoutId <= 0) return res.status(400).json({ message: "Liquidación inválida" })
    if (!payoutSystemEnabled()) return res.status(503).json({ message: "Las liquidaciones no están activas" })
    const adminUserId = (req.user as any).id as number

    let payout: any
    let account: any
    try {
      const prepared = await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(73001, ${payoutId})`)
        if (await hasOpenPaymentIncidents(tx)) return { blockedByIncident: true as const }
        const [row] = await tx.select().from(authorPayouts).where(eq(authorPayouts.id, payoutId))
        if (!row || !["requested", "processing", "processing_unknown"].includes(row.status)) return null
        const [connected] = await tx.select().from(authorPayoutAccounts)
          .where(eq(authorPayoutAccounts.userId, row.authorUserId))
        if (!connected) return { payout: row, account: null }
        const reserved = await tx.select().from(authorEarnings).where(and(
          eq(authorEarnings.payoutId, payoutId), eq(authorEarnings.status, "reserved"),
        ))
        if (reserved.reduce((sum, earning) => sum + earning.authorCents, 0) !== row.amountCents) {
          return { payout: row, account: connected, invalidLedger: true }
        }
        await tx.update(authorPayouts).set({
          status: "processing", adminUserId, processedAt: new Date(), failureCode: "", updatedAt: new Date(),
        }).where(eq(authorPayouts.id, payoutId))
        return { payout: row, account: connected, invalidLedger: false }
      })
      if (prepared && "blockedByIncident" in prepared) {
        return res.status(409).json({ message: "Hay un reembolso o contracargo pendiente de conciliación" })
      }
      if (!prepared) return res.status(409).json({ message: "La liquidación ya fue procesada o no existe" })
      payout = prepared.payout
      account = prepared.account
      if (prepared.invalidLedger) {
        await releaseReservedEarnings(payoutId, "failed", "ledger_mismatch", adminUserId)
        return res.status(409).json({ message: "La liquidación no coincide con las ganancias reservadas" })
      }
      if (!account) {
        await releaseReservedEarnings(payoutId, "failed", "missing_account", adminUserId)
        return res.status(409).json({ message: "El autor no tiene una cuenta de liquidación" })
      }
      const stripeAccount = await retrieveStripeAccount(account.providerAccountId)
      await storeAccountSnapshot(payout.authorUserId, stripeAccount)
      if (!payoutAccountReady(stripeAccount)) {
        await db.update(authorPayouts).set({ status: "requested", failureCode: "account_not_ready", updatedAt: new Date() })
          .where(eq(authorPayouts.id, payoutId))
        return res.status(409).json({ message: "La cuenta Stripe del autor no está lista" })
      }
      const transferRef = await createStripeTransfer({
        payoutId,
        authorUserId: payout.authorUserId,
        amountCents: payout.amountCents,
        currency: payout.currency,
        accountId: account.providerAccountId,
      })
      await db.transaction(async tx => {
        await tx.update(authorPayouts).set({
          status: "transferred", providerRef: transferRef, completedAt: new Date(), updatedAt: new Date(),
        }).where(eq(authorPayouts.id, payoutId))
        await tx.update(authorEarnings).set({ status: "paid_out" }).where(and(
          eq(authorEarnings.payoutId, payoutId), eq(authorEarnings.status, "reserved"),
        ))
      })
      res.json({ ok: true, payoutId, status: "transferred" })
    } catch (error: any) {
      const stripeError = error instanceof StripeConnectError ? error : null
      if (stripeError?.definitive) {
        await releaseReservedEarnings(payoutId, "failed", stripeError.code, adminUserId).catch(() => undefined)
      } else {
        await db.update(authorPayouts).set({
          status: "processing_unknown", failureCode: stripeError?.code || "unknown", updatedAt: new Date(),
        }).where(eq(authorPayouts.id, payoutId)).catch(() => undefined)
      }
      res.status(502).json({
        message: stripeError?.definitive
          ? "Stripe rechazó la transferencia; las ganancias fueron liberadas"
          : "El resultado de Stripe es incierto; se conservaron reservadas para reintentar con la misma clave",
      })
    }
  })

  app.post("/api/admin/payouts/:id/reject", requireAdmin, rateLimit(60_000, 10), async (req, res) => {
    const payoutId = Number(req.params.id)
    if (!Number.isSafeInteger(payoutId) || payoutId <= 0) return res.status(400).json({ message: "Liquidación inválida" })
    const [payout] = await db.select().from(authorPayouts).where(eq(authorPayouts.id, payoutId))
    if (!payout || payout.status !== "requested") return res.status(409).json({ message: "La liquidación ya fue procesada o no existe" })
    const reason = String(req.body?.reason || "admin_rejected").trim().slice(0, 200) || "admin_rejected"
    await releaseReservedEarnings(payoutId, "rejected", reason, (req.user as any).id)
    res.json({ ok: true })
  })

  app.post("/api/payouts/webhook", async (req, res) => {
    const secret = String(process.env.STRIPE_CONNECT_WEBHOOK_SECRET || "")
    if (!secret) return res.status(501).json({ message: "Webhook Connect no configurado" })
    const event = verifyStripeWebhook(
      (req as any).rawBody as Buffer,
      req.headers["stripe-signature"] as string | undefined,
      secret,
    )
    if (!event) return res.status(400).json({ message: "Firma inválida" })
    try {
      if (event.type === "account.updated") {
        const account = event.data?.object as StripeAccount
        if (account?.id) {
          const [stored] = await db.select().from(authorPayoutAccounts)
            .where(eq(authorPayoutAccounts.providerAccountId, account.id))
          if (stored) await storeAccountSnapshot(stored.userId, account)
        }
      } else if (event.type === "account.application.deauthorized") {
        const accountId = String(event.account || "")
        if (accountId) await db.update(authorPayoutAccounts).set({
          payoutsEnabled: false, transfersActive: false, disabledReason: "deauthorized", updatedAt: new Date(),
        }).where(eq(authorPayoutAccounts.providerAccountId, accountId))
      } else if (event.type === "transfer.reversed" || event.type === "transfer.updated") {
        const transfer = event.data?.object || {}
        const transferId = String(transfer.id || "")
        const amount = Number(transfer.amount || 0)
        const amountReversed = Number(transfer.amount_reversed || 0)
        if (transferId && amount > 0 && amountReversed > 0 && amountReversed < amount) {
          await db.update(authorPayouts).set({
            status: "attention", failureCode: "stripe_transfer_partially_reversed", updatedAt: new Date(),
          }).where(and(eq(authorPayouts.providerRef, transferId), eq(authorPayouts.status, "transferred")))
        } else if (transferId && amount > 0 && amountReversed >= amount) {
          const [payout] = await db.select().from(authorPayouts).where(eq(authorPayouts.providerRef, transferId))
          if (payout && payout.status === "transferred") {
            await releaseReservedEarnings(payout.id, "reversed", "stripe_transfer_reversed")
            await db.update(authorEarnings).set({ status: "accrued", payoutId: null })
              .where(and(eq(authorEarnings.payoutId, payout.id), eq(authorEarnings.status, "paid_out")))
          }
        }
      }
      res.json({ received: true })
    } catch {
      res.status(500).json({ message: "No se pudo procesar el webhook" })
    }
  })
}
