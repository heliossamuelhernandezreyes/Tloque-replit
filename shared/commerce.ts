import { displayTinta, planTintaDebit, proportionalCents, type TintaFunding } from "./tinta.ts"

/** The economic policy is shared by quotes, receipts and the author agreement. */
export const COMMERCE_VERSION = "2026-11-03.2"
export const COMMERCIAL_AUTHOR_CENTS = 1800
const FROZEN_SETTLEMENT_VERSIONS = ["2026-11-01.1", "2026-11-03.1", "2026-11-03.2"]
export const TINTA_UNIT_CENTS = 200
export const TINTA_ALLOCATION = "paid-proportional-legacy-cash-first-v2" as const

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
  version: string; allocation: string; bookId: number; workHash: string
  agreementId: number; agreementHash: string; kind: "support" | "sale"
  provider: "stripe" | "tinta" | "beta"; currency: "mxn"; units: number
  nominalCents: number; chargedCents: number; cashBasisCents: number
  authorShareBps: number; authorCents: number; platformCents: number
  holdDays: number; minimumCents: number
  displayScale?: number; royaltyBaseCents?: number; tintaFunding?: TintaFunding
  fixedAuthorCents?: number // fixed per full commercial licence; legacy-funded fractions retain their accepted cash rule
}

export function economicQuote(input: Omit<EconomicQuote, "version" | "allocation" | "chargedCents" | "cashBasisCents" | "authorCents" | "platformCents"> & { availableBackingCents: number; walletFunding?: TintaFunding }): EconomicQuote {
  const { availableBackingCents, walletFunding, ...terms } = input
  if (!Number.isSafeInteger(terms.nominalCents) || terms.nominalCents < 0) throw new Error("Precio inválido")
  if (terms.fixedAuthorCents !== undefined && (!Number.isSafeInteger(terms.fixedAuthorCents) || terms.fixedAuthorCents < 0)) throw new Error("Regalía fija inválida")
  const funding = terms.provider === "tinta" ? planTintaDebit(walletFunding || {
    legacyUnits: terms.units, legacyCents: availableBackingCents, paidUnits: 0, paidCents: 0,
  }, terms.units) : null
  const cashBasisCents = terms.provider === "stripe" ? terms.nominalCents : terms.provider === "beta" ? 0 : funding ? funding.paidCents + funding.legacyCents : 0
  const paidBase = funding ? proportionalCents(terms.nominalCents, funding.paidUnits, terms.units) : 0
  const paidRoyalty = funding ? terms.fixedAuthorCents === undefined
    ? splitCents(paidBase, terms.authorShareBps).authorCents
    : proportionalCents(terms.fixedAuthorCents, funding.paidUnits, terms.units) : 0
  // A disputed/underfunded new wallet cannot silently reduce a promised royalty.
  if (funding && funding.paidCents < paidRoyalty) throw new Error("El respaldo de Tinta requiere conciliación")
  const royaltyBaseCents = terms.provider === "stripe" ? terms.nominalCents : funding ? paidBase + funding.legacyCents : 0
  const authorCents = terms.fixedAuthorCents === undefined ? splitCents(royaltyBaseCents, terms.authorShareBps).authorCents
    : terms.provider === "stripe" ? terms.fixedAuthorCents
    : funding ? paidRoyalty + splitCents(funding.legacyCents, terms.authorShareBps).authorCents : 0
  if (authorCents > cashBasisCents) throw new Error("El respaldo de Tinta requiere conciliación")
  return { ...terms, version: COMMERCE_VERSION, allocation: TINTA_ALLOCATION, displayScale: 20,
    chargedCents: terms.provider === "stripe" ? terms.nominalCents : 0,
    cashBasisCents, royaltyBaseCents, authorCents, platformCents: cashBasisCents - authorCents,
    ...(funding ? { tintaFunding: funding } : {}) }
}

export function money(cents: number) { return `$${(cents / 100).toFixed(2)} MXN` }

export function settlementWindow(createdAt: Date | string, economics: Partial<EconomicQuote> | null | undefined, fallback: { holdDays: number; minimumCents: number }) {
  // Keep supporting accepted versions when COMMERCE_VERSION advances.
  const frozen = !!economics && FROZEN_SETTLEMENT_VERSIONS.includes(economics.version || "") && Number.isInteger(economics.holdDays) && economics.holdDays! >= 7 && economics.holdDays! <= 180
    && Number.isSafeInteger(economics.minimumCents) && economics.minimumCents! >= 1000 && economics.minimumCents! <= 10_000_000
  const holdDays = frozen ? economics!.holdDays! : fallback.holdDays
  const minimumCents = frozen ? economics!.minimumCents! : fallback.minimumCents
  return { holdDays, minimumCents, availableAt: new Date(new Date(createdAt).getTime() + holdDays * 86_400_000).toISOString(), frozen }
}

export function commercialText(input: {
  operator: { name: string; address: string; privacyEmail: string; phone: string }
  bookId: number; title: string; author: string; workHash: string; authorShareBps: number
  supportUnits: number; supportMoneyCents?: number; directAuthorShareBps?: number; saleUnits?: number; saleMoneyCents?: number; saleAuthorShareBps?: number; saleAuthorFixedCents?: number; holdDays: number; minimumCents: number
}) {
  const i = input, share = i.authorShareBps / 100
  return `Acuerdo comercial de edición · ${COMMERCE_VERSION}
Operador: ${i.operator.name}. Domicilio: ${i.operator.address}. Contacto: ${i.operator.privacyEmail}. Teléfono: ${i.operator.phone}.
Obra ${i.bookId}: ${i.title}. Nombre editorial del titular: ${i.author}. Edición identificada por SHA-256 ${i.workHash}. La identidad y las facultades del titular se revisan en el expediente privado antes de habilitar ventas.

Licencia no exclusiva para México, limitada a esta edición y a las modalidades expresamente elegidas en su permiso de publicación. Se permiten nuevas adquisiciones mientras la edición permanezca publicada y exista revisión comercial vigente; retirarla del catálogo detiene nuevas compras. No se ceden derechos morales, obras futuras ni usos para entrenar IA. Una retirada no borra por sí sola las prestaciones lícitas adquiridas anteriormente. Una infracción u orden requiere revisión y el remedio aplicable.

La lectura pública es gratuita. El mecenazgo es voluntario y entrega recompensas; no compra el acceso público ni constituye por sí solo un donativo fiscalmente deducible.

Mecenazgo (Token 1): copia digital permanente de esta edición sin suscripción, descarga autorizada y tres ejemplares físicos en total. Pueden conservarse o regalarse gratuitamente a compañeros cuando el titular haya marcado el permiso separado de regalos. No permite fabricar para vender, regalar el archivo ni crear otros canjes digitales. Cada folio corresponde a un solo ejemplar; un regalo no repone el folio. Al apoyar con Tinta se incluyen las tarjetas de recompensa configuradas y autorizadas por el titular que estén disponibles en la obra, sin prometer una cantidad fija. Este beneficio no se incluye en el nuevo pago directo; las tarjetas ya adquiridas se conservan. No se reducen los derechos de compras anteriores. Precio: ${displayTinta(i.supportUnits)} Tintas o ${money(i.supportMoneyCents ?? i.supportUnits * TINTA_UNIT_CENTS)} con tarjeta.

Licencia comercial independiente: ${displayTinta(i.saleUnits ?? 12)} Tintas o ${money(i.saleMoneyCents ?? 3000)} con tarjeta. No exige adquirir mecenazgo. Autoriza fabricar un ejemplar físico nuevo de esta edición y su primera distribución comercial en México; cada ejemplar nuevo adicional necesita otra licencia. No cede la obra, exclusividad, archivos fuente ni derechos morales. Su único canje digital queda vinculado definitivamente a la primera cuenta legítima; la reventa, regalo o devolución físicos no lo reponen. El vendedor debe informar su estado y entregar una clave sin canjear cuando lo haya ofrecido. La reventa lícita del mismo soporte es distinta de fabricar otro. Una impresión fallida solo puede rehacerse inutilizando sobrantes, sin producir copias adicionales.

El fabricante/vendedor cubre impresión, encuadernación, merma, embalaje, envío y su propio cobro e impuestos; esos gastos no se descuentan de la regalía pactada. Antes de vender deben identificarse editor e impresor, edición, formato, tirada autorizada, ISBN cuando proceda, créditos, precio público aplicable y responsable del depósito legal. La licencia no exime de esos requisitos ni autoriza desconocer el precio único; la revisión de la edición debe documentarlos. El precio de la licencia no es el precio del libro físico. Tloque solo cobra esta licencia salvo contrato distinto.

Reparto del mecenazgo: con Tinta nueva pagada, ${share}% de la base editorial de ${money(i.supportUnits * TINTA_UNIT_CENTS)} corresponde al titular (${money(splitCents(i.supportUnits * TINTA_UNIT_CENTS, i.authorShareBps).authorCents)}). Con tarjeta: ${(i.directAuthorShareBps ?? i.authorShareBps) / 100}% del precio directo. Licencia comercial: regalía fija de ${money(i.saleAuthorFixedCents ?? COMMERCIAL_AUTHOR_CENTS)} por ejemplar con tarjeta o Tinta nueva pagada, independientemente del precio directo o del sobreprecio de recarga. No se calcula como el 75% del precio directo. La parte financiada con créditos históricos conserva ${(i.saleAuthorShareBps ?? 7500) / 100}% del efectivo atribuido a esa parte, incluso cero cuando no existe respaldo. Una operación mixta suma la fracción de regalía fija cubierta por Tinta nueva y la parte histórica, sin reducir silenciosamente una regalía prometida sobre efectivo nuevo. Este importe comercial se pacta por separado del mecenazgo. Cada desglose fija centavos exactos del titular y Tloque antes de pagar.

Tinta: la numeración visible es 20 veces las unidades internas históricas, sin modificar saldos, poder de compra ni comprobantes anteriores. Los nuevos paquetes son créditos pagados, sin bonos promocionales. Se gasta primero el saldo pagado nuevo y se atribuye proporcionalmente su efectivo real, incluido el sobreprecio del paquete; el último gasto consume el remanente exacto. El titular recibe su participación sobre la base editorial, no sobre ese sobreprecio; Tloque recibe el efectivo atribuido menos la regalía. No es el ${share}% del precio de la recarga. Los créditos históricos conservan su regla de respaldo primero: hasta $2.00 MXN por unidad interna (20 Tintas visibles), sin tomar respaldo de recargas nuevas. Una parte histórica sin respaldo no genera ingreso liquidable y se identifica en el desglose. Una operación mixta suma ambas bases. No se venden créditos nuevos sin respaldo ni se cuentan saldos sin gastar como beneficio. Papel cubre IA y voz y lleva un circuito separado.

No se descuentan comisiones del procesador ni gastos operativos adicionales de la participación calculada del titular; se cubren con la parte de Tloque. Este circuito no calcula ni practica retenciones fiscales ni emite facturas. No presume exenciones: la revisión fiscal real debe confirmar el tratamiento y su compatibilidad antes de habilitar cobros. Si exige deducciones o funciones no implementadas, deberán incorporarse y aceptarse en otro acuerdo antes de operar. No se alteran importes históricos para simularlas.

Liquidación: espera de ${i.holdDays} días naturales desde el devengo y mínimo de ${money(i.minimumCents)}. Esos valores quedan fijados en las compras nuevas. La solicitud reserva las ganancias elegibles; se transfiere solo a una cuenta verificada y tras aprobación. Se informa el estado solicitado, reservado, transferido o pendiente de conciliación; no se promete un día bancario de llegada. Un saldo inferior al mínimo no caduca ni se extingue por inactividad o por retirar la obra; al terminar la relación debe acordarse y tramitarse su liquidación, sin imponer una renuncia. No se confunden Tintas del lector con ingresos en pesos del titular.

Errores y devoluciones: un reintento conserva la misma operación. Un reintegro de Tinta restaura exactamente las unidades y el respaldo consumidos. Reembolsos y contracargos del procesador se concilian con evidencia; un reembolso total revierte el ingreso no liquidado, mientras incidencias parciales o importes ya reservados/transferidos requieren revisión. Una incidencia no declara por sí sola una deuda del autor ni autoriza un segundo pago incierto. No se renuncian derechos del consumidor. Los ajustes y sus motivos deben quedar trazables.

La cuenta del titular acepta este texto íntegro de forma afirmativa. Una referencia administrativa no sustituye esa aceptación ni la revisión jurídica/fiscal y de facultades. Cambiar la edición, identidad del operador, regla económica, porcentajes o plazos requiere una nueva aceptación para nuevas compras y una nueva revisión. Las órdenes anteriores conservan su acuerdo y su cálculo. Las reclamaciones autorales se presentan en /rights; otras aclaraciones se atienden por el contacto indicado, con posibilidad de revisión y defensa.`
}
