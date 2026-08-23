import test from "node:test"
import assert from "node:assert/strict"
import { compileTloqueScore } from "../shared/audio"
import { GM_ORCHESTRAL_STRINGS_MANIFEST, type InstrumentManifest } from "../shared/instrument-manifest"
import {
  deterministicRoundRobinIndex,
  resolveInstrumentManifest,
  resolvePerformanceRoute,
} from "../client/src/audio/PerformanceEngine"

const SCORE = `TLOQUE_SCORE 2
tempo 72
meter 4/4
loop false
seed 99
quality master
module builtin
track violin synth=pad instrument=strings.violin program=40 role=melody gain=0.3 pan=0 attack=0.1 release=1 expression=0.8 brightness=0.6 vibrato=0.1
section phrase form=exposition bars=1 repeat=1 fade=0 tempo=72 rubato=0
use violin
1:1 C5 1 velocity=0.5 articulation=legato
1:2 D5 1 velocity=0.5 articulation=pizzicato
1:3 E5 1 velocity=0.5 articulation=tremolo
end`

test("el manifest GM no promete técnicas que el banco no estandariza", () => {
  assert.deepEqual(GM_ORCHESTRAL_STRINGS_MANIFEST.capabilities, ["dedicated-articulation"])
  assert.deepEqual(
    GM_ORCHESTRAL_STRINGS_MANIFEST.articulations.map(item => item.articulation),
    ["tremolo", "pizzicato"],
  )
})

test("el resolver conserva exactamente el fallback GM actual", () => {
  const result = compileTloqueScore(SCORE)
  assert.equal(result.ok, true)
  if (!result.ok) return
  const violin = result.recipe.plan.tracks[0]
  assert.equal(resolveInstrumentManifest(violin)?.id, "gm-orchestral-strings")
  assert.deepEqual(resolvePerformanceRoute(violin, "normal"), {
    manifestId: "gm-orchestral-strings",
    articulation: "normal",
    program: 40,
    source: "base-program",
    route: null,
  })
  assert.equal(resolvePerformanceRoute(violin, "legato").program, 40)
  assert.equal(resolvePerformanceRoute(violin, "pizzicato").program, 45)
  assert.equal(resolvePerformanceRoute(violin, "tremolo").program, 44)
})

test("un manifest premium puede declarar articulaciones y capacidades reales sin cambiar TloqueScore", () => {
  const result = compileTloqueScore(SCORE)
  assert.equal(result.ok, true)
  if (!result.ok) return
  const violin = result.recipe.plan.tracks[0]
  const premium: InstrumentManifest = {
    version: 1,
    id: "test-solo-violin",
    family: "strings",
    name: "Test solo violin",
    instruments: ["strings.violin"],
    basePrograms: [40],
    capabilities: ["dedicated-articulation", "velocity-layers", "round-robin", "true-legato", "release-samples"],
    articulations: [
      { articulation: "normal", program: 70, velocityLayers: 4, roundRobins: 4, releaseSamples: true },
      { articulation: "legato", program: 71, velocityLayers: 3, trueLegato: true, releaseSamples: true },
      { articulation: "spiccato", program: 72, velocityLayers: 5, roundRobins: 6 },
    ],
  }
  const legato = resolvePerformanceRoute(violin, "legato", [premium])
  assert.equal(legato.program, 71)
  assert.equal(legato.route?.trueLegato, true)
  assert.equal(legato.source, "dedicated-articulation")
})

test("round robin es determinista para una misma obra y evento", () => {
  const first = deterministicRoundRobinIndex(20260823, "violin:bar4:beat1:C5", 6)
  const second = deterministicRoundRobinIndex(20260823, "violin:bar4:beat1:C5", 6)
  assert.equal(first, second)
  assert.ok(first >= 0 && first < 6)
  assert.equal(deterministicRoundRobinIndex(1, "x", 1), 0)
})
