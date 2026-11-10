import { createHash } from "node:crypto"
import { COMMERCE_VERSION, TINTA_UNIT_CENTS, splitCents } from "@shared/commerce"
import { planTintaDebit } from "@shared/tinta"
import { requireEditionCommerce } from "./editionCommerce"
import { hashEconomicTerms } from "./commercial"
import { tintaState } from "./economy"

export function cardFingerprint(card: any) {
  return createHash("sha256").update(JSON.stringify({ id: card.id, bookId: card.bookId, name: card.name,
    subtitle: card.subtitle, description: card.description, fx: card.fx, unlock: card.unlock, priceTinta: card.priceTinta, archived: card.archived })).digest("hex")
}

/** Preserve the existing card split: 50% of the actual cash consumed, not a new nominal royalty. */
export async function quoteCard(tx: any, userId: number, book: any, card: any) {
  const { permission, agreement } = await requireEditionCommerce(tx, book, "card")
  const wallet = await tintaState(tx, userId)
  const funding = planTintaDebit(wallet.funding, card.priceTinta)
  const cashBasisCents = funding ? funding.legacyCents + funding.paidCents : 0
  const terms = agreement.document
  const economics = { version: COMMERCE_VERSION, allocation: "card-actual-cash-v1", kind: "card" as const,
    cardId: card.id, cardFingerprint: cardFingerprint(card), bookId: book.id, workHash: terms.workHash,
    agreementId: agreement.receipt.id, agreementHash: agreement.hash, provider: "tinta" as const, currency: "mxn" as const,
    units: card.priceTinta, nominalCents: card.priceTinta * TINTA_UNIT_CENTS, chargedCents: 0,
    cashBasisCents, royaltyBaseCents: cashBasisCents, authorShareBps: terms.cardAuthorShareBps,
    ...splitCents(cashBasisCents, terms.cardAuthorShareBps), holdDays: terms.holdDays, minimumCents: terms.minimumCents,
    displayScale: 20, ...(funding ? { tintaFunding: funding } : {}),
  }
  return { hash: hashEconomicTerms({ userId, economics }), economics, canPay: funding !== null,
    permission, agreement: { id: agreement.receipt.id, hash: agreement.hash, document: terms } }
}
