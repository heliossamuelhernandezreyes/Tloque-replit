import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { OfflineAudioContext as NodeOfflineAudioContext } from "node-web-audio-api"
import { compileTloqueScore } from "../../shared/audio"
import { ORCHESTRAL_SYNTH_MAX_SOURCES } from "../../shared/orchestral-synthesis"
import { renderTloqueScoreToWav } from "../../client/src/audio/ScoreExporter"
import { analyzeAudioBuffer, type AudioRenderAnalysis } from "../../client/src/audio/AudioRenderAnalysis"
import { scheduleOrchestralSynthVoice } from "../../client/src/audio/OrchestralSynthVoice"
import { createNativeRenderGraph } from "../../client/src/audio/NativeRenderGraph"
import { NativeSamplePackPlayer } from "../../client/src/audio/NativeSamplePackEngine"
import { orchestralNoteExpression } from "../../client/src/audio/OrchestralExpression"
import { orchestralContinuousDynamics } from "../../client/src/audio/OrchestralDynamics"
import { ORCHESTRAL_QA_SCORE } from "../fixtures/orchestral-score"

// Offline DSP only: no audio device, browser, credentials, samples or network.
Object.defineProperty(globalThis, "OfflineAudioContext", { value: NodeOfflineAudioContext, configurable: true })
const compiled = compileTloqueScore(ORCHESTRAL_QA_SCORE)
if (!compiled.ok || compiled.recipe.version !== 2) throw new Error("Invalid orchestral fixture")
const recipe = compiled.recipe
const hash = (bytes: ArrayBuffer) => createHash("sha256").update(new Uint8Array(bytes)).digest("hex")
function spatial(buffer: AudioBuffer) {
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1)
  let side = 0, mid = 0, dot = 0, ll = 0, rr = 0
  for (let i = 0; i < left.length; i++) {
    side += (left[i] - right[i]) ** 2; mid += (left[i] + right[i]) ** 2
    dot += left[i] * right[i]; ll += left[i] ** 2; rr += right[i] ** 2
  }
  return { sideToMid: Math.sqrt(side / Math.max(mid, 1e-15)), correlation: dot / Math.sqrt(Math.max(ll * rr, 1e-15)) }
}

test("render real: mezcla no silenciosa, finita, estéreo, sin clipping y determinista", async t => {
  const hashes: string[] = []
  for (let attempt = 0; attempt < 2; attempt++) {
    let analysis: AudioRenderAnalysis | undefined
    const wav = await renderTloqueScoreToWav(recipe, { quality: "studio", onAnalysis: value => { analysis = value } })
    const bytes = await wav.arrayBuffer()
    hashes.push(hash(bytes))
    assert.ok(analysis)
    assert.equal(analysis.clippedSampleCount, 0)
    assert.ok(analysis.integratedLufs > -50 && analysis.integratedLufs < -10)
    assert.ok(analysis.truePeak4xDbtp < -1)
    assert.ok(Math.abs(analysis.dcOffset) < 0.001)
    assert.equal(analysis.sampleRate, 48_000)
    const context = new OfflineAudioContext(2, 1, 48_000)
    const buffer = await context.decodeAudioData(bytes.slice(0)), stage = spatial(buffer)
    assert.ok(stage.sideToMid > 0.02 && stage.sideToMid < 0.8)
    assert.ok(stage.correlation > 0.1 && stage.correlation < 0.999)
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) assert.ok(buffer.getChannelData(channel).every(Number.isFinite))
    if (attempt === 0) t.diagnostic(JSON.stringify({ ...analysis, ...stage, bytes: bytes.byteLength, sha256: hashes[0] }))
  }
  assert.equal(hashes[0], hashes[1], "same implementation/seed must render identical PCM")
})

test("preview y master sintético renderizan a 32/96 kHz sin pedir bancos", async t => {
  for (const quality of ["preview", "master"] as const) {
    let analysis: AudioRenderAnalysis | undefined
    const blob = await renderTloqueScoreToWav(recipe, { quality, onAnalysis: value => { analysis = value } })
    const bytes = new DataView(await blob.arrayBuffer())
    assert.equal(bytes.getUint32(24, true), quality === "preview" ? 32_000 : 96_000)
    assert.equal(bytes.getUint16(34, true), quality === "preview" ? 16 : 24)
    assert.ok(analysis && Number.isFinite(analysis.integratedLufs))
    assert.equal(analysis.clippedSampleCount, 0)
    assert.ok(analysis.truePeak4xDbtp < -1)
    t.diagnostic(JSON.stringify({ quality, peakDbfs: analysis.peakDbfs, lufs: analysis.integratedLufs }))
  }
})

test("cada familia produce una onda propia, finita y sin clipping", async t => {
  const hashes = new Set<string>()
  const rms = new Map<string, number>()
  for (const instrument of ["strings.violin", "strings.violin-section", "woodwinds.flute", "woodwinds.clarinet", "brass.trumpet", "brass.horn", "piano.grand", "strings.harp", "keys.celesta", "percussion.marimba"]) {
    const context = new OfflineAudioContext(2, 48_000 * 3, 48_000)
    const track = { ...recipe.plan.tracks[0], instrument, gain: 0.5, vibrato: 0.25 }
    assert.equal(scheduleOrchestralSynthVoice(context, context.destination, 0, { timeSeconds: 0.1, durationSeconds: 1.5, notes: [60], velocity: 0.6 }, track), 1)
    const buffer = await context.startRendering(), analysis = analyzeAudioBuffer(buffer)
    assert.equal(analysis.clippedSampleCount, 0)
    assert.ok(Number.isFinite(analysis.integratedLufs))
    const pcm = buffer.getChannelData(0)
    assert.ok(pcm.every(Number.isFinite))
    hashes.add(hash(pcm.buffer as ArrayBuffer))
    rms.set(instrument, analysis.rmsLinear)
    t.diagnostic(`${instrument}: ${analysis.peakDbfs.toFixed(2)} dBFS, ${analysis.integratedLufs.toFixed(2)} LUFS`)
  }
  assert.equal(hashes.size, 10)
  const sectionToSolo = rms.get("strings.violin-section")! / rms.get("strings.violin")!
  assert.ok(sectionToSolo > 0.65 && sectionToSolo < 1.4, "section power must remain comparable to solo")
})

test("presupuesto de fuentes incluye colas y se libera en tiempo de audio", () => {
  const context = new OfflineAudioContext(2, 48_000, 48_000)
  const track = { ...recipe.plan.tracks[0], instrument: "strings.violin-section" }
  let accepted = 0
  for (let i = 0; i < 100; i++) accepted += scheduleOrchestralSynthVoice(context, context.destination, 0, { timeSeconds: 0, durationSeconds: 1, notes: [60], velocity: 0.3 }, track)
  assert.equal(accepted, ORCHESTRAL_SYNTH_MAX_SOURCES / 4, "three oscillators plus one excitation per section note")
  assert.equal(scheduleOrchestralSynthVoice(context, context.destination, 0, { timeSeconds: 5, durationSeconds: 0.5, notes: [64], velocity: 0.3 }, track), 1)
})

test("recuperación realtime tardía no olvida voces aún activas tras el look-ahead", () => {
  const offline = new OfflineAudioContext(2, 48_000, 48_000)
  // Reuse actual AudioNodes with the live-clock admission path, without opening
  // a hardware audio device or claiming a browser transport test.
  const context = new Proxy(offline, { get(target, key) {
    if (key === "startRendering") return undefined
    const value = Reflect.get(target, key)
    return typeof value === "function" ? value.bind(target) : value
  } })
  const track = { ...recipe.plan.tracks[0], instrument: "strings.violin-section" }
  const event = { timeSeconds: 0, durationSeconds: 1, notes: [60], velocity: 0.3 }
  for (let i = 0; i < ORCHESTRAL_SYNTH_MAX_SOURCES / 4; i++) assert.equal(scheduleOrchestralSynthVoice(context, context.destination, 0, event, track), 1)
  assert.equal(scheduleOrchestralSynthVoice(context, context.destination, 0, { ...event, timeSeconds: 5 }, track), 1)
  assert.equal(scheduleOrchestralSynthVoice(context, context.destination, 0, { ...event, timeSeconds: 0.1 }, track), 0)
})

test("audio real: interrumpir un crescendo conserva su tramo anterior", async () => {
  const context = new OfflineAudioContext(2, 48_000 * 7, 48_000), track = recipe.plan.tracks[0]
  const graph = createNativeRenderGraph(context, new Map([[track.id, track]]), context.destination)
  const gain = graph.createTrackPath(track.id, 0.4, 0.5, 0)
  gain.disconnect(); gain.connect(context.destination)
  const constant = context.createConstantSource(); constant.offset.value = 1; constant.connect(gain); constant.start(0)
  graph.scheduleTrackControl({ trackId: track.id, timeSeconds: 2, rampSeconds: 4, gain: 1, brightness: null })
  graph.scheduleTrackControl({ trackId: track.id, timeSeconds: 4, rampSeconds: 2, gain: 0.2, brightness: null })
  const samples = (await context.startRendering()).getChannelData(0)
  for (const [time, value] of [[1, 0.4], [2, 0.4], [3, 0.55], [4, 0.7], [5, 0.45], [6.5, 0.2]]) assert.ok(Math.abs(samples[Math.round(time * 48_000)] - value) < 0.001, `${time}s expected ${value}`)
  graph.disconnect()
})

test("un timbre non-vibrato de evento anula el vibrato de la pista", async () => {
  const render = async (vibrato: number, timbre?: string) => {
    const context = new OfflineAudioContext(2, 48_000 * 2, 48_000)
    scheduleOrchestralSynthVoice(context, context.destination, 0, { timeSeconds: 0, durationSeconds: 1.5, notes: [69], velocity: 0.5, timbre }, { ...recipe.plan.tracks[0], instrument: "strings.violin", vibrato })
    return hash((await context.startRendering()).getChannelData(0).buffer as ArrayBuffer)
  }
  const none = await render(0)
  assert.equal(await render(0.8, "non-vibrato"), none)
  assert.notEqual(await render(0.8), none)
})

test("bend recorre la altura durante la nota, no sólo en su ataque", async () => {
  const context = new OfflineAudioContext(2, 48_000 * 2, 48_000)
  const track = { ...recipe.plan.tracks[0], instrument: "woodwinds.flute", vibrato: 0 }
  const control = { ...recipe.plan.controls[0], trackId: track.id, timeSeconds: 0.5, pitchBend: 2, rampSeconds: 0.5 }
  scheduleOrchestralSynthVoice(context, context.destination, 0, { timeSeconds: 0, durationSeconds: 1.8, notes: [69], velocity: 0.5 }, track, 1, [control])
  const pcm = (await context.startRendering()).getChannelData(0)
  const frequency = (start: number, end: number) => {
    let crossings = 0
    for (let i = Math.ceil(start * 48_000); i < end * 48_000; i++) if (pcm[i - 1] < 0 && pcm[i] >= 0) crossings++
    return crossings / (end - start)
  }
  assert.ok(Math.abs(frequency(0.15, 0.45) - 440) < 8)
  assert.ok(Math.abs(frequency(1.2, 1.7) - 440 * 2 ** (2 / 12)) < 8)
})

test("audio real: un crescendo sostenido abre el color durante la misma nota", async () => {
  const context = new OfflineAudioContext(2, 48_000 * 4, 48_000)
  const track = { ...recipe.plan.tracks[0], instrument: "strings.violin", expression: 0.16, brightness: 0.18, vibrato: 0 }
  const control = { ...recipe.plan.controls[0], trackId: track.id, timeSeconds: 0, expression: 1, brightness: 0.95, rampSeconds: 3.2 }
  scheduleOrchestralSynthVoice(context, context.destination, 0, { timeSeconds: 0, durationSeconds: 3.5, notes: [57], velocity: 0.42, articulation: "legato" }, track, 1, [control])
  const pcm = (await context.startRendering()).getChannelData(0)
  const harmonicEnergy = (start: number, end: number, from: number, to: number) => {
    let energy = 0
    for (let harmonic = from; harmonic <= to; harmonic++) {
      const frequency = 220 * harmonic
      let sine = 0, cosine = 0
      for (let i = Math.ceil(start * 48_000); i < end * 48_000; i++) {
        const phase = 2 * Math.PI * frequency * i / 48_000
        sine += pcm[i] * Math.sin(phase); cosine += pcm[i] * Math.cos(phase)
      }
      energy += sine ** 2 + cosine ** 2
    }
    return energy
  }
  const early = harmonicEnergy(0.45, 0.9, 24, 32) / harmonicEnergy(0.45, 0.9, 1, 5)
  const late = harmonicEnergy(2.6, 3.05, 24, 32) / harmonicEnergy(2.6, 3.05, 1, 5)
  assert.ok(late > early * 1.1, `expected upper-partial opening: ${early} -> ${late}`)
})

test("audio real: enlace legato reduce la nueva excitación y alcanza la altura destino", async () => {
  const render = async (linked: boolean, includePrevious = true) => {
    const context = new OfflineAudioContext(2, 48_000 * 2, 48_000)
    const track = { ...recipe.plan.tracks[0], instrument: "woodwinds.flute", vibrato: 0 }
    if (includePrevious) scheduleOrchestralSynthVoice(context, context.destination, 0, { timeSeconds: 0, durationSeconds: 1, notes: [69], velocity: 0.5, articulation: "legato" }, track)
    scheduleOrchestralSynthVoice(context, context.destination, 0, { timeSeconds: 1, durationSeconds: 0.8, notes: [71], velocity: 0.5, articulation: "legato", ...(linked ? { legatoFromPrevious: true, transitionFromMidi: 69 } : {}) }, track)
    return (await context.startRendering()).getChannelData(0)
  }
  const connected = await render(true), connectedIncoming = await render(true, false), detachedIncoming = await render(false, false)
  const boundaryDerivative = (pcm: Float32Array) => {
    let peak = 0
    for (let i = 48_000; i < 48_000 * 1.05; i++) peak = Math.max(peak, Math.abs(pcm[i] - pcm[i - 1]))
    return peak
  }
  assert.ok(boundaryDerivative(connectedIncoming) < boundaryDerivative(detachedIncoming))
  let crossings = 0
  for (let i = Math.ceil(1.18 * 48_000); i < 1.58 * 48_000; i++) if (connected[i - 1] < 0 && connected[i] >= 0) crossings++
  assert.ok(Math.abs(crossings / 0.4 - 493.88) < 12)
})

test("envolvente nativa funciona sobre un buffer y no altera los one-shots", async () => {
  const render = async (oneShot: boolean, expressive: boolean) => {
    const context = new OfflineAudioContext(2, 48_000 * 2, 48_000)
    const buffer = context.createBuffer(1, 48_000, 48_000)
    const pcm = buffer.getChannelData(0)
    for (let i = 0; i < pcm.length; i++) pcm[i] = 0.15 * Math.sin(2 * Math.PI * 440 * i / 48_000)
    const zone = { id: "qa", articulation: "normal" as const, sampleUrl: "/qa-not-fetched.wav", rootMidi: 69, loMidi: 69, hiMidi: 69, loVelocity: 0, hiVelocity: 127, velocityLayer: 0, roundRobin: 0, gainDb: 0, tuneCents: 0 }
    const player = new NativeSamplePackPlayer(context, new Map([[zone.sampleUrl, buffer]]))
    const expression = expressive ? orchestralNoteExpression("strings.violin", "normal", 0.9, 0.4, false, "qa") : undefined
    await player.playSelection({ zone, playbackRate: 1, gain: 0.8 }, 0, 0.9, context.destination, 0, oneShot, { expression })
    const rendered = await context.startRendering()
    assert.equal(analyzeAudioBuffer(rendered).clippedSampleCount, 0)
    return hash(rendered.getChannelData(0).buffer as ArrayBuffer)
  }
  assert.equal(await render(true, true), await render(true, false))
  assert.notEqual(await render(false, true), await render(false, false))
})

test("audio real: muestra sostenida sigue color continuo y one-shot permanece intacto", async () => {
  const render = async (oneShot: boolean, dynamic: boolean) => {
    const context = new OfflineAudioContext(2, 48_000 * 2, 48_000)
    const buffer = context.createBuffer(1, 48_000, 48_000), pcm = buffer.getChannelData(0)
    for (let i = 0; i < pcm.length; i++) pcm[i] = 0.08 * Math.sin(2 * Math.PI * 440 * i / 48_000) + 0.035 * Math.sin(2 * Math.PI * 5_280 * i / 48_000)
    const zone = { id: "dynamic-qa", articulation: "normal" as const, sampleUrl: "/dynamic-qa.wav", rootMidi: 69, loMidi: 69, hiMidi: 69, loVelocity: 0, hiVelocity: 127, velocityLayer: 0, roundRobin: 0, gainDb: 0, tuneCents: 0 }
    const player = new NativeSamplePackPlayer(context, new Map([[zone.sampleUrl, buffer]]))
    const track = { ...recipe.plan.tracks[0], instrument: "strings.violin", expression: 0.2, brightness: 0.1 }
    const control = { ...recipe.plan.controls[0], trackId: track.id, timeSeconds: 0, expression: 1, brightness: 1, rampSeconds: 0.9 }
    const dynamics = dynamic ? orchestralContinuousDynamics(track, [control], 0, 0.9, 0.5, "normal") : undefined
    await player.playSelection({ zone, playbackRate: 1, gain: 0.8 }, 0, 0.9, context.destination, 0, oneShot, { dynamics })
    return hash((await context.startRendering()).getChannelData(0).buffer as ArrayBuffer)
  }
  assert.notEqual(await render(false, true), await render(false, false))
  assert.equal(await render(true, true), await render(true, false))
})
