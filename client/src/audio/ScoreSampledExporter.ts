import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url"
import { MIDIBuilder } from "spessasynth_core"
import { linearScoreRecipeFor, type LinearScoreRecipe } from "@shared/audio"
import { fetchAudioResource } from "./AudioResourceCache"
import { encodeAudioBufferToWav, type ScoreExportOptions, type ScoreExportQuality } from "./ScoreExporter"
import {
  articulationDurationFactor, articulationVelocityFactor, scoreSampledChannelPlan, scoreSampledProgram,
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

export function buildTloqueScoreMidi(value: unknown): MIDIBuilder {
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
  const sampledPlan = scoreSampledChannelPlan(playableTracks, recipe.plan.events)
  for (const { channel, track, program } of sampledPlan.channels) {
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
      const channels = sampledPlan.channelsForTrack(control.trackId)
      const state = states.get(control.trackId)
      if (trackNumber === undefined || !channels.length || !state) continue
      const scheduleController = (key: "expression" | "brightness" | "vibrato", controller: number, target: number | null) => {
        if (target === null) return
        const steps = control.rampSeconds > 0 ? Math.max(2, Math.min(24, Math.ceil(control.rampSeconds * 10))) : 1
        const from = state[key]
        for (let step = 1; step <= steps; step += 1) {
          const fraction = step / steps
          const at = ticks(control.timeSeconds + control.rampSeconds * fraction)
          const value = midi7(from + (target - from) * fraction)
          for (const channel of channels) midi.controllerChange(at, trackNumber, channel, controller, value)
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
          const value = Math.max(0, Math.min(16_383, Math.round(8_192 + bend / 2 * 8_191)))
          for (const channel of channels) midi.pitchWheel(ticks(control.timeSeconds + control.rampSeconds * fraction), trackNumber, channel, value)
        }
        state.pitchBend = control.pitchBend
      }
    }
  }

  const beatSeconds = 60 / recipe.plan.bpm
  for (const event of recipe.plan.events) {
    const track = tracksById.get(event.trackId)
    const trackNumber = midiTracks.get(event.trackId)
    if (!track || trackNumber === undefined) continue
    const articulation = "articulation" in event ? event.articulation : "normal"
    const channel = sampledPlan.channelForEvent(event.trackId, articulation)
    if (channel === undefined) continue
    const start = "timeSeconds" in event ? event.timeSeconds : event.timeBeats * beatSeconds
    const duration = ("durationSeconds" in event ? event.durationSeconds : event.durationBeats * beatSeconds)
      * articulationDurationFactor(articulation)
    const velocity = midi7(Math.min(1, scoreVelocityGain(event.velocity) * articulationVelocityFactor(articulation)))
    const usesDedicatedTremolo = articulation === "tremolo"
      && scoreSampledProgram(track, articulation) !== scoreSampledProgram(track)
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
): Promise<Blob> {
  const recipe = linearScoreRecipeFor(value)
  const profile = sampledQuality(recipe, options.quality)
  options.onProgress?.(0.02)
  if (options.signal?.aborted) throw new DOMException("Exportación cancelada", "AbortError")
  const response = await fetchAudioResource(packUrl)
  if (!response.ok) throw new Error(`No se pudo cargar el módulo instrumental (${response.status})`)
  const soundBankBuffer = await response.arrayBuffer()
  options.onProgress?.(0.12)
  const midi = buildTloqueScoreMidi(recipe)
  const durationSeconds = midi.duration + profile.tail
  const floatBytes = Math.ceil(durationSeconds * profile.sampleRate) * 2 * Float32Array.BYTES_PER_ELEMENT
  if (floatBytes > MAX_OFFLINE_FLOAT_BYTES) {
    throw new Error("La obra muestreada excede la memoria segura del navegador móvil; expórtala por movimientos")
  }
  const context = new OfflineAudioContext(2, Math.ceil(durationSeconds * profile.sampleRate), profile.sampleRate)
  await context.audioWorklet.addModule(processorUrl)
  const { WorkletSynthesizer } = await import("spessasynth_lib")
  const synth = new WorkletSynthesizer(context, { oneOutput: true })
  synth.connect(context.destination)
  await synth.startOfflineRender({
    midiSequence: midi,
    loopCount: 0,
    soundBankList: [{ bankOffset: 0, soundBankBuffer }],
  })
  options.onProgress?.(0.2)
  const rendered = await context.startRendering()
  options.onProgress?.(0.82)
  synth.destroy()
  return encodeAudioBufferToWav(rendered, profile.bitDepth, progress => options.onProgress?.(0.82 + progress * 0.18))
}
