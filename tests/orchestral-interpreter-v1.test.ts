import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { OfflineAudioContext as NodeOfflineAudioContext } from "node-web-audio-api"
import { compileTloqueScore } from "../shared/audio"
import {
  NEUTRAL_ORCHESTRAL_INTERPRETATION,
  ORCHESTRAL_INTERPRETER_RULE_VERSION,
  ORCHESTRAL_INTERPRETER_VERSION,
  orchestralInterpretationEnvelopeAt,
} from "../shared/orchestral-interpreter"
import { INTELLIGENT_PERFORMER_VERSION } from "../shared/intelligent-performance"
import { validateTloqueSamplePack, type TloqueSamplePack } from "../shared/native-sample-pack"
import { analyzeAudioBuffer } from "../client/src/audio/AudioRenderAnalysis"
import { applyIntelligentPerformanceGestureToDynamics, orchestralContinuousDynamics } from "../client/src/audio/OrchestralDynamics"
import { applyIntelligentPerformanceGestureToExpression, orchestralExpressionCurve, orchestralNoteExpression } from "../client/src/audio/OrchestralExpression"
import {
  buildOrchestralInterpreterPlan,
  orchestralPitchClassTension,
  orchestralSampleLayerIntensity,
  orchestralStageIntentForTrack,
} from "../client/src/audio/OrchestralInterpreter"
import { buildOrchestralSynthPlan } from "../client/src/audio/OrchestralSynthPlan"
import { scheduleOrchestralSynthVoice } from "../client/src/audio/OrchestralSynthVoice"
import { buildNativeSampleScorePlan } from "../client/src/audio/NativeSampleScorePlan"
import { recipeForNativeModule } from "../client/src/audio/NativeAutoModule"
import { buildPerformancePlan, performedEventValues } from "../client/src/audio/PerformanceEngine"

Object.defineProperty(globalThis, "OfflineAudioContext", { value: NodeOfflineAudioContext, configurable: true })

const SCORE = `TLOQUE_SCORE 2
title "Orchestral Interpreter V1"
tempo 120
meter 4/4
loop false
seed 20260908
humanize 0
quality master
module orchestra-synth
track lead synth=pad instrument=strings.violin program=40 role=melody gain=0.3 pan=-0.1 attack=0.05 release=0.7 expression=0.72 brightness=0.58 vibrato=0.42 timbre=natural
track harmony synth=pad instrument=strings.viola program=41 role=harmony gain=0.25 pan=0.1 attack=0.07 release=0.8 expression=0.68 brightness=0.48 vibrato=0.18 timbre=natural
track bass synth=bass instrument=strings.cello program=42 role=bass gain=0.24 pan=0.12 attack=0.06 release=0.9 expression=0.7 brightness=0.4 vibrato=0.12 timbre=natural
section phrase form=development bars=2 repeat=1 fade=0 tempo=120 rubato=0
use lead
1:1 C5 1 velocity=0.52 articulation=legato
1:2 C#5 1 velocity=0.58 articulation=legato
1:3 G5 1 velocity=0.82 articulation=accent
1:4 E5 1 velocity=0.62 articulation=legato
2:1 C5 2 velocity=0.5 articulation=tenuto
rest 2:3 2
use harmony
1:1 C4,E4,G4 1 velocity=0.48 articulation=normal
1:2 C4,E4,G4 1 velocity=0.5 articulation=normal
1:3 C4,F#4,A4 1 velocity=0.68 articulation=accent
1:4 C4,E4,G4 1 velocity=0.52 articulation=normal
2:1 C4,E4,G4 2 velocity=0.44 articulation=tenuto
use bass
1:1 C3 2 velocity=0.46 articulation=tenuto
1:3 G2 2 velocity=0.55 articulation=normal
2:1 C3 2 velocity=0.42 articulation=tenuto
end`

function recipe() {
  const result = compileTloqueScore(SCORE)
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.diagnostics))
  if (!result.ok || result.recipe.version !== 2) throw new Error("fixture inválida")
  return result.recipe
}

function pcmHash(buffer: AudioBuffer) {
  return createHash("sha256").update(new Uint8Array(buffer.getChannelData(0).buffer)).digest("hex")
}

test("V1 analiza frase y armonía de forma determinista, versionada y acotada", () => {
  const score = recipe()
  const first = buildPerformancePlan(score, [])
  const second = buildPerformancePlan(score, [])
  assert.equal(first.orchestralInterpreterVersion, ORCHESTRAL_INTERPRETER_VERSION)
  assert.equal(first.orchestralInterpreterRuleVersion, ORCHESTRAL_INTERPRETER_RULE_VERSION)
  assert.equal(first.intelligentPerformerVersion, INTELLIGENT_PERFORMER_VERSION)
  assert.deepEqual(first.events, second.events)
  assert.deepEqual([...first.orchestralStageByTrack], [...second.orchestralStageByTrack])

  for (const decision of first.events) {
    const interpretation = decision.interpretation
    assert.equal(interpretation.contractVersion, ORCHESTRAL_INTERPRETER_VERSION)
    assert.equal(interpretation.ruleVersion, ORCHESTRAL_INTERPRETER_RULE_VERSION)
    assert.equal(interpretation.basis, "music-design-heuristic")
    assert.deepEqual(decision.gesture.interpretation, interpretation)
    assert.ok(interpretation.harmonicTension >= 0 && interpretation.harmonicTension <= 1)
    assert.ok(interpretation.melodicWeight >= 0 && interpretation.melodicWeight <= 1)
    assert.ok(interpretation.arrivalStrength >= 0 && interpretation.arrivalStrength <= 1)
    assert.ok(interpretation.sampleDynamicsScale >= 0.94 && interpretation.sampleDynamicsScale <= 1.065)
    for (const shape of [interpretation.dynamic, interpretation.vibrato]) {
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        assert.ok(Number.isFinite(orchestralInterpretationEnvelopeAt(shape, progress)))
      }
    }
  }
  assert.ok(first.events.some(event => event.interpretation.phrasePhase === "climax"))
  assert.ok(first.events.some(event => event.interpretation.phrasePhase === "arrival"))
  assert.ok(first.events.some(event => event.interpretation.reasons.includes("harmonic-tension")))
})

test("la tensión armónica distingue fricción de consonancia sin interpretar emociones", () => {
  const consonance = orchestralPitchClassTension([0, 4, 7])
  const friction = orchestralPitchClassTension([0, 1, 6])
  assert.ok(friction > consonance * 3)
  assert.equal(orchestralPitchClassTension([0, 12, 24]), 0)
})

test("humanize=0 conserva ataques, duraciones, velocity, notas y articulaciones", () => {
  const score = recipe()
  const snapshot = structuredClone(score.plan.events)
  const performance = buildPerformancePlan(score, [])
  for (const decision of performance.events) {
    const event = score.plan.events[decision.eventIndex]
    assert.equal(decision.startOffsetSeconds, 0)
    assert.equal(decision.durationScale, 1)
    assert.equal(decision.velocityScale, 1)
    assert.deepEqual(performedEventValues(score, event, decision), {
      startSeconds: event.timeSeconds,
      durationSeconds: event.durationSeconds,
      velocity: event.velocity,
    })
  }
  assert.deepEqual(score.plan.events, snapshot)
})

test("V1 modela planos por rol y mantiene posición espacial dentro de límites discretos", () => {
  const score = recipe()
  const lead = orchestralStageIntentForTrack(score.plan.tracks[0])
  const harmony = orchestralStageIntentForTrack(score.plan.tracks[1])
  assert.ok(lead.depthScale < harmony.depthScale)
  assert.ok(lead.presenceScale > harmony.presenceScale)
  for (const placement of [lead, harmony, ...buildPerformancePlan(score, []).orchestralStageByTrack.values()]) {
    assert.equal(placement.contractVersion, ORCHESTRAL_INTERPRETER_VERSION)
    assert.ok(placement.depthScale >= 0.9 && placement.depthScale <= 1.1)
    assert.ok(placement.roomSendScale >= 0.9 && placement.roomSendScale <= 1.12)
    assert.ok(placement.presenceScale >= 0.94 && placement.presenceScale <= 1.04)
    assert.ok(Math.abs(placement.panOffset) <= 0.0121)
  }
})

test("la curva interpretativa moldea esfuerzo, color, ganancia y vibrato sin valores inválidos", () => {
  const score = recipe(), performance = buildPerformancePlan(score, [])
  const decision = performance.events.find(item => item.trackId === "lead" && item.interpretation.phrasePhase === "arrival")!
  const event = score.plan.events[decision.eventIndex]
  const track = score.plan.tracks.find(item => item.id === event.trackId)!
  const baseDynamics = orchestralContinuousDynamics(track, [], event.timeSeconds, event.durationSeconds, event.velocity, event.articulation)
  const dynamics = applyIntelligentPerformanceGestureToDynamics(baseDynamics, decision.gesture)
  assert.equal(dynamics.interpreterVersion, ORCHESTRAL_INTERPRETER_VERSION)
  assert.equal(dynamics.interpreterRuleVersion, ORCHESTRAL_INTERPRETER_RULE_VERSION)
  assert.notDeepEqual([...dynamics.effort], [...baseDynamics.effort])
  assert.ok(dynamics.effort.every(value => Number.isFinite(value) && value >= 0 && value <= 1))
  assert.ok(dynamics.brightness.every(value => Number.isFinite(value) && value >= 0 && value <= 1))

  const baseExpression = orchestralNoteExpression(track.instrument, event.articulation, event.durationSeconds, 1, false, "interpreter-v1")
  const expression = applyIntelligentPerformanceGestureToExpression(baseExpression, decision.gesture)
  const gain = orchestralExpressionCurve(expression, event.durationSeconds, "gain")
  const detune = orchestralExpressionCurve(expression, event.durationSeconds, "detune")
  assert.equal(expression.interpretation?.contractVersion, ORCHESTRAL_INTERPRETER_VERSION)
  assert.ok(gain.every(value => Number.isFinite(value) && value >= 0.72 && value <= 1.16))
  assert.ok(detune.every(Number.isFinite))
  assert.notEqual(gain[0], gain[Math.floor(gain.length / 2)])
})

test("expresión y llegada eligen color dinámico de muestra sin sumar otra vez su amplitud", () => {
  const score = recipe(), decision = buildPerformancePlan(score, []).events[0]
  const quiet = orchestralSampleLayerIntensity(0.68, 0.25, decision.interpretation)
  const loud = orchestralSampleLayerIntensity(0.68, 0.92, decision.interpretation)
  assert.ok(quiet < loud)
  assert.ok(quiet >= 0.01 && loud <= 1)
})

test("native-auto conserva la interpretación de la orquesta completa al separar bancos", () => {
  const score = { ...recipe(), plan: { ...recipe().plan, moduleId: "native-auto" } }
  const performance = buildPerformancePlan(score, [])
  const fullByEvent = new Map(score.plan.events.map((event, index) => [event, performance.decisionForEvent(index)] as const))
  const violinGroup = { moduleId: "vsco2-ce-solo-violin", trackIds: ["lead"] }
  const pack: TloqueSamplePack = validateTloqueSamplePack({
    version: 1,
    id: "interpreter-v1-violin",
    name: "Interpreter fixture",
    instrumentManifestId: "vsco2-ce-solo-violin",
    license: "CC0-1.0",
    sourceName: "fixture",
    sourceUrl: "",
    zones: [{
      id: "normal-vibrato",
      articulation: "normal",
      sampleUrl: `/api/audio/sample-packs/samples/${"a".repeat(64)}.wav`,
      rootMidi: 72,
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
    }],
  })
  const plan = buildNativeSampleScorePlan(recipeForNativeModule(score, violinGroup), pack, {
    fullScoreDecisionByEvent: fullByEvent,
  })
  assert.ok(plan.voices.length > 0)
  for (const voice of plan.voices) {
    const authored = score.plan.events.find(event => event.trackId === voice.trackId
      && event.notes.includes(voice.note)
      && Math.abs(event.timeSeconds - voice.startSeconds) < 1e-9)!
    assert.deepEqual(voice.performanceGesture?.interpretation, fullByEvent.get(authored)?.interpretation)
    assert.ok(voice.layerVelocity >= 1 && voice.layerVelocity <= 127)
  }
})

test("el Intérprete V1 produce PCM diferente, determinista, finito y sin clipping", async () => {
  const score = recipe(), event = buildOrchestralSynthPlan(score, new Set(["lead"]))[0]
  const track = score.plan.tracks.find(item => item.id === "lead")!
  const render = async (enabled: boolean) => {
    const context = new NodeOfflineAudioContext(1, 48_000 * 1.4, 48_000)
    const performanceGesture = enabled || !event.performanceGesture
      ? event.performanceGesture
      : { ...event.performanceGesture, interpretation: NEUTRAL_ORCHESTRAL_INTERPRETATION }
    scheduleOrchestralSynthVoice(context, context.destination, 0, { ...event, performanceGesture }, track, 0.62)
    return context.startRendering()
  }
  const interpreted = await render(true)
  const repeated = await render(true)
  const neutral = await render(false)
  assert.equal(pcmHash(interpreted), pcmHash(repeated))
  assert.notEqual(pcmHash(interpreted), pcmHash(neutral))
  const analysis = analyzeAudioBuffer(interpreted)
  assert.equal(analysis.clippedSampleCount, 0)
  assert.ok(analysis.rmsLinear > 0.00001)
  assert.ok(interpreted.getChannelData(0).every(Number.isFinite))
})

test("el plan directo expone exactamente el mismo mapa interpretativo", () => {
  const score = recipe(), performance = buildPerformancePlan(score, [])
  const phrases = new Map(performance.events.map(decision => [decision.eventIndex, {
    phraseIndex: decision.phraseIndex,
    position: decision.phrasePosition,
    length: decision.phraseLength,
    climaxPosition: decision.phraseClimaxPosition,
    metricEmphasis: decision.metricEmphasis,
  }] as const))
  const direct = buildOrchestralInterpreterPlan(score, phrases)
  assert.deepEqual([...direct.decisions], performance.events.map(decision => [decision.eventIndex, decision.interpretation]))
})
