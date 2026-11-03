import { and, eq, sql } from "drizzle-orm"
import { walletLedger } from "@shared/schema"
import { cashForTinta } from "@shared/commerce"
import { negateFunding, planTintaDebit, type TintaFunding } from "@shared/tinta"

type Executor = any

export type TintaDebit = {
  id: number
  cashBackingCents: number
  funding: TintaFunding
}

function safeInteger(value: unknown): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : 0
}

export function tintaBackingForDebit(availableBackingCents: number, amount: number): number {
  if (!Number.isSafeInteger(amount) || amount <= 0) return 0
  return cashForTinta(availableBackingCents, amount)
}

export async function tintaState(executor: Executor, userId: number) {
  const result = await executor.execute(sql`select
    coalesce(sum(coalesce((funding->>'legacyUnits')::bigint,delta)),0)::bigint as legacy_units,
    coalesce(sum(coalesce((funding->>'legacyCents')::bigint,cash_backing_cents)),0)::bigint as legacy_cents,
    coalesce(sum(coalesce((funding->>'paidUnits')::bigint,0)),0)::bigint as paid_units,
    coalesce(sum(coalesce((funding->>'paidCents')::bigint,0)),0)::bigint as paid_cents
    from wallet_ledger where user_id=${userId} and currency='tinta'`)
  const row = result.rows[0]
  const funding: TintaFunding = { legacyUnits: Number(row?.legacy_units || 0), legacyCents: Number(row?.legacy_cents || 0),
    paidUnits: Number(row?.paid_units || 0), paidCents: Number(row?.paid_cents || 0) }
  if (!Object.values(funding).every(Number.isSafeInteger)) throw new Error("Saldo fuera de rango")
  return { balance: funding.legacyUnits + funding.paidUnits, backing: Math.max(0, funding.legacyCents + funding.paidCents), funding }
}

/** One user lock covers both policy buckets, the quote and the immutable debit.
 * A single row retains the exact funding of mixed spends for idempotent refunds. */
export async function debitTinta(
  executor: Executor,
  input: { userId: number; amount: number; reason: string; refType: string; refId: number },
): Promise<TintaDebit | null> {
  if (!Number.isSafeInteger(input.userId) || input.userId <= 0) throw new Error("Usuario inválido")
  await executor.execute(sql`select pg_advisory_xact_lock(${input.userId})`)
  const state = await tintaState(executor, input.userId)
  const funding = planTintaDebit(state.funding, input.amount)
  if (!funding) return null
  const cashBackingCents = funding.legacyCents + funding.paidCents
  const [entry] = await executor.insert(walletLedger).values({
    userId: input.userId, currency: "tinta", delta: -input.amount,
    reason: input.reason, refType: input.refType, refId: input.refId,
    cashBackingCents: -cashBackingCents, funding: negateFunding(funding),
  }).returning({ id: walletLedger.id })
  return { id: entry.id, cashBackingCents, funding }
}

/** Restaura exactamente el respaldo consumido por un débito anterior. */
export async function refundTintaDebit(
  executor: Executor,
  input: { userId: number; debitId: number; reason?: string },
): Promise<boolean> {
  await executor.execute(sql`select pg_advisory_xact_lock(${input.userId})`)
  const [debit] = await executor.select().from(walletLedger).where(and(
    eq(walletLedger.id, input.debitId),
    eq(walletLedger.userId, input.userId),
    eq(walletLedger.currency, "tinta"),
  ))
  if (!debit || debit.delta >= 0) return false

  const [prior] = await executor.select({ id: walletLedger.id }).from(walletLedger).where(and(
    eq(walletLedger.reason, input.reason || "refund"),
    eq(walletLedger.refType, "wallet_debit"),
    eq(walletLedger.refId, debit.id),
  ))
  if (prior) return true

  await executor.insert(walletLedger).values({
    userId: input.userId,
    currency: "tinta",
    delta: -debit.delta,
    reason: input.reason || "refund",
    refType: "wallet_debit",
    refId: debit.id,
    cashBackingCents: Math.max(0, -safeInteger(debit.cashBackingCents)),
    funding: debit.funding ? negateFunding(debit.funding) : null,
  })
  return true
}
