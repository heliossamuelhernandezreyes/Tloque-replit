import test from "node:test"
import assert from "node:assert/strict"
import {
  CARD_PRICE_MAX, CARD_PRICE_MIN, MAX_CARDS_PER_BOOK, MAX_LOOSE_CARDS,
  sanitizeCardFx, validateCard,
} from "../server/cards"
import { collectionMaterialFor, collectionTier } from "../client/src/lib/rarities"

const art = "data:image/png;base64,AAAA"

test("mantiene los límites del sistema directo de cartas", () => {
  assert.equal(MAX_CARDS_PER_BOOK, 6)
  assert.equal(MAX_LOOSE_CARDS, 24)
  assert.equal(CARD_PRICE_MIN, 1)
  assert.equal(CARD_PRICE_MAX, 100)
})

test("normaliza efectos, rareza visual e intensidad sin aceptar campos arbitrarios", () => {
  const fx = sanitizeCardFx({
    layers: { back: art, mid: "", front: "" },
    effect: "fire", effectIntensity: 9,
    layerFx: { back: { effect: "not-real", intensity: -2 } },
    rarity: "ruby", frameId: "7.9", injected: "ignored",
  })
  assert.equal(fx.effect, "fire")
  assert.equal(fx.effectIntensity, 1)
  assert.deepEqual(fx.layerFx.back, { effect: "none", intensity: 0 })
  assert.equal(fx.rarity, "ruby")
  assert.equal(fx.frameId, 7)
  assert.equal("injected" in fx, false)
})

test("valida una carta de apoyo y una compra con Tinta", () => {
  const support = validateCard({ name: "  Luna  ", fx: { layers: { back: art } }, unlock: "support" })
  assert.equal(support.ok, true)
  if (support.ok) {
    assert.equal(support.card.name, "Luna")
    assert.equal(support.card.priceTinta, 0)
  }

  const tinta = validateCard({
    name: "Sol", unlock: "tinta", priceTinta: 25,
    fx: { layers: { back: "https://images.example.com/sol.webp" } },
  })
  assert.equal(tinta.ok, true)
})

test("rechaza arte inseguro, ausente, sobredimensionado y precios fuera de rango", () => {
  assert.equal(validateCard({ name: "Sin arte", fx: { layers: {} } }).ok, false)
  assert.equal(validateCard({ name: "SVG", fx: { layers: { back: "data:image/svg+xml;base64,PHN2Zz4=" } } }).ok, false)
  assert.equal(validateCard({ name: "JS", fx: { layers: { back: "javascript:alert(1)" } } }).ok, false)
  assert.equal(validateCard({ name: "Grande", fx: { layers: { back: "https://x.test/" + "a".repeat(400_001) } } }).ok, false)
  assert.equal(validateCard({ name: "Barata", unlock: "tinta", priceTinta: 0, fx: { layers: { back: art } } }).ok, false)
  assert.equal(validateCard({ name: "Cara", unlock: "tinta", priceTinta: 101, fx: { layers: { back: art } } }).ok, false)
})

test("la rareza coleccionable gobierna el material solo dentro del sorteo", () => {
  assert.equal(collectionMaterialFor("mythic", true, "copper").id, "diamond")
  assert.equal(collectionMaterialFor("golden", true, "silver").id, "gold")
  assert.equal(collectionMaterialFor("mythic", false, "copper").id, "copper")
  assert.ok(collectionTier("absolute") > collectionTier("legendary"))
})
