import test from "node:test"
import assert from "node:assert/strict"
import { compileTloqueScore } from "../shared/audio"
import { articulationDurationFactor } from "../client/src/audio/ScoreAudioMath"
import { buildOrchestralSynthPlan } from "../client/src/audio/OrchestralSynthPlan"
import { buildPerformancePlan, performedEventValues } from "../client/src/audio/PerformanceEngine"
import { UNIVERSAL_PERFORMANCE_DIRECTOR_VERSION } from "../client/src/audio/PerformanceDirector"
import { nativeModuleGroupsForRecipe, recipeForNativeModule } from "../client/src/audio/NativeAutoModule"

const PHRASE_SCORE = `TLOQUE_SCORE 2
title "Universal performance V2"
tempo 60
meter 4/4
loop false
seed 20260903
humanize 0.35
quality studio
module orchestra-synth
track violin synth=pad instrument=strings.violin program=40 role=melody gain=0.3 pan=0 attack=0.02 release=1 expression=0.8 brightness=0.55 vibrato=0.08 timbre=natural
section line form=development bars=2 repeat=1 fade=0 tempo=60 rubato=0
use violin
1:1 C5 0.5 velocity=0.50 articulation=legato
1:1.5 D5 0.5 velocity=0.50 articulation=legato
1:2 E5 0.5 velocity=0.50 articulation=legato
1:2.5 G5 0.5 velocity=0.50 articulation=legato
1:3 F5 0.5 velocity=0.50 articulation=legato
1:3.5 E5 0.5 velocity=0.50 articulation=legato
1:4 D5 0.5 velocity=0.50 articulation=legato
1:4.5 C5 0.5 velocity=0.50 articulation=legato
2:1 C5 0.5 velocity=0.46 articulation=normal
rest 2:1.5 0.5
2:2 D5 1 velocity=0.46 articulation=normal
end`

function phraseRecipe() {
  const result = compileTloqueScore(PHRASE_SCORE)
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.diagnostics))
  if (!result.ok || result.recipe.version !== 2) throw new Error("fixture inválido")
  return result.recipe
}

test("Universal Performance Director V2 construye arcos completos y jerarquía métrica", () => {
  const recipe = phraseRecipe()
  const first = buildPerformancePlan(recipe, [])
  const second = buildPerformancePlan(recipe, [])
  assert.equal(first.directorVersion, UNIVERSAL_PERFORMANCE_DIRECTOR_VERSION)
  assert.deepEqual(first.events, second.events)

  const openingPhrase = first.events.slice(0, 9)
  assert.ok(openingPhrase.every(event => event.phraseIndex === 0 && event.phraseLength === 9))
  assert.deepEqual(openingPhrase.map(event => event.phrasePosition), [0, 1, 2, 3, 4, 5, 6, 7, 8])
  assert.equal(openingPhrase[0].metricEmphasis, "primary")
  assert.equal(openingPhrase[4].metricEmphasis, "secondary")
  assert.ok(openingPhrase[0].directorReasons.includes("metric-primary"))
  assert.ok(openingPhrase.some(event => event.directorReasons.includes("phrase-climax")))
  assert.ok(openingPhrase.some(event => event.directorReasons.includes("phrase-arc-rise")))
  assert.ok(openingPhrase.some(event => event.directorReasons.includes("phrase-arc-release")))
})

test("la jerarquía métrica reconoce pulsos compuestos como 6/8", () => {
  const result = compileTloqueScore(PHRASE_SCORE.replace("meter 4/4", "meter 6/8"))
  assert.equal(result.ok, true)
  if (!result.ok) return
  const performance = buildPerformancePlan(result.recipe, [])
  assert.equal(performance.events[0].metricEmphasis, "primary")
  assert.equal(performance.events[4].metricEmphasis, "light")
  assert.equal(performance.events[6].metricEmphasis, "secondary")
})

test("un silencio escrito abre una frase nueva sin alterar notas ni articulaciones", () => {
  const recipe = phraseRecipe()
  const performance = buildPerformancePlan(recipe, [])
  const afterRest = performance.events[9]
  assert.equal(afterRest.phraseIndex, 1)
  assert.equal(afterRest.phrasePosition, 0)
  assert.equal(afterRest.phraseStart, true)
  assert.equal(afterRest.phraseEnd, true)
  assert.deepEqual(recipe.plan.events.map(event => event.notes), [
    [72], [74], [76], [79], [77], [76], [74], [72], [72], [74],
  ])
  assert.deepEqual(performance.events.map(event => event.articulation), recipe.plan.events.map(event => event.articulation))
})

test("realtime, MIDI/WAV, muestras nativas y síntesis parten del mismo evento interpretado", () => {
  const recipe = phraseRecipe()
  const performance = buildPerformancePlan(recipe, [])
  const rendered = buildOrchestralSynthPlan(recipe, new Set(["violin"]))
  assert.equal(rendered.length, recipe.plan.events.length)
  for (let index = 0; index < recipe.plan.events.length; index += 1) {
    const event = recipe.plan.events[index]
    const decision = performance.decisionForEvent(index)
    assert.ok(decision)
    const performed = performedEventValues(recipe, event, decision)
    assert.equal(rendered[index].timeSeconds, performed.startSeconds)
    assert.ok(Math.abs(rendered[index].durationSeconds - performed.durationSeconds * articulationDurationFactor(event.articulation)) < 1e-12)
    assert.equal(rendered[index].velocity, performed.velocity)
  }
})

test("el contrato interpretativo sigue siendo acotado y humanize=0 conserva neutralidad", () => {
  const recipe = phraseRecipe()
  const performance = buildPerformancePlan(recipe, [])
  for (const event of performance.events) {
    assert.ok(event.startOffsetSeconds >= -0.04 && event.startOffsetSeconds <= 0.04)
    assert.ok(event.durationScale >= 0.84 && event.durationScale <= 1.10)
    assert.ok(event.velocityScale >= 0.86 && event.velocityScale <= 1.14)
    assert.ok(event.phraseProgress >= 0 && event.phraseProgress <= 1)
  }

  const neutralSource = PHRASE_SCORE.replace("humanize 0.35", "humanize 0")
  const neutralResult = compileTloqueScore(neutralSource)
  assert.equal(neutralResult.ok, true)
  if (!neutralResult.ok) return
  const neutral = buildPerformancePlan(neutralResult.recipe, [])
  assert.ok(neutral.events.every(event => event.startOffsetSeconds === 0 && event.durationScale === 1 && event.velocityScale === 1))
})

test("la interpretación conserva identidad al separar una orquesta en bancos nativos", () => {
  const source = PHRASE_SCORE
    .replace("module orchestra-synth", "module native-auto")
    .replace(
      "track violin synth=pad instrument=strings.violin program=40 role=melody gain=0.3 pan=0 attack=0.02 release=1 expression=0.8 brightness=0.55 vibrato=0.08 timbre=natural",
      "track violin synth=pad instrument=strings.violin program=40 role=melody gain=0.3 pan=0 attack=0.02 release=1 expression=0.8 brightness=0.55 vibrato=0.08 timbre=natural\ntrack cello synth=bass instrument=strings.cello program=42 role=bass gain=0.25 pan=-0.1 attack=0.03 release=1 expression=0.76 brightness=0.4 vibrato=0.03 timbre=natural",
    )
    .replace("use violin\n1:1 C5", "use cello\n1:1 C3 2 velocity=0.42 articulation=normal\nuse violin\n1:1 C5")
  const result = compileTloqueScore(source)
  assert.equal(result.ok, true)
  if (!result.ok || result.recipe.version !== 2) return
  const violinGroup = nativeModuleGroupsForRecipe(result.recipe).find(group => group.trackIds.includes("violin"))
  assert.ok(violinGroup)
  const full = buildPerformancePlan(result.recipe, []).events.filter(event => event.trackId === "violin")
  const isolated = buildPerformancePlan(recipeForNativeModule(result.recipe, violinGroup), []).events
  assert.deepEqual(
    isolated.map(event => [event.identity, event.startOffsetSeconds, event.durationScale, event.velocityScale, event.phraseIndex, event.phrasePosition]),
    full.map(event => [event.identity, event.startOffsetSeconds, event.durationScale, event.velocityScale, event.phraseIndex, event.phrasePosition]),
  )
})
