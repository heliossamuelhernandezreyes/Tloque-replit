import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url"
import { MIDIBuilder } from "spessasynth_core"
import { linearScoreRecipeFor, type LinearScoreRecipe } from "@shared/audio"
import { manifestsForModule, type InstrumentManifest } from "@shared/instrument-manifest"
import { fetchAudioResource } from "./AudioResourceCache"
import { encodeAudioBufferToWav, type ScoreExportOptions, type ScoreExportQuality } from "./ScoreExporter"
import { buildPerformancePlan, performedEventValues } from "./PerformanceEngine"
import { buildSamplerEventPlan, spessaSynthActions } from "./SamplerAdapter"
import { createSampledMixMaster } from "./ScoreMixMaster"
import { analyzeAudioBuffer } from "./AudioRenderAnalysis"
import {
  articulationDurationFactor, articulationVelocityFactor,
  scoreTrackBrightness, scoreTrackExpression, scoreTrackTimbre, scoreTrackVibrato, scoreVelocityGain,
} from "./ScoreAudioMath"

const TICKS_PER_SECOND = 960
const MAX_OFFLINE_FLOAT_BYTES = 220 * 1024 * 1024

function ticks(seconds: number) {
  return Math.max(0, Math.round(seconds * TICKS_PER_SECOND))
}

function midi7(value: number) {
  return Math.max(0, Math.min(127, Math.round(value * 127)))
}

function scoreManifests(recipe: LinearScoreRecipe, override?: readonly InstrumentManifest[]) {
  if (override) return override
  return manifestsForModule(recipe.version === 2 ? recipe.plan.moduleId : null)
}

export function buildTloqueScoreMidi(
  value: unknown,
  manifests?: readonly InstrumentManifest[],
): MIDIBuilder {
  const recipe = linearScoreRecipeFor(value)
  const midi = new MIDIBuilder({
    format: 1,
    timeDivision: TICKS_PER_SECOND,
    initialTempo: 60,
    name: recipe.version === 2 ? recipe.plan.title : "TloqueScore",
  })
  const playableTracks = recipe.plan.tracks.slice(0, 16)
  const tracksById = new Map(playableTracks.map(track => [track.id, track]))
  const midiTracks = new Map<string, number>()
  for (const track of playableTracks) {
    midi.addTrack(track.id)
    midiTracks.set(track.id, midi.tracks.length - 1)
  }
  const performance = buildPerformancePlan(recipe, scoreManifests(recipe, manifests))
  for (const { channel, track, program } of performance.channels) {
    const trackNumber = midiTracks.get(track.id)!
    const timbre = scoreTrackTimbre(track)
    midi.programChange(0, trackNumber, channel, program)
    midi.controllerChange(0, trackNumber, channel, 7, midi7(Math.min(1, track.gain * timbre.level)))
    midi.controllerChange(0, trackNumber, channel, 10, midi7((track.pan + 1) / 2))
    midi.controllerChange(0, trackNumber, channel, 11, midi7(scoreTrackExpression(track)))
    midi.controllerChange(0, trackNumber, channel, 74, midi7(scoreTrackBrightness(track)))
    midi.controllerChange(0, trackNumber, channel, 1, midi7(scoreTrackVibrato(track)))
    midi.controllerChange(0, trackNumber, channel, 64, 0)
    midi.controllerChange(0, trackNumber, channel, 91, midi7(0.18 + timbre.level * 0.18))
    midi.controllerChange(0, trackNumber, channel, 93, midi7(track.synth === "pad" ? 0.1 : 0.035))
    midi.pitchWheel(0, trackNumber, channel, 8_192)
  }

  if (recipe.version === 2) {
    const states = new Map(playableTracks.map(track => [track.id, {
      expression: scoreTrackExpression(track), brightness: scoreTrackBrightness(track),
      vibrato: scoreTrackVibrato(track), pitchBend: 0,
    }]))
    for (const control of recipe.plan.controls) {
      const trackNumber = midiTracks.get(control.trackId)
      const channels = performance.channelsForTrack(control.trackId)
      const state = states.get(control.trackId)
      if (trackNumber === undefined || !channels.length || !state) continue
      const scheduleController = (key: "expression" | "brightness" | "vibrato", controller: number, target: number | null) => {
        if (target === null) return
        const steps = control.rampSeconds > 0 ? Math.max(2, Math.min(24, Math.ceil(control.rampSeconds * 10))) : 1
        const from = state[key]
        for (let step = 1; step <= steps; step += 1) {
          const fraction = step / steps
          const at = ticks(control.timeSeconds + control.rampSeconds * fraction)
          const controllerValue = midi7(from + (target - from) * fraction)
          for (const channel of channels) midi.controllerChange(at, trackNumber, channel, controller, controllerValue)
        }
        state[key] = target
      }
      scheduleController("expression", 11, control.expression)
      scheduleController("brightness", 74, control.brightness)
      scheduleController("vibrato", 1, control.vibrato)
      if (control.pedal !== null) {
        for (const channel of channels) midi.controllerChange(ticks(control.timeSeconds), trackNumber, channel, 64, control.pedal ? 127 : 0)
      }
      if (control.pitchBend !== null) {
        const steps = control.rampSeconds > 0 ? Math.max(2, Math.min(24, Math.ceil(control.rampSeconds * 10))) : 1
        const from = state.pitchBend
        for (let step = 1; step <= steps; step += 1) {
          const fraction = step / steps
          const bend = from + (control.pitchBend - from) * fraction
          const pitchValue = Math.max(0, Math.min(16_383, Math.round(8_192 + bend / 2 * 8_191)))
          for (const channel of channels) midi.pitchWheel(ticks(control.timeSeconds + control.rampSeconds * fraction), trackNumber, channel, pitchValue)
        }
        state.pitchBend = control.pitchBend
      }
    }
  }

  for (let eventIndex = 0; eventIndex < recipe.plan.events.length; eventIndex += 1) {
    const event = recipe.plan.events[eventIndex]
    const track = tracksById.get(event.trackId)
    const trackNumber = midiTracks.get(event.trackId)
    const decision = performance.decisionForEvent(eventIndex)
    if (!track || trackNumber === undefined || !decision) continue
    const channel = performance.channelForEventIndex(eventIndex)
    if (channel === undefined) continue
    const articulation = decision.articulation
    const performed = performedEventValues(recipe, event, decision)
    const start = performed.startSeconds
    const duration = performed.durationSeconds * articulationDurationFactor(articulation)
    const velocity = midi7(Math.min(1, scoreVelocityGain(performed.velocity) * articulationVelocityFactor(articulation)))

    const samplerPlan = buildSamplerEventPlan(decision, decision.route)
    const setupAt = Math.max(0, start - 0.01)
    for (const action of spessaSynthActions(samplerPlan)) {
      if (action.type === "controller") {
        midi.controllerChange(ticks(setupAt), trackNumber, channel, action.cc, action.value)
      } else if (action.type === "keyswitch") {
        midi.noteOn(ticks(Math.max(0, setupAt - 0.015)), trackNumber, channel, action.note, action.velocity)
        midi.noteOff(ticks(setupAt), trackNumber, channel, action.note)
      }
    }

    const usesDedicatedTremolo = articulation === "tremolo" && decision.source === "dedicated-articulation"
    if (articulation === "tremolo" && !usesDedicatedTremolo) {
      const pulseSeconds = 0.12
      const pulses = Math.max(1, Math.ceil(duration / pulseSeconds))
      for (let pulse = 0; pulse < pulses; pulse += 1) {
        const pulseStart = start + pulse * pulseSeconds
        const pulseEnd = pulseStart + Math.min(0.085, Math.max(0.035, duration - pulse * pulseSeconds))
        for (const note of event.notes) {
          midi.noteOn(ticks(pulseStart), trackNumber, channel, note, velocity)
          midi.noteOff(ticks(pulseEnd), trackNumber, channel, note)
        }
      }
    } else {
      for (const note of event.notes) {
        midi.noteOn(ticks(start), trackNumber, channel, note, velocity)
        midi.noteOff(ticks(start + duration), trackNumber, channel, note)
      }
    }
  }
  midi.flush(true)
  return midi
}

function sampledQuality(recipe: LinearScoreRecipe, requested?: ScoreExportQuality) {
  const quality = requested ?? (recipe.version === 2 && recipe.plan.quality === "core" ? "preview" : recipe.version === 2 ? recipe.plan.quality : "studio")
  return quality === "preview"
    ? { quality, sampleRate: 32_000, bitDepth: 16 as const, tail: 2.5 }
    : { quality, sampleRate: 48_000, bitDepth: 24 as const, tail: quality === "master" ? 8 : 5 }
}

export async function renderTloqueScoreWithModuleToWav(
  value: unknown,
  packUrl: string,
  options: ScoreExportOptions = {},
  manifests?: readonly InstrumentManifest[],
): Promise<Blob> {
  const recipe = linearScoreRecipeFor(value)
  const selectedManifests = scoreManifests(recipe, manifests)
  const profile = sampledQuality(recipe, options.quality)
  options.onProgress?.(0.02)
  if (options.signal?.aborted) throw new DOMException("Exportación cancelada", "AbortError")
  const response = await fetchAudioResource(packUrl)
  if (!response.ok) throw new Error(`No se pudo cargar el módulo instrumental (${response.status})`)
  const soundBankBuffer = await response.arrayBuffer()
  options.onProgress?.(0.12)
  const midi = buildTloqueScoreMidi(recipe, selectedManifests)
  const durationSeconds = midi.duration + profile.tail
  const floatBytes = Math.ceil(durationSeconds * profile.sampleRate) * 2 * Float32Array.BYTES_PER_ELEMENT
  if (floatBytes > MAX_OFFLINE_FLOAT_BYTES) {
    throw new Error("La obra muestreada excede la memoria segura del navegador móvil; expórtala por movimientos")
  }
  const context = new OfflineAudioContext(2, Math.ceil(durationSeconds * profile.sampleRate), profile.sampleRate)
  await context.audioWorklet.addModule(processorUrl)
  const { WorkletSynthesizer } = await import("spessasynth_lib")
  const synth = new WorkletSynthesizer(context, { oneOutput: true })
  const mix = createSampledMixMaster(context, 1)
  synth.connect(mix.input)
  mix.output.connect(context.destination)
  await synth.startOfflineRender({
    midiSequence: midi,
    loopCount: 0,
    soundBankList: [{ bankOffset: 0, soundBankBuffer }],
  })
  options.onProgress?.(0.2)
  const rendered = await context.startRendering()
  options.onProgress?.(0.82)
  options.onAnalysis?.(analyzeAudioBuffer(rendered))
  synth.destroy()
  mix.disconnect()
  return encodeAudioBufferToWav(rendered, profile.bitDepth, progress => options.onProgress?.(0.82 + progress * 0.18))
}
