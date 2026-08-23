import { linearScoreRecipeFor } from "@shared/audio"
import { encodeAudioBufferToWav, type ScoreExportOptions } from "./ScoreExporter"
import { NativeSamplePackPlayer } from "./NativeSamplePackEngine"
import { buildNativeSampleScorePlan } from "./NativeSampleScorePlan"
import { createSampledMixMaster } from "./ScoreMixMaster"

const MAX_OFFLINE_FLOAT_BYTES = 220 * 1024 * 1024

function nativeSampleQuality(value: unknown, options: ScoreExportOptions) {
  const recipe = linearScoreRecipeFor(value)
  const requested = options.quality ?? (recipe.version === 2 && recipe.plan.quality === "core"
    ? "preview"
    : recipe.version === 2 ? recipe.plan.quality : "studio")
  return requested === "preview"
    ? { quality: requested, sampleRate: 32_000, bitDepth: 16 as const, tail: 2.5 }
    : { quality: requested, sampleRate: 48_000, bitDepth: 24 as const, tail: requested === "master" ? 8 : 5 }
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Exportación cancelada", "AbortError")
}

/**
 * Renders a TloqueSamplePack with the same acoustic plan and sampled mix/master
 * used by NativeSampleScoreEngine. Runtime-only cue gain, ducking and narrative
 * fades are intentionally excluded from a standalone master WAV.
 */
export async function renderTloqueScoreWithNativeSamplePackToWav(
  value: unknown,
  packUrl: string,
  options: ScoreExportOptions = {},
): Promise<Blob> {
  const recipe = linearScoreRecipeFor(value)
  if (recipe.version !== 2 || recipe.plan.moduleId === "builtin") {
    throw new Error("La partitura no solicita un paquete nativo")
  }
  if (!packUrl.startsWith("/api/audio/sample-packs/modules/")) {
    throw new Error("El módulo nativo debe provenir del almacenamiento interno de Tloque")
  }

  const profile = nativeSampleQuality(recipe, options)
  const durationSeconds = recipe.plan.totalSeconds + profile.tail
  const totalFrames = Math.ceil(durationSeconds * profile.sampleRate)
  const floatBytes = totalFrames * 2 * Float32Array.BYTES_PER_ELEMENT
  if (floatBytes > MAX_OFFLINE_FLOAT_BYTES) {
    throw new Error("La obra muestreada excede la memoria segura del navegador móvil; expórtala por movimientos")
  }

  assertNotAborted(options.signal)
  options.onProgress?.(0.02)
  const context = new OfflineAudioContext(2, totalFrames, profile.sampleRate)
  const player = new NativeSamplePackPlayer(context)
  const pack = await player.loadPack(packUrl)
  if (pack.instrumentManifestId !== recipe.plan.moduleId) {
    throw new Error("El paquete nativo no corresponde al módulo solicitado")
  }
  options.onProgress?.(0.10)

  const plan = buildNativeSampleScorePlan(recipe, pack)
  await player.preload(plan.zones)
  assertNotAborted(options.signal)
  options.onProgress?.(0.20)

  const mix = createSampledMixMaster(context, 1)
  mix.output.connect(context.destination)
  const trackGain = new Map<string, GainNode>()
  const trackNodes: AudioNode[] = []

  for (const track of plan.tracks) {
    const gain = context.createGain()
    gain.gain.value = track.gain
    trackNodes.push(gain)
    if (typeof context.createStereoPanner === "function") {
      const panner = context.createStereoPanner()
      panner.pan.value = track.pan
      gain.connect(panner)
      panner.connect(mix.input)
      trackNodes.push(panner)
    } else {
      gain.connect(mix.input)
    }
    trackGain.set(track.id, gain)
  }

  for (const control of plan.controls) {
    const gain = trackGain.get(control.trackId)
    if (!gain) continue
    const at = control.timeSeconds
    gain.gain.cancelScheduledValues(at)
    if (control.rampSeconds > 0) gain.gain.linearRampToValueAtTime(control.gain, at + control.rampSeconds)
    else gain.gain.setValueAtTime(control.gain, at)
  }

  const scheduled: Promise<unknown>[] = []
  for (const voice of plan.voices) {
    const destination = trackGain.get(voice.trackId)
    if (!destination) continue
    scheduled.push(player.play({
      pack,
      articulation: voice.articulation,
      note: voice.note,
      velocity: voice.velocity,
      roundRobin: voice.roundRobin,
      startTime: voice.startSeconds,
      durationSeconds: voice.durationSeconds,
      destination,
    }))
  }
  await Promise.all(scheduled)
  assertNotAborted(options.signal)
  options.onProgress?.(0.28)

  const rendered = await context.startRendering()
  options.onProgress?.(0.82)
  for (const node of trackNodes) node.disconnect()
  mix.disconnect()
  return encodeAudioBufferToWav(rendered, profile.bitDepth, progress => {
    options.onProgress?.(0.82 + progress * 0.18)
  })
}
