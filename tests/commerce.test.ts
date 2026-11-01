import test from "node:test"
import assert from "node:assert/strict"
import { cashForTinta, commercialText, economicQuote, settlementWindow, splitCents } from "../shared/commerce.ts"

const input = { bookId: 1, workHash: "a".repeat(64), agreementId: 1, agreementHash: "b".repeat(64), kind: "support" as const,
  provider: "tinta" as const, currency: "mxn" as const, units: 10, nominalCents: 2000,
  authorShareBps: 9000, holdDays: 30, minimumCents: 10000, availableBackingCents: 9900 }

test("55 Tintas por $99 no producen $110 de ingreso: se agota el efectivo antes del bono", () => {
  let backing = 9900, paid = 0
  const bases: number[] = []
  for (let index = 0; index < 11; index++) {
    const quote = economicQuote({ ...input, units: 5, nominalCents: 1000, availableBackingCents: backing })
    bases.push(quote.cashBasisCents); backing -= quote.cashBasisCents
    paid += quote.authorCents + quote.platformCents
  }
  assert.deepEqual(bases, [1000,1000,1000,1000,1000,1000,1000,1000,1000,900,0])
  assert.equal(backing, 0); assert.equal(paid, 9900)
})
test("tarjeta, Tinta parcialmente respaldada y beta conservan sus bases y porcentajes", () => {
  assert.deepEqual(splitCents(1001,9000), { authorCents: 901, platformCents: 100 })
  assert.deepEqual(splitCents(1001,5000), { authorCents: 501, platformCents: 500 })
  const card = economicQuote({ ...input, provider: "stripe", availableBackingCents: 0 })
  assert.equal(card.chargedCents, 2000); assert.equal(card.authorCents, 1800)
  const partial = economicQuote({ ...input, availableBackingCents: 730 })
  assert.equal(partial.chargedCents, 0); assert.equal(partial.authorCents, 657); assert.equal(partial.platformCents, 73)
  const beta = economicQuote({ ...input, provider: "beta" })
  assert.equal(beta.cashBasisCents, 0); assert.equal(beta.authorCents, 0)
  assert.equal(cashForTinta(0,10), 0)
})
test("cada centavo se conserva incluso en importes grandes y se rechazan cifras no seguras", () => {
  for (const cents of [0,1,2,3,999,1001,19900,Number.MAX_SAFE_INTEGER]) for (const bps of [0,5000,9000,10000]) {
    const split = splitCents(cents,bps); assert.equal(split.authorCents+split.platformCents,cents)
  }
  for (const cents of [NaN,Infinity,-1,0.1,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>splitCents(cents,9000))
  assert.throws(()=>splitCents(100,10001));assert.throws(()=>cashForTinta(Infinity,1))
})
test("la espera y mínimo de una compra aceptada no cambian con la configuración posterior", () => {
  const quote = economicQuote(input)
  const frozen = settlementWindow("2026-01-01T00:00:00Z",quote,{holdDays:180,minimumCents:100000})
  assert.equal(frozen.availableAt,"2026-01-31T00:00:00.000Z");assert.equal(frozen.minimumCents,10000);assert.equal(frozen.frozen,true)
  assert.equal(settlementWindow("2026-01-01T00:00:00Z",null,{holdDays:7,minimumCents:1000}).frozen,false)
})
test("el acuerdo identifica edición, reparto, costo de promociones y condiciones efectivas", () => {
  const text = commercialText({ operator:{name:"Operador simulado",address:"Domicilio de prueba",privacyEmail:"test@fixture.mx",phone:"8180000000"},
    bookId:1,title:"Edición de prueba",author:"Autor",workHash:input.workHash,authorShareBps:9000,supportUnits:10,holdDays:37,minimumCents:15000 })
  for (const fragment of ["90% titular", "primero el respaldo", "$99.00", "37 días", "$150.00 MXN", "no calcula ni practica retenciones", "No se ceden derechos morales", input.workHash]) assert.ok(text.includes(fragment),fragment)
})
