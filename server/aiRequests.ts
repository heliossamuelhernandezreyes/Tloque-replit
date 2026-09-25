import { and, eq, sql } from "drizzle-orm"
import { aiRequests, paperUsageEvents, walletLedger } from "@shared/schema"
import { db } from "./db"

export class AiRequestError extends Error {
  constructor(public code: string, public status = 409) { super(code) }
}

export async function reserveAiRequest(userId: number, requestKey: string, inputHash: string, paper: number) {
  if (!Number.isSafeInteger(paper) || paper < 1) throw new AiRequestError("INVALID_RESERVATION", 400)
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${userId})`)
    const [prior] = await tx.select().from(aiRequests).where(eq(aiRequests.requestKey, requestKey))
    if (prior) {
      if (prior.userId !== userId || prior.inputHash !== inputHash) throw new AiRequestError("REQUEST_KEY_REUSED")
      if (prior.status === "ready" && prior.result) return { id: prior.id, result: prior.result }
      throw new AiRequestError(prior.status === "processing" ? "REQUEST_IN_PROGRESS" : "REQUEST_EXPIRED")
    }
    const [balance] = await tx.select({ value: sql<number>`coalesce(sum(${walletLedger.delta}), 0)` }).from(walletLedger)
      .where(and(eq(walletLedger.userId, userId), eq(walletLedger.currency, "papel")))
    if (Number(balance?.value || 0) < paper) throw new AiRequestError("PAPEL_INSUFICIENTE", 402)
    const [request] = await tx.insert(aiRequests).values({ userId, requestKey, inputHash, reservedPaper: paper, expiresAt: new Date(Date.now() + 180_000) }).returning()
    await tx.insert(walletLedger).values({ userId, currency: "papel", delta: -paper, reason: "reserve_ai", refType: "ai_request", refId: request.id })
    return { id: request.id, result: null }
  })
}

export async function failAiRequest(id: number, expiredOnly = false) {
  await db.transaction(async tx => {
    const [initial] = await tx.select().from(aiRequests).where(eq(aiRequests.id, id))
    if (!initial) return
    await tx.execute(sql`select pg_advisory_xact_lock(${initial.userId})`)
    const [request] = await tx.select().from(aiRequests).where(eq(aiRequests.id, id))
    if (!request || request.status !== "processing" || (expiredOnly && request.expiresAt.getTime() > Date.now())) return
    await tx.update(aiRequests).set({ status: "failed" }).where(eq(aiRequests.id, id))
    await tx.insert(walletLedger).values({ userId: request.userId, currency: "papel", delta: request.reservedPaper, reason: "refund_ai", refType: "ai_request", refId: id })
  })
}

export async function finishAiRequest(id: number, usage: { provider: string; inputUnits: number; outputUnits: number; paperCharged: number; metadata: Record<string, unknown> }, result: Record<string, unknown>) {
  await db.transaction(async tx => {
    const [initial] = await tx.select().from(aiRequests).where(eq(aiRequests.id, id))
    if (!initial) throw new AiRequestError("REQUEST_EXPIRED")
    await tx.execute(sql`select pg_advisory_xact_lock(${initial.userId})`)
    const [request] = await tx.select().from(aiRequests).where(eq(aiRequests.id, id))
    if (request.status !== "processing" || request.expiresAt.getTime() <= Date.now()) throw new AiRequestError("REQUEST_EXPIRED")
    if (usage.paperCharged > request.reservedPaper) throw new AiRequestError("USAGE_EXCEEDED_RESERVATION")
    await tx.insert(paperUsageEvents).values({ ...usage, userId: request.userId, requestKey: request.requestKey, feature: "oracle" })
    const refund = request.reservedPaper - usage.paperCharged
    if (refund) await tx.insert(walletLedger).values({ userId: request.userId, currency: "papel", delta: refund, reason: "refund_ai", refType: "ai_request", refId: id })
    await tx.update(aiRequests).set({ status: "ready", result }).where(eq(aiRequests.id, id))
  })
}

export async function recoverExpiredAiRequests() {
  const expired = await db.select({ id: aiRequests.id }).from(aiRequests)
    .where(and(eq(aiRequests.status, "processing"), sql`${aiRequests.expiresAt} <= now()`)).limit(100)
  for (const { id } of expired) await failAiRequest(id, true)
}
