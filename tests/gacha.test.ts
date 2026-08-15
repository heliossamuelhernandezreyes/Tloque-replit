import test from "node:test"
import assert from "node:assert/strict"
import {
  PITY, RARITIES, TICKET, checkInvariants, drawRarity, nextPity, poolCushion, splitTicket,
  type RarityKey,
} from "../shared/gacha"

const stock = (keys: RarityKey[]) => Object.fromEntries(
  RARITIES.map(r => [r.key, keys.includes(r.key)]),
) as Record<RarityKey, boolean>

test("las probabilidades y el reparto conservan sus invariantes", () => {
  assert.deepEqual(checkInvariants(), { ok: true })
  assert.ok(poolCushion() > 0)
  const split = splitTicket(74)
  assert.equal(split.toAuthorDirect + split.toPool + split.toHouse, TICKET.price)
  assert.equal(split.authorTotal, TICKET.direct + 74)
})

test("nunca otorga un bono que el pozo no pueda pagar", () => {
  const result = drawRarity({
    poolBalance: 10,
    pitySinceGolden: 0,
    pitySinceLegendary: 0,
    available: stock(RARITIES.map(r => r.key)),
    rng: () => 0.99999,
  })
  assert.ok(result.bonus <= 10)
})

test("usa la rareza solvente más baja cuando no hay cartas comunes", () => {
  const result = drawRarity({
    poolBalance: 12,
    pitySinceGolden: 0,
    pitySinceLegendary: 0,
    available: stock(["rare"]),
    rng: () => 0.1,
  })
  assert.equal(result.rarity, "rare")
  assert.equal(result.reason, "no_stock")
})

test("la piedad garantiza sus pisos y se reinicia al obtenerlos", () => {
  const result = drawRarity({
    poolBalance: 10_000,
    pitySinceGolden: PITY.golden.every - 1,
    pitySinceLegendary: PITY.legendary.every - 1,
    available: stock(RARITIES.map(r => r.key)),
    rng: () => 0.1,
  })
  assert.equal(result.rarity, "legendary")
  assert.equal(result.pityApplied, true)
  assert.deepEqual(nextPity("legendary", 79, 299), { sinceGolden: 0, sinceLegendary: 0 })
})
