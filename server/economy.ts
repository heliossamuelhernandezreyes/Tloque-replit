import { and, eq, sql } from "drizzle-orm"
import { walletLedger } from "@shared/schema"
import { TINTA_CENTS } from "./payments"

type Executor = any

export type TintaDebit = {
  id: number
  cashBackingCents: number
}

function safeInteger(value: unknown): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : 0
}

export function tintaBackingForDebit(availableBackingCents: number, amount: number): number {
  if (!Number.isSafeInteger(amount) || amount <= 0) return 0
  const available = Math.max(0, Math.floor(Number(availableBackingCents) || 0))
  return Math.min(available, amount * TINTA_CENTS)
}

/**
 * Debita Tinta y consume primero el efectivo que todavía la respalda.
 *
 * El candado por usuario convierte saldo, respaldo e inserción en una sola
 * decisión serializable aun cuando distintas rutas intenten gastar al mismo
 * tiempo. El respaldo consumido nunca supera ni el efectivo disponible ni el
 * valor nominal del gasto.
 */
export async function debitTinta(
  executor: Executor,
  input: { userId: number; amount: number; reason: string; refType: string; refId: number },
): Promise<TintaDebit | null> {
  if (!Number.isSafeInteger(input.userId) || input.userId <= 0) throw new Error("Usuario inválido")
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error("Monto de Tinta inválido")

  await executor.execute(sql`select pg_advisory_xact_lock(${input.userId})`)
  const result: any = await executor.execute(sql`
    select
      coalesce(sum(delta), 0)::bigint as balance,
      greatest(0, coalesce(sum(cash_backing_cents), 0))::bigint as backing
    from wallet_ledger
    where user_id = ${input.userId} and currency = 'tinta'
  `)
  const balance = safeInteger(result?.rows?.[0]?.balance)
  const backing = safeInteger(result?.rows?.[0]?.backing)
  if (balance < input.amount) return null

  const cashBackingCents = tintaBackingForDebit(backing, input.amount)
  const [entry] = await executor.insert(walletLedger).values({
    userId: input.userId,
    currency: "tinta",
    delta: -input.amount,
    reason: input.reason,
    refType: input.refType,
    refId: input.refId,
    cashBackingCents: -cashBackingCents,
  }).returning({ id: walletLedger.id, cashBackingCents: walletLedger.cashBackingCents })

  return { id: entry.id, cashBackingCents: Math.abs(entry.cashBackingCents) }
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
  })
  return true
}
