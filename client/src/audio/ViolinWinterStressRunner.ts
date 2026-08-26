import type { NativeHybridSource } from "@shared/native-hybrid-source"
import { VIOLIN_WINTER_STRESS_INSTRUMENT, compileViolinWinterStressV1 } from "@shared/violin-winter-stress"
import { scheduleHybridPhysicalOverlay } from "./HybridPhysicalOverlay"
import { preferredNativeModuleForInstrument } from "./NativeAutoModule"
import { renderTloqueScoreWithNativeSamplePackToWav } from "./NativeSampleScoreExporter"

export interface ViolinWinterStressResult {
  sampled: Blob
  hybrid: Blob
  durationSeconds: number
  moduleId: string
  engineVersion: string
}

function encodeWav(buffer: AudioBuffer) {
  const channels = buffer.numberOfChannels
  const frames = buffer.length
  const view = new DataView(new ArrayBuffer(44 + frames * channels * 2))
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i))
  }
  text(0, "RIFF")
  view.setUint32(4, 36 + frames * channels * 2, true)
  text(8, "WAVE")
  text(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  text(36, "data")
  view.setUint32(40, frames * channels * 2, true)
  let offset = 44
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const x = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[frame]))
      view.setInt16(offset, x < 0 ? x * 0x8000 : x * 0x7fff, true)
      offset += 2
    }
  }
  return new Blob([view.buffer], { type: "audio/wav" })
}

export async function runViolinWinterStressV1(source: NativeHybridSource, signal?: AbortSignal): Promise<ViolinWinterStressResult> {
  if (source.instrumentId !== VIOLIN_WINTER_STRESS_INSTRUMENT) {
    throw new Error(`Winter Stress v1 sólo certifica ${VIOLIN_WINTER_STRESS_INSTRUMENT}`)
  }
  if (source.physicalLayer !== "bowed-string-resonator") {
    throw new Error("Winter Stress v1 requiere la capa física de arco + cuerda")
  }

  const compiled = compileViolinWinterStressV1()
  if (!compiled.ok || compiled.recipe.version !== 2) {
    throw new Error(`No se pudo compilar Winter Stress v1: ${compiled.ok ? "versión inválida" : compiled.diagnostics.map(item => item.message).join(" · ")}`)
  }

  const recipe = compiled.recipe
  const moduleId = preferredNativeModuleForInstrument(source.instrumentId)
  if (!moduleId) throw new Error(`No existe sample base para ${source.instrumentId}`)

  const sampled = await renderTloqueScoreWithNativeSamplePackToWav(
    recipe,
    "/api/audio/sample-packs/modules/native-auto.json",
    { quality: "studio", signal, hybridMode: "none" },
  )
  if (signal?.aborted) throw new DOMException("Winter Stress cancelado", "AbortError")

  const decoder = new OfflineAudioContext(2, 1, 48_000)
  const sampledBuffer = await decoder.decodeAudioData(await sampled.arrayBuffer())
  const context = new OfflineAudioContext(sampledBuffer.numberOfChannels, sampledBuffer.length, sampledBuffer.sampleRate)
  const base = context.createBufferSource()
  base.buffer = sampledBuffer
  base.connect(context.destination)
  base.start(0)

  const physicalBus = context.createGain()
  physicalBus.gain.value = 0.32
  physicalBus.connect(context.destination)

  const track = recipe.plan.tracks[0]
  if (!track) throw new Error("Winter Stress v1 no contiene pista de violín")
  const controls = recipe.plan.controls
  let previousEnd: number | undefined
  for (const event of recipe.plan.events) {
    const legatoFromPrevious = event.articulation === "legato" && previousEnd !== undefined && event.timeSeconds - previousEnd <= 0.08
    for (const midi of event.notes) {
      scheduleHybridPhysicalOverlay(context, source, {
        startAt: 0,
        event,
        track,
        midi,
        destination: physicalBus,
        controls,
        legatoFromPrevious,
      })
    }
    previousEnd = event.timeSeconds + event.durationSeconds
  }

  const hybridBuffer = await context.startRendering()
  return {
    sampled,
    hybrid: encodeWav(hybridBuffer),
    durationSeconds: sampledBuffer.duration,
    moduleId,
    engineVersion: source.engineVersion,
  }
}
