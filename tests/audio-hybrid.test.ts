import test from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_PROCEDURAL_RECIPE,
  audioSourceTypeSchema,
  proceduralRecipeFor,
  proceduralRecipeSchema,
} from "../shared/audio"

test("la Fonoteca híbrida distingue pista, síntesis y banco instrumental", () => {
  assert.equal(audioSourceTypeSchema.parse("stream"), "stream")
  assert.equal(audioSourceTypeSchema.parse("procedural"), "procedural")
  assert.equal(audioSourceTypeSchema.parse("soundfont"), "soundfont")
  assert.throws(() => audioSourceTypeSchema.parse("youtube"))
})

test("una receta procedural es pequeña, determinista y musicalmente acotada", () => {
  const recipe = proceduralRecipeFor({
    preset: "warm_memory",
    rootMidi: 52,
    scale: "minor",
    bpm: 62,
    density: 0.4,
    brightness: 0.55,
    movement: 0.25,
    seed: 42,
  })
  assert.equal(recipe.version, 1)
  assert.equal(recipe.bars, DEFAULT_PROCEDURAL_RECIPE.bars)
  assert.ok(JSON.stringify(recipe).length < 400)
  assert.deepEqual(proceduralRecipeSchema.parse(recipe), recipe)
  assert.throws(() => proceduralRecipeSchema.parse({ ...recipe, bpm: 400 }))
  assert.throws(() => proceduralRecipeSchema.parse({ ...recipe, rootMidi: 1 }))
})
