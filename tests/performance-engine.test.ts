import test from "node:test"
import assert from "node:assert/strict"
import { compileTloqueScore } from "../shared/audio"
import { GM_ORCHESTRAL_STRINGS_MANIFEST, type InstrumentManifest } from "../shared/instrument-manifest"
import {
  buildPerformancePlan,
  buildPerformanceRoutingPlan,
  deterministicRoundRobinIndex,
  resolveInstrumentManifest,
  resolvePerformanceRoute,
  velocityLayerIndex,
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

const PREMIUM: InstrumentManifest = {
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

test("el manifest GM no promete técnicas que el banco no estandariza", () => {
  assert.deepEqual(GM_ORCHESTRAL_STRINGS_MANIFEST.capabilities, ["dedicated-articulation"])
  assert.deepEqual(GM_ORCHESTRAL_STRINGS_MANIFEST.articulations.map(item => item.articulation), ["tremolo", "pizzicato"])
})

test("el resolver conserva exactamente el fallback GM actual", () => {
  const result = compileTloqueScore(SCORE)
  assert.equal(result.ok, true)
  if (!result.ok) return
  const violin = result.recipe.plan.tracks[0]
  assert.equal(resolveInstrumentManifest(violin)?.id, "gm-orchestral-strings")
  assert.deepEqual(resolvePerformanceRoute(violin, "normal"), {
    manifestId: "gm-orchestral-strings", articulation: "normal", program: 40, source: "base-program", route: null,
  })
  assert.equal(resolvePerformanceRoute(violin, "legato").program, 40)
  assert.equal(resolvePerformanceRoute(violin, "pizzicato").program, 45)
  assert.equal(resolvePerformanceRoute(violin, "tremolo").program, 44)
})

test("live y export comparten el mismo routing manifest-aware", () => {
  const result = compileTloqueScore(SCORE)
  assert.equal(result.ok, true)
  if (!result.ok) return
  const routing = buildPerformanceRoutingPlan(result.recipe.plan.tracks, result.recipe.plan.events)
  assert.deepEqual(routing.channels.map(item => item.program), [40, 45, 44])
  assert.equal(routing.channelForEvent("violin", "legato"), 0)
  assert.equal(routing.channels[routing.channelForEvent("violin", "pizzicato")!].program, 45)
  assert.equal(routing.channels[routing.channelForEvent("violin", "tremolo")!].program, 44)
})

test("el PerformancePlan compila decisiones acústicas deterministas por evento", () => {
  const result = compileTloqueScore(SCORE)
  assert.equal(result.ok, true)
  if (!result.ok) return
  const plan = buildPerformancePlan(result.recipe)
  assert.equal(plan.events.length, 3)
  assert.deepEqual(plan.events.map(event => event.program), [40, 45, 44])
  assert.deepEqual(plan.events.map(event => event.manifestId), ["gm-orchestral-strings", "gm-orchestral-strings", "gm-orchestral-strings"])
  assert.equal(plan.decisionForEvent(1)?.source, "dedicated-articulation")
  assert.equal(plan.channelForEventIndex(1), plan.channelForEvent("violin", "pizzicato"))
})

test("un manifest premium activa velocity layers, RR, true legato y releases sin cambiar TloqueScore", () => {
  const source = `TLOQUE_SCORE 2
tempo 60
meter 4/4
loop false
seed 20260823
quality master
module builtin
track violin synth=pad instrument=strings.violin program=40 role=melody gain=0.3 pan=0 attack=0.1 release=1 expression=0.8 brightness=0.6 vibrato=0.1
section phrase form=exposition bars=1 repeat=1 fade=0 tempo=60 rubato=0
use violin
1:1 C5 1 velocity=0.2 articulation=normal
1:2 D5 1 velocity=0.8 articulation=legato
end`
  const result = compileTloqueScore(source)
  assert.equal(result.ok, true)
  if (!result.ok) return
  const violin = result.recipe.plan.tracks[0]
  const legato = resolvePerformanceRoute(violin, "legato", [PREMIUM])
  assert.equal(legato.program, 71)
  assert.equal(legato.route?.trueLegato, true)
  const plan = buildPerformancePlan(result.recipe, [PREMIUM])
  assert.equal(plan.events[0].program, 70)
  assert.equal(plan.events[0].velocityLayer, 0)
  assert.ok(plan.events[0].roundRobin >= 0 && plan.events[0].roundRobin < 4)
  assert.equal(plan.events[0].releaseSamples, true)
  assert.equal(plan.events[1].program, 71)
  assert.equal(plan.events[1].velocityLayer, 2)
  assert.equal(plan.events[1].trueLegato, true)
  assert.deepEqual(plan.events[1].previousNotes, [60])
})

test("round robin y velocity layer son deterministas", () => {
  const first = deterministicRoundRobinIndex(20260823, "violin:bar4:beat1:C5", 6)
  const second = deterministicRoundRobinIndex(20260823, "violin:bar4:beat1:C5", 6)
  assert.equal(first, second)
  assert.ok(first >= 0 && first < 6)
  assert.equal(deterministicRoundRobinIndex(1, "x", 1), 0)
  assert.equal(velocityLayerIndex(0, 4), 0)
  assert.equal(velocityLayerIndex(0.5, 4), 2)
  assert.equal(velocityLayerIndex(0.999, 4), 3)
})
