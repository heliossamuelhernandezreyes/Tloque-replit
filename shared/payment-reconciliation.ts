/** Monetary exposure is cumulative, capped by the original payment. */
export function paymentExposure(incidents: readonly {
  kind: string; amountCents: number; currency: string; resolution: string; providerStatus: string
}[], amountCents: number, currency: string) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("Importe de pago inválido")
  const outstanding = incidents.filter(row => row.resolution !== "funds_restored")
  if (outstanding.some(row => row.currency !== currency || !Number.isSafeInteger(row.amountCents) || row.amountCents < 0)) {
    throw new Error("La incidencia no coincide con la moneda o el importe del pago")
  }
  const refunds = outstanding.filter(row => row.kind === "refund").reduce((sum, row) => sum + row.amountCents, 0)
  const withheldCents = Math.min(amountCents, outstanding.reduce((sum, row) => sum + row.amountCents, 0))
  const fullRefund = refunds >= amountCents
  const blocked = outstanding.length > 0
  return {
    withheldCents,
    status: fullRefund ? "refunded" : blocked ? "payment_attention" : "paid",
    licenseStatus: fullRefund ? "revoked" : blocked ? "suspended" : "active",
  }
}

/** Round up fractional units; a full refund removes exactly the original pack. */
export function withheldTinta(units: number, priceCents: number, withheldCents: number): number {
  if (![units, priceCents, withheldCents].every(Number.isSafeInteger) || units <= 0 || priceCents <= 0 || withheldCents < 0) {
    throw new Error("Ajuste de Tinta inválido")
  }
  const cents = BigInt(Math.min(priceCents, withheldCents))
  return Number((BigInt(units) * cents + BigInt(priceCents) - 1n) / BigInt(priceCents))
}
