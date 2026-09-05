import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { OfflineAudioContext as NodeOfflineAudioContext } from "node-web-audio-api"
import { compileTloqueScore } from "../../shared/audio"
import { buildNativeHybridPerformancePlan, buildNativeHybridRenderUnits } from "../../shared/native-hybrid-performance"
import { scheduleHybridPhysicalOverlay } from "../../client/src/audio/HybridPhysicalOverlay"
import { scheduleHybridBowedStringPhrase } from "../../client/src/audio/PhysicalBowedStringOverlay"
import { analyzeAudioBuffer } from "../../client/src/audio/AudioRenderAnalysis"

Object.defineProperty(globalThis, "OfflineAudioContext", { value: NodeOfflineAudioContext, configurable: true })

function compile(body: string) {
  const result = compileTloqueScore(`TLOQUE_SCORE 2
title "Hybrid DSP QA"
tempo 120
meter 4/4
loop false
seed 20260902
humanize 0
quality studio
module native-auto
${body}`)
  if (!result.ok || result.recipe.version !== 2) throw new Error(result.ok ? "wrong recipe version" : result.diagnostics.map(item => item.message).join(" · "))
  return result.recipe
}

function pcmHash(buffer: AudioBuffer) {
  return createHash("sha256").update(new Uint8Array(buffer.getChannelData(0).buffer)).digest("hex")
}

function windowRms(data: Float32Array, fromSeconds: number, toSeconds: number) {
  let sum = 0
  const from = Math.floor(fromSeconds * 48_000), to = Math.floor(toSeconds * 48_000)
  for (let index = from; index < to; index += 1) sum += data[index] ** 2
  return Math.sqrt(sum / Math.max(1, to - from))
}

test("DSP híbrido real normaliza acordes, permanece determinista y no recorta", async () => {
  const recipe = compile(`track violin synth=pad instrument=strings.violin program=40 role=harmony gain=0.3 pan=0 attack=0.08 release=1 expression=0.8 brightness=0.55 vibrato=0.08
section chord form=development bars=1 repeat=1 fade=0 tempo=120 rubato=0
use violin
1:1 C4,E4,G4,B4 2 velocity=0.72 articulation=normal
end`)
  const decision = buildNativeHybridPerformancePlan(recipe).decisions[0]
  assert.equal(decision.midis.length, 2)

  const render = async (governed: boolean) => {
    const context = new OfflineAudioContext(2, 48_000 * 2, 48_000)
    const track = recipe.plan.tracks[0], controls = recipe.plan.controls
    for (const midi of decision.midis) scheduleHybridPhysicalOverlay(context, decision.source, {
      startAt: 0,
      event: decision.event,
      track,
      midi,
      destination: context.destination,
      controls,
      ...(governed ? { performance: decision } : {}),
    })
    return context.startRendering()
  }

  const ungoverned = await render(false)
  const governedA = await render(true)
  const governedB = await render(true)
  const rawAnalysis = analyzeAudioBuffer(ungoverned), governedAnalysis = analyzeAudioBuffer(governedA)
  assert.equal(governedAnalysis.clippedSampleCount, 0)
  assert.ok(governedA.getChannelData(0).every(Number.isFinite))
  assert.ok(governedAnalysis.rmsLinear < rawAnalysis.rmsLinear * 0.85, `${governedAnalysis.rmsLinear} !< ${rawAnalysis.rmsLinear}`)
  assert.equal(pcmHash(governedA), pcmHash(governedB))
})

test("DSP híbrido real suaviza la excitación de una transición legato válida", async () => {
  const recipe = compile(`track flute synth=pad instrument=woodwinds.flute program=73 role=melody gain=0.3 pan=0 attack=0.08 release=1 expression=0.8 brightness=0.55 vibrato=0.04
section line form=development bars=1 repeat=1 fade=0 tempo=120 rubato=0
use flute
1:1 A4 1 velocity=0.58 articulation=normal
1:2 B4 1 velocity=0.58 articulation=legato
end`)
  const decision = buildNativeHybridPerformancePlan(recipe).decisions[1]
  assert.equal(decision.transition, "connected-legato")

  const render = async (connected: boolean) => {
    const context = new OfflineAudioContext(2, 48_000 * 2, 48_000)
    const performance = connected ? decision : { ...decision, transition: "fresh-attack" as const, excitationScale: 1 }
    scheduleHybridPhysicalOverlay(context, decision.source, {
      startAt: 0,
      event: decision.event,
      track: recipe.plan.tracks[0],
      midi: decision.midis[0],
      destination: context.destination,
      controls: recipe.plan.controls,
      legatoFromPrevious: connected,
      performance,
    })
    return context.startRendering()
  }

  const connected = await render(true), detached = await render(false)
  const connectedOnset = windowRms(connected.getChannelData(0), 0.5, 0.56)
  const detachedOnset = windowRms(detached.getChannelData(0), 0.5, 0.56)
  assert.ok(connectedOnset < detachedOnset * 0.8, `${connectedOnset} !< ${detachedOnset}`)
  assert.equal(analyzeAudioBuffer(connected).clippedSampleCount, 0)
})

test("V4 conserva una sola cuerda física durante toda la frase sampleada", async () => {
  const recipe = compile(`track violin synth=pad instrument=strings.violin program=40 role=melody gain=0.3 pan=0 attack=0.08 release=1 expression=0.8 brightness=0.55 vibrato=0.06
section line form=development bars=2 repeat=1 fade=0 tempo=120 rubato=0
use violin
1:1 A4 1 velocity=0.52 articulation=normal
1:2 B4 1 velocity=0.56 articulation=legato
1:3 C5 1 velocity=0.60 articulation=legato
rest 1:4 1
2:1 E5 1 velocity=0.54 articulation=normal
end`)
  const plan = buildNativeHybridPerformancePlan(recipe)
  const units = buildNativeHybridRenderUnits(plan)
  const phrase = units.find(unit => unit.kind === "bowed-string-phrase" && unit.decisions.length === 3)
  assert.ok(phrase && phrase.kind === "bowed-string-phrase")

  const render = async (bodyScale = 1) => {
    const context = new OfflineAudioContext(2, 48_000 * 2.5, 48_000)
    let reservations = 0
    const result = scheduleHybridBowedStringPhrase(context, phrase.decisions[0].source, {
      startAt: 0,
      decisions: phrase.decisions,
      track: recipe.plan.tracks[0],
      destination: context.destination,
      controls: recipe.plan.controls,
      reserve: () => { reservations += 1; return true },
      calibrationTuning: { wetScale: 1, feedbackScale: 1, dampingScale: 1, textureScale: 1, bodyScale, decayScale: 1 },
    })
    assert.equal(result?.scheduledEvents, 3)
    assert.equal(reservations, 1)
    return context.startRendering()
  }

  const first = await render(), second = await render(), reducedBody = await render(0.88)
  assert.equal(pcmHash(first), pcmHash(second))
  assert.notEqual(pcmHash(first), pcmHash(reducedBody))
  const analysis = analyzeAudioBuffer(first)
  assert.equal(analysis.clippedSampleCount, 0)
  assert.ok(first.getChannelData(0).every(Number.isFinite))
  assert.ok(analysis.rmsLinear > 0.0001)
  assert.ok(analyzeAudioBuffer(reducedBody).rmsLinear < analysis.rmsLinear * 0.95)
  const pcm = first.getChannelData(0), boundary = phrase.decisions[1].event.timeSeconds
  const before = windowRms(pcm, boundary - 0.05, boundary - 0.005)
  const after = windowRms(pcm, boundary + 0.005, boundary + 0.05)
  assert.ok(before > 0.00001 && after > before * 0.12, `${before} -> ${after}`)
})
