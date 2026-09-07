import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { OfflineAudioContext as NodeOfflineAudioContext } from "node-web-audio-api"
import { compileTloqueScore } from "../shared/audio"
import {
  ORCHESTRA_CONDUCTOR_RULE_VERSION,
  ORCHESTRA_CONDUCTOR_VERSION,
} from "../shared/orchestra-conductor"
import { buildNativeHybridPerformancePlan, NATIVE_HYBRID_PERFORMANCE_VERSION } from "../shared/native-hybrid-performance"
import { analyzeAudioBuffer } from "../client/src/audio/AudioRenderAnalysis"
import { applyOrchestraConductorToDynamics, orchestralContinuousDynamics } from "../client/src/audio/OrchestralDynamics"
import { buildOrchestraConductorPlan, orchestraSectionMemberDelay, orchestraSectionMemberOffset } from "../client/src/audio/OrchestraConductor"
import { buildOrchestralSynthPlan } from "../client/src/audio/OrchestralSynthPlan"
import { scheduleOrchestralSynthVoice } from "../client/src/audio/OrchestralSynthVoice"
import { buildPerformedRecipeV2, buildPerformancePlan, performedEventValues } from "../client/src/audio/PerformanceEngine"

Object.defineProperty(globalThis, "OfflineAudioContext", { value: NodeOfflineAudioContext, configurable: true })

const SCORE = `TLOQUE_SCORE 2
title "Orchestra Conductor V6"
tempo 120
meter 4/4
loop false
seed 20260907
humanize 0
quality studio
module orchestra-synth
track lead synth=pad instrument=strings.violin-section program=40 role=melody gain=0.3 pan=-0.15 attack=0.06 release=0.8 expression=0.8 brightness=0.58 vibrato=0.3
track harmony synth=pad instrument=strings.viola program=41 role=harmony gain=0.27 pan=0.12 attack=0.08 release=0.8 expression=0.75 brightness=0.48 vibrato=0.18
track bass synth=bass instrument=strings.cello program=42 role=bass gain=0.25 pan=-0.08 attack=0.08 release=0.9 expression=0.74 brightness=0.4 vibrato=0.12
track colour synth=warm instrument=woodwinds.flute program=73 role=texture gain=0.2 pan=0.2 attack=0.05 release=0.4 expression=0.7 brightness=0.62 vibrato=0.2
section rise form=development bars=2 repeat=1 fade=0 tempo=120 rubato=0
use lead
1:1 A4 1 velocity=0.48 articulation=legato
1:2 B4 1 velocity=0.58 articulation=legato
1:3 C5 1 velocity=0.76 articulation=accent
1:4 D5 0.5 velocity=0.82 articulation=spiccato
rest 1:4.5 2.5
2:3 E5 1 velocity=0.28 articulation=tenuto
use harmony
1:1 C4,E4,G4 2 velocity=0.55
1:3 D4,F4,A4 2 velocity=0.68
2:3 C4,E4,G4 1 velocity=0.26
use bass
1:1 A2 2 velocity=0.52
1:3 D3 2 velocity=0.66
2:3 C3 1 velocity=0.24
use colour
1:1 E5 2 velocity=0.5
1:3 F5 2 velocity=0.64
2:3 G5 1 velocity=0.22
end
section release form=coda bars=1 repeat=1 fade=1 tempo=90 rubato=0.1
use lead
1:1 A4 4 velocity=0.34 articulation=tenuto
use harmony
1:1 C4,E4 4 velocity=0.3 articulation=tenuto
use bass
1:1 A2 4 velocity=0.28 articulation=tenuto
end`

function recipe() {
  const compiled = compileTloqueScore(SCORE)
  assert.equal(compiled.ok, true, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics))
  if (!compiled.ok || compiled.recipe.version !== 2) throw new Error("fixture inválida")
  return compiled.recipe
}

function pcmHash(buffer: AudioBuffer) {
  return createHash("sha256").update(new Uint8Array(buffer.getChannelData(0).buffer)).digest("hex")
}

test("V6 compila una memoria de conjunto determinista, compartida y acotada", () => {
  const score = recipe()
  const first = buildOrchestraConductorPlan(score)
  const second = buildOrchestraConductorPlan(score)
  assert.equal(first.version, ORCHESTRA_CONDUCTOR_VERSION)
  assert.equal(first.ruleVersion, ORCHESTRA_CONDUCTOR_RULE_VERSION)
  assert.deepEqual([...first.decisions], [...second.decisions])

  const simultaneous = score.plan.events
    .map((event, index) => ({ event, index }))
    .filter(item => Math.abs(item.event.timeSeconds - score.plan.events[0].timeSeconds) < 1e-6)
    .map(item => first.decisions.get(item.index)!)
  assert.ok(simultaneous.length >= 4)
  for (const decision of simultaneous.slice(1)) {
    assert.equal(decision.ensembleEnergy, simultaneous[0].ensembleEnergy)
    assert.equal(decision.memoryEnergy, simultaneous[0].memoryEnergy)
    assert.equal(decision.density, simultaneous[0].density)
    assert.equal(decision.ensemblePhase, simultaneous[0].ensemblePhase)
  }
  for (const decision of first.decisions.values()) {
    assert.equal(decision.contractVersion, ORCHESTRA_CONDUCTOR_VERSION)
    assert.equal(decision.ruleVersion, ORCHESTRA_CONDUCTOR_RULE_VERSION)
    assert.ok(decision.ensembleEnergy >= 0.08 && decision.ensembleEnergy <= 1)
    assert.ok(decision.memoryEnergy >= 0.08 && decision.memoryEnergy <= 1)
    assert.ok(decision.density >= 0 && decision.density <= 1)
    assert.ok(decision.balanceScale >= 0.86 && decision.balanceScale <= 1.08)
    assert.ok(decision.colourScale >= 0.94 && decision.colourScale <= 1.06)
    assert.ok(decision.sectionSpreadSeconds >= 0 && decision.sectionSpreadSeconds <= 0.004)
    assert.ok(decision.sectionSpreadCents >= 0 && decision.sectionSpreadCents <= 3)
  }
})

test("el tutti preserva la melodía, despeja acompañamiento y reacciona al silencio", () => {
  const score = recipe(), snapshot = structuredClone(score.plan.events)
  const plan = buildPerformancePlan(score, [])
  const onset = score.plan.events[0].timeSeconds
  const together = plan.events.filter(decision => Math.abs(score.plan.events[decision.eventIndex].timeSeconds - onset) < 1e-6)
  const melody = together.find(item => item.trackId === "lead")!
  const harmony = together.find(item => item.trackId === "harmony")!
  const texture = together.find(item => item.trackId === "colour")!
  assert.ok(melody.conductor.balanceScale > harmony.conductor.balanceScale)
  assert.ok(melody.conductor.balanceScale > texture.conductor.balanceScale)
  assert.ok(melody.conductor.sectionSpreadSeconds > 0)
  assert.equal(harmony.conductor.sectionSpreadSeconds, 0)

  const crest = plan.events.find(item => item.trackId === "lead" && score.plan.events[item.eventIndex].velocity === 0.82)!
  const afterRest = plan.events.find(item => item.trackId === "lead" && score.plan.events[item.eventIndex].velocity === 0.28)!
  assert.ok(afterRest.conductor.memoryEnergy < crest.conductor.memoryEnergy)
  assert.deepEqual(score.plan.events, snapshot)
})

test("humanize=0 conserva tiempo, duración y velocidad aunque el director de conjunto siga activo", () => {
  const score = recipe(), plan = buildPerformancePlan(score, [])
  assert.equal(plan.orchestraConductorVersion, ORCHESTRA_CONDUCTOR_VERSION)
  assert.equal(plan.orchestraConductorRuleVersion, ORCHESTRA_CONDUCTOR_RULE_VERSION)
  assert.ok(plan.events.some(decision => Math.abs(decision.conductor.balanceScale - 1) > 1e-4))
  for (const decision of plan.events) {
    assert.equal(decision.startOffsetSeconds, 0)
    assert.equal(decision.durationScale, 1)
    assert.equal(decision.velocityScale, 1)
    const event = score.plan.events[decision.eventIndex]
    assert.deepEqual(performedEventValues(score, event, decision), {
      startSeconds: event.timeSeconds,
      durationSeconds: event.durationSeconds,
      velocity: event.velocity,
    })
  }
})

test("tiempo real, WAV e híbrido transportan la misma decisión V6", () => {
  const score = recipe()
  const { performance, recipe: performed } = buildPerformedRecipeV2(score)
  const gestures = new Map(performance.events.map(decision => [decision.eventIndex, decision.gesture] as const))
  const conductors = new Map(performance.events.map(decision => [decision.eventIndex, decision.conductor] as const))
  const hybrid = buildNativeHybridPerformancePlan(performed, gestures, conductors)
  assert.equal(hybrid.version, NATIVE_HYBRID_PERFORMANCE_VERSION)
  assert.ok(hybrid.decisions.length > 0)
  for (const decision of hybrid.decisions) {
    const ordinal = performed.plan.events.indexOf(decision.event)
    assert.deepEqual(decision.conductor, conductors.get(ordinal))
    assert.ok(decision.excitationScale <= 1)
    assert.ok(decision.wetCeiling <= decision.source.wet)
  }
})

test("la dinámica y la separación de sección V6 son finitas, simétricas y audiblemente distintas en PCM", async () => {
  const score = recipe(), track = score.plan.tracks.find(item => item.id === "lead")!
  const event = buildOrchestralSynthPlan(score, new Set(["lead"]))[1]
  assert.ok(event.conductorGesture)
  const base = orchestralContinuousDynamics(track, [], event.timeSeconds, event.durationSeconds, event.velocity, event.articulation)
  const conducted = applyOrchestraConductorToDynamics(base, event.conductorGesture)
  assert.equal(conducted.conductorVersion, ORCHESTRA_CONDUCTOR_VERSION)
  assert.notDeepEqual([...conducted.brightness], [...base.brightness])
  assert.ok(conducted.brightness.every(value => Number.isFinite(value) && value >= 0 && value <= 1))
  assert.deepEqual([-3, 0, 3], [0, 1, 2].map(member => orchestraSectionMemberOffset(member, 3, 3)))
  assert.deepEqual([0, 0.002, 0.004], [0, 1, 2].map(member => orchestraSectionMemberDelay(member, 3, 0.004)))

  const render = async (enabled: boolean) => {
    const context = new OfflineAudioContext(1, 48_000 * 1.8, 48_000)
    scheduleOrchestralSynthVoice(context, context.destination, 0, enabled ? event : { ...event, conductorGesture: undefined }, track, 0.62)
    return context.startRendering()
  }
  const first = await render(true), again = await render(true), neutral = await render(false)
  assert.equal(pcmHash(first), pcmHash(again))
  assert.notEqual(pcmHash(first), pcmHash(neutral))
  const analysis = analyzeAudioBuffer(first)
  assert.equal(analysis.clippedSampleCount, 0)
  assert.ok(first.getChannelData(0).every(Number.isFinite))
  assert.ok(analysis.rmsLinear > 0.00001)
})
