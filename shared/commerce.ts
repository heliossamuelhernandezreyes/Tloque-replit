/** The economic policy is shared by quotes, receipts and the author agreement. */
export const COMMERCE_VERSION = "2026-11-01.1"
export const TINTA_UNIT_CENTS = 200
export const TINTA_ALLOCATION = "cash-first-v1" as const

export function splitCents(cents: number, authorBps: number) {
  if (!Number.isSafeInteger(cents) || cents < 0 || !Number.isInteger(authorBps) || authorBps < 0 || authorBps > 10_000) throw new Error("Reparto inválido")
  const authorCents = Number((BigInt(cents) * BigInt(authorBps) + 5_000n) / 10_000n)
  return { authorCents, platformCents: cents - authorCents }
}

export function cashForTinta(backingCents: number, units: number) {
  if (!Number.isSafeInteger(units) || units <= 0 || !Number.isSafeInteger(units * TINTA_UNIT_CENTS)) return 0
  if (!Number.isSafeInteger(backingCents)) throw new Error("Respaldo inválido")
  return Math.min(Math.max(0, backingCents), units * TINTA_UNIT_CENTS)
}

export type EconomicQuote = {
  version: string; allocation: typeof TINTA_ALLOCATION; bookId: number; workHash: string
  agreementId: number; agreementHash: string; kind: "support" | "sale"
  provider: "stripe" | "tinta" | "beta"; currency: "mxn"; units: number
  nominalCents: number; chargedCents: number; cashBasisCents: number
  authorShareBps: number; authorCents: number; platformCents: number
  holdDays: number; minimumCents: number
}

export function economicQuote(input: Omit<EconomicQuote, "version" | "allocation" | "chargedCents" | "cashBasisCents" | "authorCents" | "platformCents"> & { availableBackingCents: number }): EconomicQuote {
  const { availableBackingCents, ...terms } = input
  if (!Number.isSafeInteger(terms.nominalCents) || terms.nominalCents < 0) throw new Error("Precio inválido")
  const cashBasisCents = terms.provider === "stripe" ? terms.nominalCents : terms.provider === "beta" ? 0 : cashForTinta(availableBackingCents, terms.units)
  return { ...terms, version: COMMERCE_VERSION, allocation: TINTA_ALLOCATION,
    chargedCents: terms.provider === "stripe" ? terms.nominalCents : 0,
    cashBasisCents, ...splitCents(cashBasisCents, terms.authorShareBps) }
}

export function money(cents: number) { return `$${(cents / 100).toFixed(2)} MXN` }

export function settlementWindow(createdAt: Date | string, economics: Partial<EconomicQuote> | null | undefined, fallback: { holdDays: number; minimumCents: number }) {
  // Keep supporting accepted versions when COMMERCE_VERSION advances.
  const frozen = economics?.version === "2026-11-01.1" && Number.isInteger(economics.holdDays) && economics.holdDays! >= 7 && economics.holdDays! <= 180
    && Number.isSafeInteger(economics.minimumCents) && economics.minimumCents! >= 1000 && economics.minimumCents! <= 10_000_000
  const holdDays = frozen ? economics!.holdDays! : fallback.holdDays
  const minimumCents = frozen ? economics!.minimumCents! : fallback.minimumCents
  return { holdDays, minimumCents, availableAt: new Date(new Date(createdAt).getTime() + holdDays * 86_400_000).toISOString(), frozen }
}

export function commercialText(input: {
  operator: { name: string; address: string; privacyEmail: string; phone: string }
  bookId: number; title: string; author: string; workHash: string; authorShareBps: number
  supportUnits: number; holdDays: number; minimumCents: number
}) {
  const i = input, share = i.authorShareBps / 100
  return `Acuerdo comercial de edición · ${COMMERCE_VERSION}
Operador: ${i.operator.name}. Domicilio: ${i.operator.address}. Contacto: ${i.operator.privacyEmail}. Teléfono: ${i.operator.phone}.
Obra ${i.bookId}: ${i.title}. Nombre editorial del titular: ${i.author}. Edición identificada por SHA-256 ${i.workHash}. La identidad y las facultades del titular se revisan en el expediente privado antes de habilitar ventas.

Licencia no exclusiva para México, limitada a esta edición y a las modalidades expresamente elegidas en su permiso de publicación. Se permiten nuevas adquisiciones mientras la edición permanezca publicada y exista revisión comercial vigente; retirarla del catálogo detiene nuevas compras. No se ceden derechos morales, obras futuras ni usos para entrenar IA. Una retirada no borra por sí sola las prestaciones lícitas adquiridas anteriormente. Una infracción u orden requiere revisión y el remedio aplicable.

Token 1: lectura digital permanente de esta edición sin suscripción, descarga autorizada y tres impresiones personales sin venta, regalos ni canjes digitales adicionales. Precio: ${i.supportUnits} Tintas o ${money(i.supportUnits * TINTA_UNIT_CENTS)} con tarjeta. Permiso comercial: 10 Tintas o ${money(10 * TINTA_UNIT_CENTS)}, un ejemplar físico nuevo y su primera distribución comercial. Requiere Token 1 activo salvo el propio titular. Su único canje digital se vincula definitivamente a la primera cuenta; la reventa física no lo repone. Impresiones fallidas pueden rehacerse inutilizando sobrantes; no se obtienen ejemplares adicionales. La reventa lícita del mismo soporte no equivale a fabricar otro.

Reparto: ${share}% titular y ${100 - share}% Tloque sobre el efectivo atribuido a cada operación, no sobre Tinta nominal sin respaldo. Los importes se calculan en centavos MXN: se redondea la parte del titular al centavo más cercano y Tloque recibe el resto exacto.

Tarjeta: la base es el total confirmado de esa compra. Tinta: se consume primero el respaldo en efectivo todavía disponible en el monedero, hasta ${money(TINTA_UNIT_CENTS)} por unidad gastada; después se consumen unidades sin respaldo. Los bonos y créditos de prueba no crean efectivo. No se usa un promedio por recarga: el orden de gasto puede cambiar la base de una operación. Una operación sin respaldo genera cero ingreso liquidable, aunque entregue los beneficios autorizados. Ejemplo: 55 Tintas compradas por $99.00 respaldan en total $99.00, nunca $110.00. Debe mostrarse el desglose de cada compra antes de aceptarla y conservarse en su comprobante.

No se descuentan comisiones del procesador ni gastos operativos adicionales de la participación calculada del titular; se cubren con la parte de Tloque. Este circuito no calcula ni practica retenciones fiscales ni emite facturas. No presume exenciones: la revisión fiscal real debe confirmar el tratamiento y su compatibilidad antes de habilitar cobros. Si exige deducciones o funciones no implementadas, deberán incorporarse y aceptarse en otro acuerdo antes de operar. No se alteran importes históricos para simularlas.

Liquidación: espera de ${i.holdDays} días naturales desde el devengo y mínimo de ${money(i.minimumCents)}. Esos valores quedan fijados en las compras nuevas. La solicitud reserva las ganancias elegibles; se transfiere solo a una cuenta verificada y tras aprobación. Se informa el estado solicitado, reservado, transferido o pendiente de conciliación; no se promete un día bancario de llegada. Un saldo inferior al mínimo no caduca ni se extingue por inactividad o por retirar la obra; al terminar la relación debe acordarse y tramitarse su liquidación, sin imponer una renuncia. No se confunden Tintas del lector con ingresos en pesos del titular.

Errores y devoluciones: un reintento conserva la misma operación. Un reintegro de Tinta restaura exactamente las unidades y el respaldo consumidos. Reembolsos y contracargos del procesador se concilian con evidencia; un reembolso total revierte el ingreso no liquidado, mientras incidencias parciales o importes ya reservados/transferidos requieren revisión. Una incidencia no declara por sí sola una deuda del autor ni autoriza un segundo pago incierto. No se renuncian derechos del consumidor. Los ajustes y sus motivos deben quedar trazables.

La cuenta del titular acepta este texto íntegro de forma afirmativa. Una referencia administrativa no sustituye esa aceptación ni la revisión jurídica/fiscal y de facultades. Cambiar la edición, identidad del operador, regla económica, porcentajes o plazos requiere una nueva aceptación para nuevas compras y una nueva revisión. Las órdenes anteriores conservan su acuerdo y su cálculo. Las reclamaciones autorales se presentan en /rights; otras aclaraciones se atienden por el contacto indicado, con posibilidad de revisión y defensa.`
}
