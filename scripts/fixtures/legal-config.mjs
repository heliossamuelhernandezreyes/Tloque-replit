// Disposable test data only. Not evidence of a real legal review or a contact.
export const LEGAL_FIXTURE_ENV = {
  LEGAL_OPERATOR_NAME: 'Operador simulado del catálogo',
  LEGAL_OPERATOR_ADDRESS: 'Domicilio simulado 123, Monterrey, Nuevo León',
  LEGAL_PRIVACY_EMAIL: 'contacto@fixture.mx', LEGAL_SUPPORT_PHONE: '8180000000',
  LEGAL_PUBLICATION_REVIEW_REF: 'fixture-publicacion',
  LEGAL_COMMERCIAL_REVIEW_REF: 'fixture-comercial', TINTA_LEGAL_REVIEW_REF: 'fixture-tinta',
};
export function legalFixtureAcceptance(bundle) {
  return { documentHash: bundle.hash, accepted: true, adultAndAuthorized: true, hasRights: true,
    origin: 'original', evidence: '', choices: { offline: true, personalPrint: true, commercialPrint: true, audio: true, translation: false, collectibles: true } };
}
