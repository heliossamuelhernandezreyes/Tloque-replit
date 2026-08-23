import test from "node:test"
import assert from "node:assert/strict"
import {
  AUDIO_CONTRACT_VERSION, DEFAULT_TLOQUE_SCORE, DEFAULT_TLOQUE_SCORE_V1, DEFAULT_UI_SOUND_RECIPE,
  TLOQUE_SCORE_COMPILER_V1, TLOQUE_SCORE_COMPILER_VERSION, compileTloqueScore, uiSoundEventKeySchema,
  anyLinearScoreRecipeSchema, uiSoundRecipeSchema,
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
    assert.equal(first.recipe.plan.controls.length, 4)
    assert.equal(first.recipe.plan.humanize, 0.12)
    assert.equal(first.recipe.plan.tracks[1].vibrato, 0.16)
    assert.equal(first.recipe.plan.tracks[0].timbre, "natural")
    assert.equal(first.recipe.plan.events[0].timbre, "natural")
    assert.equal(first.recipe.plan.sections[0].rubato, 0.08)
    assert.equal(first.recipe.plan.quality, "master")
  }
})

test("TloqueScore V2.1 compila interpretación expresiva y articulaciones extendidas", () => {
  const result = compileTloqueScore(`TLOQUE_SCORE 2
title "Frase expresiva"
tempo 60
meter 4/4
loop false
seed 9
humanize 0
quality master
module builtin
track violin synth=pad instrument=strings.violin program=40 role=melody gain=0.25 pan=0.1 attack=0.12 release=1.5 expression=0.6 brightness=0.5 vibrato=0.1
section phrase form=exposition bars=2 repeat=1 fade=1 tempo=60 rubato=0.2
use violin
control 1:1 expression=0.4 vibrato=0.1 brightness=0.3 pedal=down bend=0 ramp=0
1:1 C5 1 velocity=0.5 articulation=pizzicato
control 1:2 expression=0.8 vibrato=0.6 brightness=0.8 bend=0.5 ramp=1
1:2 E5 1 velocity=0.6 articulation=spiccato
control 2:1 pedal=up bend=0 ramp=0.5
2:1 G5 2 velocity=0.7 articulation=harmonic
end`)
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.diagnostics))
  if (!result.ok || result.recipe.version !== 2) return
  assert.equal(result.recipe.plan.compilerVersion, "tloque-score-compiler-v2.1")
  assert.equal(result.recipe.plan.controls.length, 3)
  assert.deepEqual(result.recipe.plan.events.map(event => event.articulation), ["pizzicato", "spiccato", "harmonic"])
  assert.equal(result.recipe.plan.controls[1].expression, 0.8)
  assert.equal(result.recipe.plan.controls[1].pitchBend, 0.5)
  assert.equal(result.recipe.plan.controls[2].pedal, false)
})

test("TloqueScore V2.1 señala parámetros y gestos inválidos por línea", () => {
  const result = compileTloqueScore(`TLOQUE_SCORE 2
track violin synth=pad role=melody gain=0.2 pan=0 expresion=0.5
section phrase form=exposition bars=1
use violin
control 1:1 pedal=middle bend=5
1:1 C5 1 velocity=0.5 articulation=martellato
end`)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.ok(result.diagnostics.some(item => item.line === 2 && item.message.includes("expresion")))
})

test("TloqueScore V1 sigue compilando sin migrar partituras existentes", () => {
  const result = compileTloqueScore(DEFAULT_TLOQUE_SCORE_V1)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.recipe.version, 1)
  assert.equal(result.recipe.plan.compilerVersion, TLOQUE_SCORE_COMPILER_V1)
  assert.equal(result.recipe.plan.totalBars, 4)
})

test("los planes V2 guardados antes de V2.1 conservan compatibilidad", () => {
  const compiled = compileTloqueScore(DEFAULT_TLOQUE_SCORE)
  assert.equal(compiled.ok, true)
  if (!compiled.ok || compiled.recipe.version !== 2) return
  const legacy = JSON.parse(JSON.stringify(compiled.recipe))
  legacy.plan.compilerVersion = "tloque-score-compiler-v2"
  delete legacy.plan.humanize
  delete legacy.plan.controls
  for (const track of legacy.plan.tracks) {
    delete track.expression
    delete track.brightness
    delete track.vibrato
    delete track.timbre
  }
  for (const event of legacy.plan.events) delete event.timbre
  for (const section of legacy.plan.sections) delete section.rubato
  const parsed = anyLinearScoreRecipeSchema.parse(legacy)
  assert.equal(parsed.version, 2)
  if (parsed.version !== 2) return
  assert.equal(parsed.plan.humanize, 0)
  assert.deepEqual(parsed.plan.controls, [])
  assert.equal(parsed.plan.tracks[0].expression, 1)
  assert.equal(parsed.plan.tracks[0].timbre, "natural")
  assert.equal(parsed.plan.events[0].timbre, "natural")
  assert.equal(parsed.plan.sections[0].rubato, 0)
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
  assert.equal(uiSoundRecipeSchema.safeParse({ ...DEFAULT_UI_SOUND_RECIPE, voices: [{ ...DEFAULT_UI_SOUND_RECIPE.voices[0], duration: 20 }] }).success, false)
  assert.equal(uiSoundRecipeSchema.safeParse({ ...DEFAULT_UI_SOUND_RECIPE, voices: Array.from({ length: 9 }, () => DEFAULT_UI_SOUND_RECIPE.voices[0]) }).success, false)
})

test("el contrato expone sólo eventos estables conocidos", () => {
  assert.equal(AUDIO_CONTRACT_VERSION, "tloque-audio-2026-08-v2")
  assert.equal(uiSoundEventKeySchema.safeParse("ui.orb.tap").success, true)
  assert.equal(uiSoundEventKeySchema.safeParse("ui.arbitrary.execute").success, false)
})
