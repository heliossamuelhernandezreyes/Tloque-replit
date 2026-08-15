import test from "node:test"
import assert from "node:assert/strict"
import { estimateReadingAttention } from "../shared/attention"

const paragraphs = [
  { index: 0, top: -100, bottom: 80 },
  { index: 1, top: 110, bottom: 310 },
  { index: 2, top: 340, bottom: 560 },
  { index: 3, top: 590, bottom: 800 },
]

test("la banda de atención elige un párrafo, no una palabra exacta", () => {
  const result = estimateReadingAttention({ paragraphs, viewportHeight: 800, attentionBand: 0.42 })
  assert.equal(result.paragraphIndex, 2)
  assert.equal(result.progress, 2 / 3)
  assert.ok(result.confidence > 0.95)
})

test("un desplazamiento rápido reduce la confianza sin inventar precisión", () => {
  const stable = estimateReadingAttention({ paragraphs, viewportHeight: 800, scrollVelocity: 0 })
  const moving = estimateReadingAttention({ paragraphs, viewportHeight: 800, scrollVelocity: 1_200 })
  assert.ok(moving.confidence < stable.confidence)
})
