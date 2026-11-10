import { tokenRightsFailure } from "@shared/legal"
import { isEditionRestricted } from "@shared/edition-access"
import { bookAcceptance, LegalRequirementError } from "./legal"
import { reviewedCommercialAgreement } from "./commercial"
import { commercialLegalReady } from "./legalConfig"

/** Every paid channel must prove the rights it delivers before creating a debit. */
export async function requireEditionCommerce(tx: any, book: any, kind: "support" | "sale" | "card") {
  if (!commercialLegalReady()) throw new LegalRequirementError("Las compras requieren completar la revisión comercial.", "COMMERCIAL_REVIEW_PENDING", 503)
  if (isEditionRestricted(book) || book.status !== "published" || !book.authorId || book.isClassic) {
    throw new LegalRequirementError("Esta edición no está disponible para nuevas compras.", "EDITION_UNAVAILABLE", 404)
  }
  const permission = await bookAcceptance(book, tx)
  const choices = permission?.choices
  const failure = kind === "card"
    ? !choices?.collectibles || !choices.monetization || !choices.permanentDigital || !choices.offline
      ? "El titular debe autorizar la venta del coleccionable y la edición digital permanente con descarga que incluye." : null
    : tokenRightsFailure(choices, kind)
  if (failure || !permission) throw new LegalRequirementError(failure || "Faltan permisos de esta edición.", "TOKEN_RIGHTS_REQUIRED")
  const agreement = await reviewedCommercialAgreement(book.id, permission.receipt.id, permission.receipt.workHash, tx)
  if (!agreement) throw new LegalRequirementError("El titular debe aceptar el acuerdo económico de esta edición y completar su revisión.", "WORK_COMMERCIAL_REVIEW_REQUIRED")
  return { permission, agreement }
}
