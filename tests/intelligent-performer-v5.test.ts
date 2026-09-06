import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { OfflineAudioContext as NodeOfflineAudioContext } from "node-web-audio-api"
import { compileTloqueScore } from "../shared/audio"
import {
  INTELLIGENT_PERFORMER_RULE_VERSION,
  INTELLIGENT_PERFORMER_VERSION,
} from "../shared/intelligent-performance"
import { NATIVE_PHYSICAL_MODEL_SOURCES } from "../shared/native-acoustic-source"
import { NATIVE_HYBRID_PERFORMANCE_VERSION } from "../shared/native-hybrid-performance"
import { nativeHybridForInstrument } from "../shared/native-hybrid-source"
import type { TloqueSamplePack } from "../shared/native-sample-pack"
import { analyzeAudioBuffer } from "../client/src/audio/AudioRenderAnalysis"
import { applyIntelligentPerformanceGestureToDynamics, orchestralContinuousDynamics } from "../client/src/audio/OrchestralDynamics"
import { applyIntelligentPerformanceGestureToExpression, orchestralNoteExpression } from "../client/src/audio/OrchestralExpression"
import { buildOrchestralSynthPlan } from "../client/src/audio/OrchestralSynthPlan"
import { scheduleOrchestralSynthVoice } from "../client/src/audio/OrchestralSynthVoice"
import { scheduleAirColumnOverlay } from "../client/src/audio/PhysicalAirColumnOverlay"
import { schedulePhysicalReedVoice } from "../client/src/audio/PhysicalReedModel"
import { buildPerformancePlan } from "../client/src/audio/PerformanceEngine"
import { buildNativeSampleScorePlan } from "../client/src/audio/NativeSampleScorePlan"

Object.defineProperty(globalThis, "OfflineAudioContext", { value: NodeOfflineAudioContext, configurable: true })

const SCORE = `TLOQUE_SCORE 2
title "Intelligent Performer V5"
tempo 60
meter 4/4
loop false
seed 20260905
humanize 0
quality studio
module orchestra-synth
track violin synth=pad instrument=strings.violin program=40 role=melody gain=0.3 pan=-0.2 attack=0.05 release=0.6 expression=0.8 brightness=0.55 vibrato=0.35
track flute synth=warm instrument=woodwinds.flute program=73 role=harmony gain=0.24 pan=0.2 attack=0.05 release=0.4 expression=0.72 brightness=0.58 vibrato=0.22
section phrase form=development bars=1 repeat=1 fade=0 tempo=60 rubato=0
use violin
1:1 A4 1 velocity=0.48 articulation=normal
1:2 B4 1 velocity=0.52 articulation=legato
1:3 C5 1 velocity=0.58 articulation=legato
1:4 D5 1 velocity=0.46 articulation=normal
use flute
1:1 E5 1 velocity=0.42 articulation=normal
1:2 F5 1 velocity=0.46 articulation=legato
1:3 G5 0.5 velocity=0.54 articulation=accent
rest 1:3.5 0.5
1:4 E5 1 velocity=0.4 articulation=normal
end`

function recipe() {
  const result = compileTloqueScore(SCORE)
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.diagnostics))
  if (!result.ok || result.recipe.version !== 2) throw new Error("fixture inválido")
  return result.recipe
}

function pcmHash(buffer: AudioBuffer) {
  return createHash("sha256").update(new Uint8Array(buffer.getChannelData(0).buffer)).digest("hex")
}

test("V5 compila gestos deterministas, acotados y específicos por familia", () => {
  const score = recipe()
  const first = buildPerformancePlan(score, [])
  const second = buildPerformancePlan(score, [])
  assert.equal(first.intelligentPerformerVersion, INTELLIGENT_PERFORMER_VERSION)
  assert.equal(first.intelligentPerformerRuleVersion, INTELLIGENT_PERFORMER_RULE_VERSION)
  assert.deepEqual(first.events, second.events)

  const violin = first.events.filter(event => event.trackId === "violin")
  const flute = first.events.filter(event => event.trackId === "flute")
  assert.equal(violin[0].gesture.medium, "bow")
  assert.equal(violin[0].gesture.connection, "fresh-attack")
  assert.equal(violin[1].gesture.connection, "phrase-carry")
  assert.equal(violin[1].gesture.bowDirection, violin[0].gesture.bowDirection)
  assert.equal(flute[0].gesture.medium, "breath")
  assert.equal(flute[0].gesture.breathReset, true)
  assert.equal(flute[1].gesture.connection, "phrase-carry")
  assert.equal(flute[1].gesture.breathReset, false)
  assert.equal(flute[2].gesture.vibratoDepthScale, 0)
  assert.equal(flute[3].phraseStart, true, "el silencio explícito debe exigir una respiración nueva")
  assert.equal(flute[3].gesture.breathReset, true)

  for (const { gesture } of first.events) {
    assert.equal(gesture.contractVersion, INTELLIGENT_PERFORMER_VERSION)
    assert.equal(gesture.ruleVersion, INTELLIGENT_PERFORMER_RULE_VERSION)
    assert.ok(gesture.attackTimeScale >= 0.55 && gesture.attackTimeScale <= 1.18)
    assert.ok(gesture.releaseTimeScale >= 0.58 && gesture.releaseTimeScale <= 1.2)
    assert.ok(gesture.onsetEffort >= 0.42 && gesture.onsetEffort <= 1.2)
    assert.ok(gesture.sustainEffort >= 0.7 && gesture.sustainEffort <= 1.1)
    assert.ok(gesture.releaseEffort >= 0.58 && gesture.releaseEffort <= 1.08)
    assert.ok(gesture.brightnessScale >= 0.9 && gesture.brightnessScale <= 1.12)
    assert.ok(gesture.vibratoDepthScale >= 0 && gesture.vibratoDepthScale <= 1.18)
    assert.ok(gesture.vibratoDelaySeconds >= 0 && gesture.vibratoDelaySeconds <= 0.32)
    assert.ok(gesture.transitionSeconds >= 0 && gesture.transitionSeconds <= 0.052)
  }
  assert.ok(first.events.every(event => event.startOffsetSeconds === 0 && event.durationScale === 1 && event.velocityScale === 1))
})

test("el gesto transforma esfuerzo, color y vibrato sin alterar el score", () => {
  const score = recipe(), plan = buildPerformancePlan(score, [])
  const event = score.plan.events.find(item => item.trackId === "violin" && item.articulation === "legato")!
  const eventIndex = score.plan.events.indexOf(event), decision = plan.decisionForEvent(eventIndex)!
  const track = score.plan.tracks.find(item => item.id === "violin")!
  const baseDynamics = orchestralContinuousDynamics(track, [], event.timeSeconds, event.durationSeconds, event.velocity, event.articulation)
  const performedDynamics = applyIntelligentPerformanceGestureToDynamics(baseDynamics, decision.gesture)
  assert.equal(performedDynamics.gestureVersion, INTELLIGENT_PERFORMER_VERSION)
  assert.notDeepEqual([...performedDynamics.effort], [...baseDynamics.effort])
  assert.notDeepEqual([...performedDynamics.brightness], [...baseDynamics.brightness])
  assert.ok(performedDynamics.effort.every(value => Number.isFinite(value) && value >= 0 && value <= 1))
  assert.ok(performedDynamics.brightness.every(value => Number.isFinite(value) && value >= 0 && value <= 1))

  const baseExpression = orchestralNoteExpression(track.instrument, event.articulation, event.durationSeconds, 1, false, "v5")
  const performedExpression = applyIntelligentPerformanceGestureToExpression(baseExpression, decision.gesture)
  assert.equal(performedExpression.vibratoDelay, decision.gesture.vibratoDelaySeconds)
  assert.notEqual(performedExpression.vibratoCents, baseExpression.vibratoCents)
  assert.deepEqual(score.plan.events[eventIndex].notes, event.notes)
  assert.equal(score.plan.events[eventIndex].articulation, "legato")
})

test("el sampler conserva ataques normales y sólo funde conexiones interpretativas", () => {
  const result = compileTloqueScore(SCORE
    .replace("module orchestra-synth", "module vsco2-ce-solo-violin")
    .replace("vibrato=0.35", "vibrato=0.35 timbre=vibrato")
    .replace(/track flute[^\n]*\n/, "")
    .replace(/use flute[\s\S]*?1:4 E5 1 velocity=0.4 articulation=normal\n/, ""))
  assert.equal(result.ok, true)
  if (!result.ok) return
  const sampleUrl = `/api/audio/sample-packs/samples/${"a".repeat(64)}.wav`
  const pack: TloqueSamplePack = {
    version: 1,
    id: "v5-violin",
    name: "V5 fixture",
    instrumentManifestId: "vsco2-ce-solo-violin",
    license: "test",
    sourceName: "fixture",
    sourceUrl: "",
    micPositions: ["default"],
    defaultMicPosition: "default",
    zones: [{
      id: "normal",
      articulation: "normal",
      sampleUrl,
      rootMidi: 69,
      loMidi: 60,
      hiMidi: 84,
      loVelocity: 0,
      hiVelocity: 127,
      velocityLayer: 0,
      roundRobin: 0,
      gainDb: 0,
      tuneCents: 0,
      vibrato: true,
      vibratoColour: "vibrato",
      mute: "none",
      trigger: "attack",
      micPosition: "default",
    }],
  }
  const plan = buildNativeSampleScorePlan(result.recipe, pack)
  assert.equal(plan.voices[0].fadeInSeconds, 0)
  assert.equal(plan.voices[0].performanceGesture?.connection, "fresh-attack")
  assert.equal(plan.voices[1].performanceGesture?.connection, "phrase-carry")
  assert.equal(plan.voices[1].fadeInSeconds, plan.voices[1].performanceGesture?.transitionSeconds)
  assert.equal(plan.voices[3].performanceGesture?.connection, "fresh-attack")
  assert.equal(plan.voices[3].fadeInSeconds, 0)
})

test("el renderer sintetizado consume el gesto V5 y produce PCM distinto, finito y estable", async () => {
  const score = recipe(), track = score.plan.tracks.find(item => item.id === "flute")!
  const event = buildOrchestralSynthPlan(score, new Set(["flute"]))[1]
  assert.equal(event.performanceGesture?.connection, "phrase-carry")

  const render = async (withGesture: boolean) => {
    const context = new OfflineAudioContext(1, 48_000 * 2.2, 48_000)
    scheduleOrchestralSynthVoice(context, context.destination, 0, withGesture ? event : { ...event, performanceGesture: undefined }, track, 0.7)
    return context.startRendering()
  }
  const performedA = await render(true), performedB = await render(true), neutral = await render(false)
  assert.equal(pcmHash(performedA), pcmHash(performedB))
  assert.notEqual(pcmHash(performedA), pcmHash(neutral))
  const analysis = analyzeAudioBuffer(performedA)
  assert.equal(analysis.clippedSampleCount, 0)
  assert.ok(performedA.getChannelData(0).every(Number.isFinite))
  assert.ok(analysis.rmsLinear > 0.00001)
})

test("la columna de aire híbrida consume exactamente el mismo gesto V5", async () => {
  const score = recipe()
  const track = score.plan.tracks.find(item => item.id === "flute")!
  const eventIndex = score.plan.events.findIndex(item => item.trackId === "flute" && item.articulation === "legato")
  const event = score.plan.events[eventIndex]
  const gesture = buildPerformancePlan(score, []).decisionForEvent(eventIndex)!.gesture
  const source = nativeHybridForInstrument(track.instrument)
  assert.ok(source)
  if (!source) return

  const render = async (withGesture: boolean) => {
    const context = new OfflineAudioContext(1, 48_000 * 2.2, 48_000)
    scheduleAirColumnOverlay(context, source, {
      startAt: 0,
      event: { ...event, timeSeconds: 0 },
      track,
      midi: event.notes[0],
      destination: context.destination,
      controls: [],
      legatoFromPrevious: true,
      performance: {
        contractVersion: NATIVE_HYBRID_PERFORMANCE_VERSION,
        transition: "connected-legato",
        mixScale: 1,
        wetCeiling: source.wet,
        excitationScale: 0.7,
        ...(withGesture ? { gesture } : {}),
      },
    })
    return context.startRendering()
  }

  const performedA = await render(true), performedB = await render(true), neutral = await render(false)
  assert.equal(pcmHash(performedA), pcmHash(performedB))
  assert.notEqual(pcmHash(performedA), pcmHash(neutral))
  const analysis = analyzeAudioBuffer(performedA)
  assert.equal(analysis.clippedSampleCount, 0)
  assert.ok(performedA.getChannelData(0).every(Number.isFinite))
  assert.ok(analysis.rmsLinear > 0.000001)
})

test("los modelos físicos de doble lengüeta obedecen el gesto V5 sin perder estabilidad", async () => {
  const compiled = compileTloqueScore(`TLOQUE_SCORE 2
title "V5 physical reed"
tempo 60
meter 4/4
loop false
seed 20260905
humanize 0
quality studio
module tloque-model-english-horn-v1
track cor synth=warm instrument=woodwinds.english-horn program=69 role=melody gain=0.3 pan=0 attack=0.06 release=0.5 expression=0.72 brightness=0.58 vibrato=0.16
section phrase form=development bars=1 repeat=1 fade=0 tempo=60 rubato=0
use cor
1:1 E3 1 velocity=0.52 articulation=normal
1:2 F3 1 velocity=0.58 articulation=legato
end`)
  assert.equal(compiled.ok, true, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics))
  if (!compiled.ok || compiled.recipe.version !== 2) return
  const score = compiled.recipe, track = score.plan.tracks[0], event = score.plan.events[1]
  const gesture = buildPerformancePlan(score, []).decisionForEvent(1)!.gesture
  const source = NATIVE_PHYSICAL_MODEL_SOURCES.find(item => item.instrumentId === track.instrument)
  assert.ok(source)
  if (!source) return

  const render = async (withGesture: boolean) => {
    const context = new OfflineAudioContext(1, 48_000 * 2.2, 48_000)
    schedulePhysicalReedVoice(context, source, {
      startAt: 0,
      event: { ...event, timeSeconds: 0 },
      track,
      midi: event.notes[0],
      destination: context.destination,
      controls: [],
      legatoFromPrevious: true,
      ...(withGesture ? { performanceGesture: gesture } : {}),
    })
    return context.startRendering()
  }

  const performedA = await render(true), performedB = await render(true), neutral = await render(false)
  assert.equal(pcmHash(performedA), pcmHash(performedB))
  assert.notEqual(pcmHash(performedA), pcmHash(neutral))
  const analysis = analyzeAudioBuffer(performedA)
  assert.equal(analysis.clippedSampleCount, 0)
  assert.ok(performedA.getChannelData(0).every(Number.isFinite))
  assert.ok(analysis.rmsLinear > 0.00001)
})
