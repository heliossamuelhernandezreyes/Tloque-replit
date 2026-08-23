import { linearScoreRecipeFor } from "@shared/audio"
import { encodeAudioBufferToWav, type ScoreExportOptions } from "./ScoreExporter"
import { NativeSamplePackPlayer } from "./NativeSamplePackEngine"
import { buildNativeSampleScorePlan } from "./NativeSampleScorePlan"
import { createSampledMixMaster } from "./ScoreMixMaster"

const MAX_OFFLINE_FLOAT_BYTES = 220 * 1024 * 1024

function nativeSampleQuality(value: unknown, options: ScoreExportOptions) {
  const recipe = linearScoreRecipeFor(value)
  const requested = options.quality ?? (recipe.version === 2 && recipe.plan.quality === "core" ? "preview" : recipe.version === 2 ? recipe.plan.quality : "studio")
  return requested === "preview"
    ? { quality: requested, sampleRate: 32_000, bitDepth: 16 as const, tail: 2.5 }
    : { quality: requested, sampleRate: 48_000, bitDepth: 24 as const, tail: requested === "master" ? 8 : 5 }
}
function assertNotAborted(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("Exportación cancelada", "AbortError") }

export async function renderTloqueScoreWithNativeSamplePackToWav(value: unknown, packUrl: string, options: ScoreExportOptions = {}): Promise<Blob> {
  const recipe = linearScoreRecipeFor(value)
  if (recipe.version !== 2 || recipe.plan.moduleId === "builtin") throw new Error("La partitura no solicita un paquete nativo")
  if (!packUrl.startsWith("/api/audio/sample-packs/modules/")) throw new Error("El módulo nativo debe provenir del almacenamiento interno de Tloque")

  const profile = nativeSampleQuality(recipe, options)
  assertNotAborted(options.signal); options.onProgress?.(0.02)
  const decodeContext = new OfflineAudioContext(2, 1, profile.sampleRate)
  const decodePlayer = new NativeSamplePackPlayer(decodeContext)
  const pack = await decodePlayer.loadPack(packUrl)
  if (pack.instrumentManifestId !== recipe.plan.moduleId) throw new Error("El paquete nativo no corresponde al módulo solicitado")
  const plan = buildNativeSampleScorePlan(recipe, pack); options.onProgress?.(0.10)
  const decoded = await decodePlayer.preload(plan.zones); assertNotAborted(options.signal)

  const decodedByUrl = new Map<string, AudioBuffer>()
  plan.zones.forEach((zone, index) => { const buffer = decoded[index]; if (buffer) decodedByUrl.set(zone.sampleUrl, buffer) })
  const naturalEnd = plan.voices.reduce((latest, voice) => {
    if (!voice.oneShot || !voice.sampleUrl) return latest
    const physical = decodedByUrl.get(voice.sampleUrl)?.duration ?? 0
    return Math.max(latest, voice.startSeconds + physical / Math.max(0.01, voice.playbackRate))
  }, recipe.plan.totalSeconds)
  const durationSeconds = Math.max(recipe.plan.totalSeconds, naturalEnd) + profile.tail
  const totalFrames = Math.ceil(durationSeconds * profile.sampleRate), floatBytes = totalFrames * 2 * Float32Array.BYTES_PER_ELEMENT
  if (floatBytes > MAX_OFFLINE_FLOAT_BYTES) throw new Error("La obra muestreada excede la memoria segura del navegador móvil; expórtala por movimientos")
  options.onProgress?.(0.20)

  const context = new OfflineAudioContext(2, totalFrames, profile.sampleRate)
  const player = new NativeSamplePackPlayer(context, decodedByUrl)
  const mix = createSampledMixMaster(context, 1); mix.output.connect(context.destination)
  const trackGain = new Map<string, GainNode>(), trackNodes: AudioNode[] = []
  for (const track of plan.tracks) {
    const gain = context.createGain(); gain.gain.value = track.gain; trackNodes.push(gain)
    if (typeof context.createStereoPanner === "function") { const panner = context.createStereoPanner(); panner.pan.value = track.pan; gain.connect(panner); panner.connect(mix.input); trackNodes.push(panner) } else gain.connect(mix.input)
    trackGain.set(track.id, gain)
  }
  for (const control of plan.controls) {
    const gain = trackGain.get(control.trackId); if (!gain) continue
    const at = control.timeSeconds; gain.gain.cancelScheduledValues(at)
    if (control.rampSeconds > 0) gain.gain.linearRampToValueAtTime(control.gain, at + control.rampSeconds); else gain.gain.setValueAtTime(control.gain, at)
  }

  const scheduled: Promise<unknown>[] = []
  for (const voice of plan.voices) {
    const destination = trackGain.get(voice.trackId); if (!destination) continue
    scheduled.push(player.play({
      pack, articulation: voice.articulation, note: voice.note, velocity: voice.velocity, roundRobin: voice.roundRobin,
      vibrato: voice.vibrato, vibratoColour: voice.vibratoColour, mute: voice.mute,
      startTime: voice.startSeconds, durationSeconds: voice.durationSeconds, destination, oneShot: voice.oneShot,
    }))
  }
  await Promise.all(scheduled); assertNotAborted(options.signal); options.onProgress?.(0.28)
  const rendered = await context.startRendering(); options.onProgress?.(0.82)
  for (const node of trackNodes) node.disconnect(); mix.disconnect()
  return encodeAudioBufferToWav(rendered, profile.bitDepth, progress => { options.onProgress?.(0.82 + progress * 0.18) })
}
