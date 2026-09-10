import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { OfflineAudioContext as NodeOfflineAudioContext } from "node-web-audio-api"
import { NativeSamplePackPlayer } from "../../client/src/audio/NativeSamplePackEngine"
import { selectNativeSampleVelocityTrajectory } from "../../client/src/audio/NativeSampleVelocityBlend"
import { buildNativeSampleScorePlan, nativeSampleVoiceEnvelope } from "../../client/src/audio/NativeSampleScorePlan"
import { renderTloqueScoreWithNativeSamplePackToWav } from "../../client/src/audio/NativeSampleScoreExporter"
import { encodeAudioBufferToWav } from "../../client/src/audio/ScoreExporter"
import { analyzeAudioBuffer, type AudioRenderAnalysis } from "../../client/src/audio/AudioRenderAnalysis"
import { SUSTAIN_LAYER_PACK as pack, sustainLayerRecipe } from "../fixtures/native-sustain-layers"

Object.defineProperty(globalThis, "OfflineAudioContext", { value: NodeOfflineAudioContext, configurable: true })
const RATE = 48_000
const hash = (pcm: Float32Array) => createHash("sha256").update(new Uint8Array(pcm.buffer)).digest("hex")
function buffers(context: BaseAudioContext) {
  return new Map(pack.zones.map(zone => {
    const buffer = context.createBuffer(1, RATE, RATE)
    const data = buffer.getChannelData(0)
    // Identifiable independent partials, not imported acoustic recordings.
    for (let i = 0; i < data.length; i++) data[i] = 0.1 * Math.sin(2 * Math.PI * 440 * (zone.velocityLayer * 2 + 1) * i / RATE)
    return [zone.sampleUrl, buffer] as const
  }))
}
function component(pcm: Float32Array, hz: number, start: number, end: number) {
  let real = 0, imag = 0
  for (let i = Math.round(start * RATE); i < Math.round(end * RATE); i++) {
    const phase = 2 * Math.PI * hz * i / RATE
    real += pcm[i] * Math.cos(phase); imag += pcm[i] * Math.sin(phase)
  }
  return Math.hypot(real, imag) * 2 / ((end - start) * RATE)
}

test("PCM: cambia la capa audible dentro de una nota, sin nuevos ataques ni clipping", async t => {
  const render = async () => {
    const context = new OfflineAudioContext(1, RATE * 4, RATE)
    const voices = selectNativeSampleVelocityTrajectory(pack, "normal", 69, Float32Array.from({ length: 97 }, (_, i) => 8 + 112 * i / 96), 0, { amplitudeVelocity: 80 })
    const player = new NativeSamplePackPlayer(context, buffers(context))
    const sources = await Promise.all(voices.map(voice => player.playSelection(voice, 0.1, 3, context.destination, 0, false, { layerGainCurve: voice.layerGainCurve })))
    assert.equal(sources.length, 3, "one source per visited recording, not one per automation point")
    const output = await context.startRendering()
    assert.equal(analyzeAudioBuffer(output).clippedSampleCount, 0)
    return output.getChannelData(0)
  }
  const pcm = await render()
  const earlySoft = component(pcm, 440, 0.25, 0.45), earlyForte = component(pcm, 2200, 0.25, 0.45)
  const lateSoft = component(pcm, 440, 2.75, 2.95), lateForte = component(pcm, 2200, 2.75, 2.95)
  assert.ok(earlySoft > 0.03 && lateForte > 0.03)
  assert.ok(earlyForte < earlySoft * 0.01 && lateSoft < lateForte * 0.01)
  assert.ok(pcm.every(Number.isFinite))
  assert.equal(hash(pcm), hash(await render()))
  t.diagnostic(JSON.stringify({ earlySoft, earlyForte, lateSoft, lateForte, sources: 3, sha256: hash(pcm) }))
})

test("PCM: la capa apagada no reaparece en la cola y un one-shot ignora el crossfade", async () => {
  const render = async (oneShot: boolean, automated: boolean) => {
    const context = new OfflineAudioContext(1, RATE * 2, RATE)
    const zone = { ...pack.zones[0], loopStartSeconds: undefined, loopEndSeconds: undefined, amplitudeReleaseSeconds: 0.4 }
    const player = new NativeSamplePackPlayer(context, buffers(context))
    await player.playSelection({ zone, playbackRate: 1, gain: 0.6 }, 0, 0.5, context.destination, 0, oneShot, automated ? { layerGainCurve: Float32Array.from([1, 0]) } : {})
    return (await context.startRendering()).getChannelData(0)
  }
  const automated = await render(false, true), staticPcm = await render(false, false)
  assert.ok(component(staticPcm, 440, 0.6, 0.8) > 0.01)
  assert.ok(component(automated, 440, 0.6, 0.8) < 1e-8)
  assert.equal(hash(await render(true, true)), hash(await render(true, false)))
})

test("PCM: el plan de partitura lleva el crescendo grabado hasta la salida del player", async () => {
  const context = new OfflineAudioContext(1, RATE * 5, RATE)
  const plan = buildNativeSampleScorePlan(sustainLayerRecipe(), pack)
  const player = new NativeSamplePackPlayer(context, buffers(context))
  for (const voice of plan.voices) {
    const zone = plan.zones.find(item => item.id === voice.zoneId)!
    await player.playSelection({ zone, gain: voice.sampleGain, playbackRate: voice.playbackRate }, voice.startSeconds, voice.durationSeconds, context.destination, 0, voice.oneShot, nativeSampleVoiceEnvelope(voice))
  }
  const output = await context.startRendering(), pcm = output.getChannelData(0)
  const earlyRatio = component(pcm, 2200, 0.15, 0.4) / component(pcm, 1320, 0.15, 0.4)
  const lateRatio = component(pcm, 2200, 3.2, 3.45) / component(pcm, 1320, 3.2, 3.45)
  assert.ok(earlyRatio < 0.01)
  assert.ok(lateRatio > 0.3)
  assert.equal(analyzeAudioBuffer(output).clippedSampleCount, 0)
})

test("WAV nativo estricto usa todas las capas y rechaza un PCM tardío ausente", async t => {
  const originalFetch = globalThis.fetch
  const decode = new OfflineAudioContext(1, 1, RATE)
  const bytes = new Map<string, ArrayBuffer>()
  for (const [url, buffer] of buffers(decode)) bytes.set(url, await (await encodeAudioBufferToWav(buffer, 24)).arrayBuffer())
  const requested = new Set<string>()
  let missing = false
  globalThis.fetch = async input => {
    const url = String(input)
    requested.add(url)
    if (url.endsWith(".json")) return new Response(JSON.stringify(pack), { headers: { "Content-Type": "application/json" } })
    const body = bytes.get(url)
    if (!body || (missing && url === pack.zones[2].sampleUrl)) return new Response(null, { status: 404 })
    return new Response(body.slice(0), { headers: { "Content-Type": "audio/wav" } })
  }
  try {
    let analysis: AudioRenderAnalysis | undefined
    const render = () => renderTloqueScoreWithNativeSamplePackToWav(sustainLayerRecipe(), "/api/audio/sample-packs/modules/vsco2-ce-solo-violin.json", {
      quality: "studio", strictNativeSources: true, hybridMode: "none", onAnalysis: value => { analysis = value },
    })
    const wav = new DataView(await (await render()).arrayBuffer())
    assert.equal(wav.getUint32(24, true), RATE)
    assert.equal(wav.getUint16(34, true), 24)
    assert.ok(pack.zones.every(zone => requested.has(zone.sampleUrl)))
    assert.ok(analysis && Number.isFinite(analysis.integratedLufs))
    assert.equal(analysis.clippedSampleCount, 0)
    assert.ok(analysis.truePeak4xDbtp < -1)
    t.diagnostic(JSON.stringify({ sampleRate: RATE, bitDepth: 24, lufs: analysis.integratedLufs, truePeak: analysis.truePeak4xDbtp }))
    missing = true
    await assert.rejects(render(), /no pudo cubrir o decodificar.*Muestra 404/)
  } finally { globalThis.fetch = originalFetch }
})
