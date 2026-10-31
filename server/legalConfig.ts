import { z } from "zod"
import type { LegalOperator } from "@shared/legal"

type Environment = Record<string, string | undefined>
const clean = (value: string | undefined) => (value || "").trim()
function realValue(value: string, min = 5) {
  return value.length >= min && value.length <= 1000 && !/example\.|example@|tu[-_ ]|pendiente|placeholder|por definir|prueba/i.test(value)
}
export function legalConfiguration(env: Environment = process.env) {
  const operator: LegalOperator = {
    name: clean(env.LEGAL_OPERATOR_NAME), address: clean(env.LEGAL_OPERATOR_ADDRESS),
    privacyEmail: clean(env.LEGAL_PRIVACY_EMAIL), phone: clean(env.LEGAL_SUPPORT_PHONE),
  }
  const identityReady = realValue(operator.name) && realValue(operator.address, 15)
    && z.string().email().safeParse(operator.privacyEmail).success && realValue(operator.privacyEmail)
  const publicationReady = identityReady && realValue(clean(env.LEGAL_PUBLICATION_REVIEW_REF), 8)
  const commercialReady = publicationReady && realValue(operator.phone, 7)
    && realValue(clean(env.LEGAL_COMMERCIAL_REVIEW_REF), 8)
    && realValue(clean(env.TINTA_LEGAL_REVIEW_REF), 8)
  const gachaReady = commercialReady && realValue(clean(env.GACHA_LEGAL_REVIEW_REF), 8)
    && realValue(clean(env.GACHA_AUTHORIZATION_REF), 8)
    && realValue(clean(env.GACHA_PROCESSOR_APPROVAL_REF), 8)
  return { operator, identityReady, publicationReady, commercialReady, gachaReady }
}
export function commercialLegalReady() { return legalConfiguration().commercialReady }
export function gachaLegalReady() { return legalConfiguration().gachaReady }
