import type { NativeHybridSource } from "@shared/native-hybrid-source"
import {
  boundedHybridOverlayGain,
  type NativeHybridOverlayPerformance,
  type NativeHybridPerformanceDecision,
} from "@shared/native-hybrid-performance"
import { boundedHybridCalibrationTuning, type HybridCalibrationTuning } from "@shared/native-hybrid-tuning"
import type { LinearScoreRecipeV2, LinearScoreTrackV2 } from "@shared/tloque-score-v2"
import {
  orchestralStringProfileFor,
  scheduleOrchestralStringPhrase,
  type OrchestralPhysicalStringEvent,
  type OrchestralStringRenderTuning,
} from "./OrchestralStringVoice"
import { reserveOrchestralSynthSources } from "./OrchestralSynthVoice"

type LinearScoreEventV2 = LinearScoreRecipeV2["plan"]["events"][number]
type LinearScoreControlV2 = LinearScoreRecipeV2["plan"]["controls"][number]
type TunableHybridSource = NativeHybridSource & { calibrationTuning?: HybridCalibrationTuning }

export const BOWED_STRING_OVERLAY_VERSION = "bowed-string-overlay-v2-continuous-waveguide" as const

export interface BowedStringOverlayOptions {
  startAt: number
  event: LinearScoreEventV2
  track: LinearScoreTrackV2
  midi: number
  destination: AudioNode
  controls?: readonly LinearScoreControlV2[]
  legatoFromPrevious?: boolean
  calibrationTuning?: HybridCalibrationTuning
  performance?: NativeHybridOverlayPerformance
}

export interface HybridBowedStringPhraseOptions {
  startAt: number
  decisions: readonly NativeHybridPerformanceDecision[]
  track: LinearScoreTrackV2
  destination: AudioNode
  controls?: readonly LinearScoreControlV2[]
  calibrationTuning?: HybridCalibrationTuning
  reserve?: (start: number, end: number, cost: number) => boolean
}

type PhraseEntry = {
  event: LinearScoreEventV2
  midi: number
  performance?: NativeHybridOverlayPerformance
  legatoFromPrevious: boolean
  transitionFromMidi: number | null
}

function stringRenderTuning(tuning: HybridCalibrationTuning): OrchestralStringRenderTuning {
  return {
    feedbackScale: tuning.feedbackScale,
    dampingScale: tuning.dampingScale,
    textureScale: tuning.textureScale,
    bodyScale: tuning.bodyScale,
    releaseScale: tuning.decayScale,
  }
}

function physicalLevel(
  source: NativeHybridSource,
  tuning: HybridCalibrationTuning,
  performance: NativeHybridOverlayPerformance | undefined,
) {
  // A continuous string does not need the old per-note legato excitation cut:
  // there is no new physical attack at the boundary. The sample-dominance wet
  // ceiling and simultaneous-voice normalization still apply unchanged.
  const continuousPerformance = performance ? { ...performance, excitationScale: 1 } : undefined
  return boundedHybridOverlayGain(source, source.wet * tuning.wetScale, continuousPerformance)
}

function scheduleEntries(
  context: BaseAudioContext,
  source: NativeHybridSource,
  options: {
    startAt: number
    entries: readonly PhraseEntry[]
    track: LinearScoreTrackV2
    destination: AudioNode
    controls: readonly LinearScoreControlV2[]
    calibrationTuning?: HybridCalibrationTuning
    reserve?: (start: number, end: number, cost: number) => boolean
  },
) {
  if (source.physicalLayer !== "bowed-string-resonator" || source.instrumentId !== options.track.instrument || !options.entries.length) return null
  const tuning = boundedHybridCalibrationTuning(options.calibrationTuning ?? (source as TunableHybridSource).calibrationTuning)
  const events: OrchestralPhysicalStringEvent[] = options.entries.map(entry => ({
    ...entry.event,
    notes: [entry.midi],
    legatoFromPrevious: entry.legatoFromPrevious,
    ...(entry.transitionFromMidi === null ? {} : { transitionFromMidi: entry.transitionFromMidi }),
    physicalLevel: physicalLevel(source, tuning, entry.performance),
  }))
  const accepted = scheduleOrchestralStringPhrase(
    context,
    options.destination,
    options.startAt,
    events,
    options.track,
    1,
    options.controls,
    options.reserve ?? ((start, end, cost) => reserveOrchestralSynthSources(context, start, end, cost)),
    stringRenderTuning(tuning),
  )
  if (accepted !== events.length) return null
  const last = events.at(-1)!
  const release = orchestralStringProfileFor(options.track.instrument).releaseSeconds * tuning.decayScale
  return { endSeconds: last.timeSeconds + last.durationSeconds + release, scheduledEvents: accepted }
}

/** Schedule one uninterrupted physical string beneath the recorded phrase. */
export function scheduleHybridBowedStringPhrase(
  context: BaseAudioContext,
  source: NativeHybridSource,
  options: HybridBowedStringPhraseOptions,
) {
  if (options.decisions.some(decision => decision.source.instrumentId !== source.instrumentId || decision.midis.length !== 1)) return null
  return scheduleEntries(context, source, {
    ...options,
    controls: options.controls ?? [],
    entries: options.decisions.map(decision => ({
      event: decision.event,
      midi: decision.midis[0],
      performance: decision,
      legatoFromPrevious: decision.transition === "connected-legato",
      transitionFromMidi: decision.transitionFromMidi,
    })),
  })
}

/** Single-event compatibility route. Chords receive one bounded string per MIDI;
 * monophonic production playback uses scheduleHybridBowedStringPhrase instead. */
export function scheduleBowedStringOverlay(
  context: BaseAudioContext,
  source: NativeHybridSource,
  options: BowedStringOverlayOptions,
) {
  if (options.midi < source.midiMin || options.midi > source.midiMax) return null
  return scheduleEntries(context, source, {
    startAt: options.startAt,
    entries: [{
      event: options.event,
      midi: options.midi,
      performance: options.performance,
      legatoFromPrevious: options.legatoFromPrevious ?? false,
      transitionFromMidi: null,
    }],
    track: options.track,
    destination: options.destination,
    controls: options.controls ?? [],
    calibrationTuning: options.calibrationTuning,
  })
}
