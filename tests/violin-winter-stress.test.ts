import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  VIOLIN_WINTER_STRESS_ID,
  VIOLIN_WINTER_STRESS_INSTRUMENT,
  VIOLIN_WINTER_STRESS_SEED,
  VIOLIN_WINTER_STRESS_SEGMENTS,
  compileViolinWinterStressV1,
  violinWinterStressScoreV1,
} from "../shared/violin-winter-stress"

test("Winter Stress v1 es determinista y exclusivo del violín híbrido", () => {
  assert.equal(VIOLIN_WINTER_STRESS_ID, "violin-winter-stress-v1")
  assert.equal(VIOLIN_WINTER_STRESS_INSTRUMENT, "strings.violin")
  assert.equal(VIOLIN_WINTER_STRESS_SEED, 20260825)
  const a = violinWinterStressScoreV1()
  const b = violinWinterStressScoreV1()
  assert.equal(a, b)
  assert.match(a, /humanize 0/)
  assert.match(a, /quality studio/)
  assert.match(a, /module native-auto/)
  assert.match(a, /instrument=strings\.violin/)
})

test("Winter Stress v1 compila y conserva seis tipos de estrés musical distintos", () => {
  assert.deepEqual(VIOLIN_WINTER_STRESS_SEGMENTS.map(item => item.stress), [
    "transient-repeat",
    "rapid-repetition",
    "connected-bow",
    "register-jump",
    "dynamic-ramp",
    "high-register-strong",
  ])
  const score = violinWinterStressScoreV1()
  const result = compileViolinWinterStressV1()
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.diagnostics))
  if (!result.ok) return
  assert.equal(result.recipe.version, 2)
  assert.equal(result.recipe.plan.tracks.length, 1)
  assert.match(score, /track solo .*instrument=strings\.violin/)
  assert.ok(result.recipe.plan.events.length >= 70, "el benchmark debe presionar ataques y repeticiones")
  assert.ok(result.recipe.plan.events.some(event => event.articulation === "legato"), "debe incluir continuidad legato")
  const notes = result.recipe.plan.events.flatMap(event => event.notes)
  assert.ok(Math.min(...notes) <= 67, "debe alcanzar registro medio-bajo")
  assert.ok(Math.max(...notes) >= 88, "debe alcanzar registro agudo")
})

test("Winter Stress v1 contiene rampas físicas p→ff y presión de arco fuerte", () => {
  const score = violinWinterStressScoreV1()
  assert.match(score, /section dynamic-rise/)
  assert.match(score, /expression=0\.28/)
  assert.match(score, /expression=0\.88/)
  assert.match(score, /pressure=0\.88/)
  assert.match(score, /bow=0\.18/)
  assert.match(score, /section high-pressure/)
})

test("el runner exige el banco real y nunca acepta síntesis fallback para el A/B", () => {
  const runner = readFileSync("client/src/audio/ViolinWinterStressRunner.ts", "utf8")
  assert.match(runner, /preflightNativeSamplePacks/)
  assert.match(runner, /violinItem\?\.status !== "ready"/)
  assert.match(runner, /No se usará síntesis fallback/)
})

test("Winter compara dos renders completos del mismo grafo de producción", () => {
  const runner = readFileSync("client/src/audio/ViolinWinterStressRunner.ts", "utf8")
  const validation = readFileSync("shared/native-hybrid-validation.ts", "utf8")
  assert.match(runner, /hybridMode: "none"/)
  assert.match(runner, /hybridMode: "quality"/)
  assert.doesNotMatch(runner, /scheduleHybridPhysicalOverlay/)
  assert.doesNotMatch(runner, /physicalBus/)
  assert.match(runner, /source\.instrumentId !== VIOLIN_WINTER_STRESS_INSTRUMENT/)
  assert.doesNotMatch(runner, /buildHybridAbReport/)
  assert.match(validation, /humanReviewMode/)
})