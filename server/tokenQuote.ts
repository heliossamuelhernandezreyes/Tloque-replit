import { economicQuote } from "@shared/commerce"
import { tokenRightsFailure } from "@shared/legal"
import { bookAcceptance, LegalRequirementError } from "./legal"
import { hashEconomicTerms, reviewedCommercialAgreement } from "./commercial"
import { commercialLegalReady } from "./legalConfig"
import { betaPaymentsEnabled, priceFor, stripeEnabled } from "./payments"
import { tintaState } from "./economy"

export async function quoteToken(tx: any, userId: number, book: any, kind: "support" | "sale", payWith: "money" | "tinta") {
  if (!commercialLegalReady()) throw new LegalRequirementError("Las compras requieren completar la revisión comercial.", "COMMERCIAL_REVIEW_PENDING", 503)
  const permission = await bookAcceptance(book, tx)
  const failure = tokenRightsFailure(permission?.choices, kind)
  if (failure) throw new LegalRequirementError(failure, "TOKEN_RIGHTS_REQUIRED")
  const agreement = await reviewedCommercialAgreement(book.id, permission!.receipt.id, permission!.receipt.workHash, tx)
  if (!agreement) throw new LegalRequirementError("El titular debe aceptar el acuerdo económico de esta edición y completar su revisión.", "WORK_COMMERCIAL_REVIEW_REQUIRED")
  const provider = payWith === "tinta" ? "tinta" : stripeEnabled() ? "stripe" : "beta"
  if (provider === "beta" && !betaPaymentsEnabled()) throw new LegalRequirementError("Los pagos no están configurados.", "PAYMENTS_NOT_READY", 503)
  const price = priceFor(kind, book), wallet = payWith === "tinta" ? await tintaState(tx, userId) : null
  const terms = agreement.document
  const economics = economicQuote({ bookId: book.id, workHash: terms.workHash,
    agreementId: agreement.receipt.id, agreementHash: agreement.hash, kind, provider, currency: "mxn",
    units: price.tinta, nominalCents: price.cents, availableBackingCents: wallet?.backing || 0,
    authorShareBps: terms.authorShareBps, holdDays: terms.holdDays, minimumCents: terms.minimumCents })
  return { hash: hashEconomicTerms({ userId, economics }), economics,
    canPay: !wallet || wallet.balance >= price.tinta, agreement: { id: agreement.receipt.id, hash: agreement.hash, document: terms } }
}
