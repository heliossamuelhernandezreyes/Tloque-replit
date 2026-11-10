import { economicQuote } from "@shared/commerce"
import { LegalRequirementError } from "./legal"
import { hashEconomicTerms } from "./commercial"
import { requireEditionCommerce } from "./editionCommerce"
import { betaPaymentsEnabled, priceFor, stripeEnabled } from "./payments"
import { tintaState } from "./economy"

export async function quoteToken(tx: any, userId: number, book: any, kind: "support" | "sale", payWith: "money" | "tinta") {
  const { agreement } = await requireEditionCommerce(tx, book, kind)
  const provider = payWith === "tinta" ? "tinta" : stripeEnabled() ? "stripe" : "beta"
  if (provider === "beta" && !betaPaymentsEnabled()) throw new LegalRequirementError("Los pagos no están configurados.", "PAYMENTS_NOT_READY", 503)
  const price = priceFor(kind, book), wallet = payWith === "tinta" ? await tintaState(tx, userId) : null
  const terms = agreement.document
  const economics = economicQuote({ bookId: book.id, workHash: terms.workHash,
    agreementId: agreement.receipt.id, agreementHash: agreement.hash, kind, provider, currency: "mxn",
    units: price.tinta, nominalCents: payWith === "tinta" ? price.tinta * 200 : price.cents, availableBackingCents: wallet?.backing || 0, walletFunding: wallet?.funding,
    ...(kind === "sale" ? { fixedAuthorCents: terms.saleAuthorFixedCents } : {}),
    authorShareBps: kind === "sale" ? terms.saleAuthorShareBps : payWith === "money" ? terms.directAuthorShareBps : terms.authorShareBps, holdDays: terms.holdDays, minimumCents: terms.minimumCents })
  return { hash: hashEconomicTerms({ userId, economics }), economics,
    canPay: !wallet || wallet.balance >= price.tinta, agreement: { id: agreement.receipt.id, hash: agreement.hash, document: terms } }
}
