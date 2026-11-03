/** Storage units stay unchanged: one historical ledger unit displays as 20 Tintas.
 * This changes no balances, purchase power, receipts or existing ledger rows. */
export const TINTA_DISPLAY_SCALE = 20
export const displayTinta = (units: number) => units * TINTA_DISPLAY_SCALE
export const PAID_TINTA_POLICY = "paid-proportional-v2"

export type TintaFunding = { legacyUnits: number; legacyCents: number; paidUnits: number; paidCents: number }
export const emptyFunding = (): TintaFunding => ({ legacyUnits: 0, legacyCents: 0, paidUnits: 0, paidCents: 0 })
export function paidFunding(units: number, cents: number): TintaFunding {
  return { legacyUnits: 0, legacyCents: 0, paidUnits: units, paidCents: cents }
}
export function negateFunding(funding: TintaFunding): TintaFunding {
  return Object.fromEntries(Object.entries(funding).map(([key, value]) => [key, -value])) as TintaFunding
}
export function proportionalCents(cents: number, units: number, total: number) {
  if (![cents, units, total].every(Number.isSafeInteger) || cents < 0 || units < 0 || total <= 0 || units > total) throw new Error("Asignación de Tinta inválida")
  return Number(BigInt(cents) * BigInt(units) / BigInt(total))
}

/** New paid credits consume proportional cash, including the package premium.
 * Historical credits retain cash-first-v1 and never borrow new backing.
 * Fractions stay in the wallet until its final spend; no cash is stranded. */
export function planTintaDebit(state: TintaFunding, amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || !Object.values(state).every(Number.isSafeInteger)) throw new Error("Monto de Tinta inválido")
  if (state.legacyUnits + state.paidUnits < amount) return null
  const paidUnits = Math.min(amount, Math.max(0, state.paidUnits))
  const legacyUnits = amount - paidUnits
  const paidCents = paidUnits ? proportionalCents(Math.max(0, state.paidCents), paidUnits, state.paidUnits) : 0
  const legacyCents = Math.min(Math.max(0, state.legacyCents), legacyUnits * 200)
  return { legacyUnits, legacyCents, paidUnits, paidCents }
}
