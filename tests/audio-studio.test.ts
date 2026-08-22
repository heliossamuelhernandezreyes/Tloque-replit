import test from "node:test"
import assert from "node:assert/strict"
import {
  AUDIO_CONTRACT_VERSION, DEFAULT_TLOQUE_SCORE, DEFAULT_TLOQUE_SCORE_V1, DEFAULT_UI_SOUND_RECIPE,
  TLOQUE_SCORE_COMPILER_V1, TLOQUE_SCORE_COMPILER_VERSION, compileTloqueScore, uiSoundEventKeySchema,
  uiSoundRecipeSchema,
} from "../shared/audio"

test("TloqueScore compila una partitura instrumental determinista", () => {
  const first = compileTloqueScore(DEFAULT_TLOQUE_SCORE)
  const second = compileTloqueScore(DEFAULT_TLOQUE_SCORE)
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  if (!first.ok || !second.ok) return
  assert.equal(first.recipe.plan.compilerVersion, TLOQUE_SCORE_COMPILER_VERSION)
  assert.equal(first.recipe.plan.sourceHash, second.recipe.plan.sourceHash)
  assert.deepEqual(first.recipe.plan, second.recipe.plan)
  assert.equal(first.recipe.version, 2)
  assert.equal(first.recipe.plan.totalBars, 18)
  assert.equal(first.recipe.plan.tracks.length, 3)
  assert.equal(first.recipe.plan.events.length, 69)
  if (first.recipe.version === 2) {
    assert.deepEqual(first.recipe.plan.sections.map(section => section.form), ["exposition", "development", "recapitulation", "coda"])
    assert.equal(first.recipe.plan.rests.length, 1)
    assert.equal(first.recipe.plan.quality, "master")
  }
})

test("TloqueScore V1 sigue compilando sin migrar partituras existentes", () => {
  const result = compileTloqueScore(DEFAULT_TLOQUE_SCORE_V1)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.recipe.version, 1)
  assert.equal(result.recipe.plan.compilerVersion, TLOQUE_SCORE_COMPILER_V1)
  assert.equal(result.recipe.plan.totalBars, 4)
})

test("TloqueScore rechaza JavaScript, letras y comandos desconocidos", () => {
  for (const line of ["eval alert(1)", "lyrics hola mundo", "javascript console.log(1)"]) {
    const result = compileTloqueScore(`TLOQUE_SCORE 1\n${line}`)
    assert.equal(result.ok, false)
  }
})

test("TloqueScore conserva sostenidos y calcula un compás 6/8", () => {
  const result = compileTloqueScore(`TLOQUE_SCORE 1
tempo 72
meter 6/8
loop false
track motif synth=bell gain=0.2 pan=0
1:3 F#4,A4 0.5 velocity=0.4`)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.recipe.plan.events[0].notes, [66, 69])
  assert.equal(result.recipe.plan.events[0].timeBeats, 1)
  assert.equal(result.recipe.plan.totalBeats, 3)
})

test("UiSoundRecipe limita duración, ganancia y número de voces", () => {
  assert.equal(uiSoundRecipeSchema.safeParse(DEFAULT_UI_SOUND_RECIPE).success, true)
  assert.equal(uiSoundRecipeSchema.safeParse({
    ...DEFAULT_UI_SOUND_RECIPE,
    voices: [{ ...DEFAULT_UI_SOUND_RECIPE.voices[0], duration: 20 }],
  }).success, false)
  assert.equal(uiSoundRecipeSchema.safeParse({
    ...DEFAULT_UI_SOUND_RECIPE,
    voices: Array.from({ length: 9 }, () => DEFAULT_UI_SOUND_RECIPE.voices[0]),
  }).success, false)
})

test("el contrato expone sólo eventos estables conocidos", () => {
  assert.equal(AUDIO_CONTRACT_VERSION, "tloque-audio-2026-08-v2")
  assert.equal(uiSoundEventKeySchema.safeParse("ui.orb.tap").success, true)
  assert.equal(uiSoundEventKeySchema.safeParse("ui.arbitrary.execute").success, false)
})
