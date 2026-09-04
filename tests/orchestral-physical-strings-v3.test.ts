import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { OfflineAudioContext as NodeOfflineAudioContext } from "node-web-audio-api"
import { compileTloqueScore } from "../shared/audio"
import { ORCHESTRAL_SYNTH_VERSION } from "../shared/orchestral-synthesis"
import { analyzeAudioBuffer } from "../client/src/audio/AudioRenderAnalysis"
import { buildOrchestralSynthRenderUnits } from "../client/src/audio/OrchestralSynthPlan"
import {
  ORCHESTRAL_STRING_DSP_VERSION,
  ORCHESTRAL_STRING_WORKLET_PROCESSOR,
  isBowedOrchestralString,
  orchestralBowFrictionCurve,
  orchestralStringProfileFor,
  orchestralStringQuality,
  prepareOrchestralStringDsp,
  scheduleOrchestralStringPhrase,
} from "../client/src/audio/OrchestralStringVoice"

Object.defineProperty(globalThis, "OfflineAudioContext", { value: NodeOfflineAudioContext, configurable: true })

const SCORE = `TLOQUE_SCORE 2
title "Physical Strings V3"
tempo 120
meter 4/4
loop false
seed 20260904
humanize 0
quality studio
module orchestra-synth
track violin synth=pad instrument=strings.violin program=40 role=melody gain=0.32 pan=-0.2 attack=0.06 release=0.4 expression=0.8 brightness=0.55 vibrato=0.22
section phrase form=development bars=2 repeat=1 fade=0 tempo=120 rubato=0
use violin
1:1 A4 1 velocity=0.48 articulation=normal
1:2 B4 1 velocity=0.54 articulation=legato
1:3 C5 1 velocity=0.61 articulation=legato
rest 1:4 1
2:1 E5 1 velocity=0.5 articulation=normal
2:2 F5 1 velocity=0.56 articulation=legato
end`

function recipe() {
  const compiled = compileTloqueScore(SCORE)
  assert.ok(compiled.ok)
  if (!compiled.ok || compiled.recipe.version !== 2) throw new Error("score inválido")
  return compiled.recipe
}

function recipeWithPhysicalControls(values: string) {
  const compiled = compileTloqueScore(SCORE.replace("use violin\n", `use violin\ncontrol 1:1 ${values} ramp=0\n`))
  assert.ok(compiled.ok)
  if (!compiled.ok || compiled.recipe.version !== 2) throw new Error("score físico inválido")
  return compiled.recipe
}

function pcmHash(buffer: AudioBuffer) {
  return createHash("sha256").update(new Uint8Array(buffer.getChannelData(0).buffer)).digest("hex")
}

test("V3 versiona el renderer y reconoce sólo cuerdas frotadas", () => {
  assert.equal(ORCHESTRAL_SYNTH_VERSION, "tloque-orchestral-synth-v3-physical-strings")
  assert.equal(ORCHESTRAL_STRING_DSP_VERSION, "tloque-bowed-string-dsp-v3")
  assert.equal(ORCHESTRAL_STRING_WORKLET_PROCESSOR, "tloque-bowed-string-v3")
  assert.equal(isBowedOrchestralString("strings.violin"), true)
  assert.equal(isBowedOrchestralString("strings.violin-section"), true)
  assert.equal(isBowedOrchestralString("strings.harp"), false)
  assert.equal(isBowedOrchestralString("woodwinds.flute"), false)
})

test("los perfiles físicos separan cuerpos y mantienen realimentación estable", () => {
  const profiles = ["strings.violin", "strings.viola", "strings.cello", "strings.contrabass"].map(orchestralStringProfileFor)
  assert.equal(new Set(profiles.map(profile => profile.bodyModesHz.join(","))).size, 4)
  for (const profile of profiles) {
    assert.ok(profile.feedback > 0.9 && profile.feedback < 0.995)
    assert.equal(profile.bodyModesHz.length, profile.bodyGains.length)
    assert.ok(profile.bodyModesHz.every(value => Number.isFinite(value) && value > 20 && value < 8_000))
    assert.ok(profile.bodyGains.reduce((sum, value) => sum + value, 0) < 1)
  }
})

test("la fricción de arco es impar, acotada, finita y sobremuestreable", () => {
  const curve = orchestralBowFrictionCurve()
  assert.equal(curve.length, 4096)
  assert.ok(curve.every(value => Number.isFinite(value) && Math.abs(value) <= 1))
  for (let index = 0; index < curve.length; index += 97) {
    assert.ok(Math.abs(curve[index] + curve[curve.length - 1 - index]) < 1e-6)
  }
  assert.deepEqual(orchestralStringQuality(32_000), { oversample: 1, sectionMembers: 2, controlRateHz: 32 })
  assert.deepEqual(orchestralStringQuality(48_000), { oversample: 2, sectionMembers: 3, controlRateHz: 48 })
  assert.deepEqual(orchestralStringQuality(96_000), { oversample: 4, sectionMembers: 3, controlRateHz: 64 })
})

test("el plan conserva notas y une únicamente legatos dentro de la misma frase", () => {
  const score = recipe(), ids = new Set(score.plan.tracks.map(track => track.id))
  const units = buildOrchestralSynthRenderUnits(score, ids)
  const renderedEvents = units.flatMap(unit => unit.kind === "event" ? [unit.event] : unit.events)
  assert.deepEqual(renderedEvents.flatMap(event => event.notes), score.plan.events.flatMap(event => event.notes))
  const phrases = units.filter(unit => unit.kind === "string-phrase")
  assert.ok(phrases.some(unit => unit.events.length >= 2))
  assert.ok(phrases.length >= 2, "el rest debe cortar la voz física")
  assert.ok(phrases.every(unit => unit.events.slice(1).every(event => event.legatoFromPrevious)))
})

test("el fallback Web Audio renderiza una frase con una reserva, determinismo y cero clipping", async t => {
  const score = recipe(), track = score.plan.tracks[0]
  const phrase = buildOrchestralSynthRenderUnits(score, new Set([track.id]))
    .find(unit => unit.kind === "string-phrase" && unit.events.length >= 2)
  assert.ok(phrase && phrase.kind === "string-phrase")
  const render = async () => {
    const context = new OfflineAudioContext(2, 48_000 * 3, 48_000)
    assert.equal(await prepareOrchestralStringDsp(context), false)
    let reservations = 0
    const accepted = scheduleOrchestralStringPhrase(context, context.destination, 0, phrase.events, track, 0.8, score.plan.controls, () => { reservations += 1; return true })
    assert.equal(accepted, phrase.events.length)
    assert.equal(reservations, 1)
    const buffer = await context.startRendering(), analysis = analyzeAudioBuffer(buffer)
    assert.equal(analysis.clippedSampleCount, 0)
    assert.ok(Math.abs(analysis.dcOffset) < 0.001)
    assert.ok(analysis.integratedLufs > -60 && analysis.integratedLufs < -8)
    assert.ok(buffer.getChannelData(0).every(Number.isFinite))
    return { buffer, analysis }
  }
  const first = await render(), second = await render()
  assert.equal(pcmHash(first.buffer), pcmHash(second.buffer))
  const pcm = first.buffer.getChannelData(0), boundary = Math.round(phrase.events[1].timeSeconds * 48_000)
  const rms = (from: number, to: number) => {
    let sum = 0
    for (let index = from; index < to; index += 1) sum += pcm[index] ** 2
    return Math.sqrt(sum / Math.max(1, to - from))
  }
  const before = rms(boundary - 2_400, boundary - 240), after = rms(boundary + 240, boundary + 2_400)
  assert.ok(before > 0.00001 && after > before * 0.08, `${before} -> ${after}`)
  t.diagnostic(JSON.stringify({ peakDbfs: first.analysis.peakDbfs, lufs: first.analysis.integratedLufs, dc: first.analysis.dcOffset, sha256: pcmHash(first.buffer) }))
})

test("pressure, bow y coupling físicos cambian realmente el PCM de las cuerdas V3", async () => {
  const render = async (values: string) => {
    const score = recipeWithPhysicalControls(values), track = score.plan.tracks[0]
    const unit = buildOrchestralSynthRenderUnits(score, new Set([track.id])).find(item => item.kind === "string-phrase")
    assert.ok(unit && unit.kind === "string-phrase")
    const context = new OfflineAudioContext(2, 48_000 * 2, 48_000)
    scheduleOrchestralStringPhrase(context, context.destination, 0, unit.events, track, 0.8, score.plan.controls, () => true)
    const buffer = await context.startRendering()
    return { hash: pcmHash(buffer), rms: analyzeAudioBuffer(buffer).rmsLinear }
  }
  const softFingerboard = await render("pressure=0.12 bow=0.08 coupling=0.1")
  const drivenBridge = await render("pressure=0.9 bow=0.9 coupling=0.85")
  assert.notEqual(softFingerboard.hash, drivenBridge.hash)
  assert.ok(drivenBridge.rms > softFingerboard.rms * 1.02, `${softFingerboard.rms} -> ${drivenBridge.rms}`)
})

test("violín, viola, chelo y contrabajo conservan afinación en el modelo físico", async () => {
  const score = recipe(), baseTrack = score.plan.tracks[0]
  const cases = [
    ["strings.violin", 69],
    ["strings.viola", 60],
    ["strings.cello", 48],
    ["strings.contrabass", 36],
  ] as const
  for (const [instrument, midi] of cases) {
    const context = new OfflineAudioContext(1, 48_000 * 2, 48_000)
    const track = { ...baseTrack, instrument, vibrato: 0, brightness: 0.55 }
    const event = { timeSeconds: 0, durationSeconds: 1.6, notes: [midi], velocity: 0.58, articulation: "normal" }
    assert.equal(scheduleOrchestralStringPhrase(context, context.destination, 0, [event], track, 0.8, [], () => true), 1)
    const pcm = (await context.startRendering()).getChannelData(0)
    const expected = 440 * 2 ** ((midi - 69) / 12)
    let measured = expected, best = Number.NEGATIVE_INFINITY
    for (let frequency = expected * 0.8; frequency <= expected * 1.2; frequency += 0.25) {
      let sine = 0, cosine = 0
      for (let index = 24_000; index < 62_400; index += 1) {
        const phase = 2 * Math.PI * frequency * index / 48_000
        sine += pcm[index] * Math.sin(phase); cosine += pcm[index] * Math.cos(phase)
      }
      const energy = sine * sine + cosine * cosine
      if (energy > best) { best = energy; measured = frequency }
    }
    const cents = 1200 * Math.log2(measured / expected)
    assert.ok(Math.abs(cents) < 12, `${instrument}: ${measured.toFixed(2)} Hz (${cents.toFixed(1)} cents)`)
  }
})

test("el módulo AudioWorklet contiene waveguide, fricción no lineal y sobremuestreo sin dependencias externas", () => {
  const source = readFileSync("client/public/audio-worklets/tloque-bowed-string-v3.js", "utf8")
  assert.match(source, /registerProcessor\("tloque-bowed-string-v3"/)
  assert.match(source, /this\.oversample/)
  assert.match(source, /readDelay\(delaySamples\)/)
  assert.match(source, /Math\.tanh\(relative/)
  assert.match(source, /this\.feedback/)
  assert.doesNotMatch(source, /fetch\(|importScripts\(|https?:\/\//)
})

test("el procesador AudioWorklet real es determinista, finito y conserva varias octavas", () => {
  type ProcessorInstance = { process(inputs: unknown[], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean }
  type ProcessorConstructor = new (options: { processorOptions: Record<string, number | string> }) => ProcessorInstance
  const render = (targetFrequency = 440) => {
    let Processor: ProcessorConstructor | null = null
    const sandbox = {
      Float32Array,
      Math,
      sampleRate: 48_000,
      currentFrame: 0,
      AudioWorkletProcessor: class { port = { postMessage: (_value: unknown) => undefined } },
      registerProcessor: (name: string, constructor: ProcessorConstructor) => {
        assert.equal(name, ORCHESTRAL_STRING_WORKLET_PROCESSOR)
        Processor = constructor
      },
    }
    runInNewContext(readFileSync("client/public/audio-worklets/tloque-bowed-string-v3.js", "utf8"), sandbox)
    assert.ok(Processor)
    const processor = new (Processor as ProcessorConstructor)({ processorOptions: {
      version: ORCHESTRAL_STRING_DSP_VERSION,
      startFrame: 0,
      endFrame: 48_000,
      releaseFrames: 12_000,
      oversample: 2,
      seed: 710_239,
      feedback: 0.978,
      stiffness: 0.14,
      member: 0,
    } })
    const pcm = new Float32Array(60_032)
    const parameters = {
      frequency: new Float32Array([targetFrequency]),
      detune: new Float32Array([0]),
      bowPressure: new Float32Array([0.68]),
      bowPosition: new Float32Array([0.52]),
      brightness: new Float32Array([0.58]),
      gate: new Float32Array([1]),
    }
    for (let offset = 0; offset < pcm.length; offset += 128) {
      sandbox.currentFrame = offset
      const block = new Float32Array(Math.min(128, pcm.length - offset))
      processor.process([], [[block]], parameters)
      pcm.set(block, offset)
    }
    return pcm
  }
  const first = render(), second = render()
  assert.ok(first.every(value => Number.isFinite(value) && Math.abs(value) <= 1))
  assert.ok(first.some(value => Math.abs(value) > 0.0001))
  assert.equal(createHash("sha256").update(new Uint8Array(first.buffer)).digest("hex"), createHash("sha256").update(new Uint8Array(second.buffer)).digest("hex"))
  for (const targetFrequency of [220, 440, 880]) {
    const pcm = targetFrequency === 440 ? first : render(targetFrequency)
    let measured = targetFrequency, best = Number.NEGATIVE_INFINITY
    for (let frequency = targetFrequency * 0.96; frequency <= targetFrequency * 1.04; frequency += 0.25) {
      let sine = 0, cosine = 0
      for (let index = 14_400; index < 43_200; index += 1) {
        const phase = 2 * Math.PI * frequency * index / 48_000
        sine += pcm[index] * Math.sin(phase); cosine += pcm[index] * Math.cos(phase)
      }
      const energy = sine * sine + cosine * cosine
      if (energy > best) { best = energy; measured = frequency }
    }
    const cents = 1200 * Math.log2(measured / targetFrequency)
    assert.ok(Math.abs(cents) < 12, `${targetFrequency} Hz -> ${measured.toFixed(2)} Hz (${cents.toFixed(1)} cents)`)
  }
})
