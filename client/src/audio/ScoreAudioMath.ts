import type { LinearScoreRecipe, LinearScoreTrack } from "@shared/audio"
import { baseProgramForTrack, buildPerformanceRoutingPlan, resolvePerformanceRoute } from "./PerformanceEngine"

export const TLOQUE_SCORE_AUDIO_PROFILE = "tloque-score-audio-v7-universal-performance" as const

export interface ScoreEnvelope {
  attack: number
  decay: number
  sustain: number
  release: number
}

export interface ScoreTimbreProfile {
  filterHz: number
  filterQ: number
  level: number
}

export interface ScoreRenderProfile {
  polyphonyBudget: number
  reverbDecay: number
  reverbWet: number
  chorusWet: number
  stereoWidth: number
  makeup: number
  masterDrive: number
}

export interface ScoreExpressionState {
  expression: number
  brightness: number
  vibrato: number
  pedal: boolean
  pitchBend: number
}

export interface ScoreSampledChannel {
  channel: number
  track: LinearScoreTrack
  program: number
}

export interface ScoreSampledChannelPlan {
  channels: ScoreSampledChannel[]
  channelsForTrack(trackId: string): number[]
  channelForEvent(trackId: string, articulation?: string): number | undefined
}

export function midiNoteToFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12)
}

export function midiNotesToFrequencies(notes: readonly number[]): number[] {
  return notes.map(midiNoteToFrequency)
}

export function articulationDurationFactor(articulation = "normal"): number {
  if (articulation === "spiccato") return 0.32
  if (articulation === "pizzicato") return 0.48
  if (articulation === "tremolo") return 0.96
  if (articulation === "staccato") return 0.55
  if (articulation === "legato") return 1.08
  if (articulation === "harmonic") return 0.92
  return 0.96
}

export function articulationVelocityFactor(articulation = "normal"): number {
  if (articulation === "accent") return 1.18
  if (articulation === "spiccato") return 1.08
  if (articulation === "harmonic") return 0.72
  if (articulation === "pizzicato") return 0.94
  if (articulation === "tremolo") return 0.88
  if (articulation === "tenuto") return 1.03
  return 1
}

export function scoreVelocityGain(velocity: number): number {
  return Math.max(0, Math.min(1, velocity)) ** 0.8
}

export function scoreTrackEnvelope(track: LinearScoreTrack): ScoreEnvelope {
  const timing = "attack" in track
    ? { attack: track.attack, release: track.release }
    : track.synth === "pad" ? { attack: 1.1, release: 3.8 }
      : track.synth === "bell" ? { attack: 0.008, release: 2.4 }
        : track.synth === "pluck" ? { attack: 0.003, release: 0.7 }
          : track.synth === "bass" ? { attack: 0.02, release: 1.2 }
            : { attack: 0.12, release: 1.8 }
  if (track.synth === "pad") return { ...timing, decay: 0.9, sustain: 0.78 }
  if (track.synth === "bell") return { ...timing, decay: 1.35, sustain: 0.035 }
  if (track.synth === "pluck") return { ...timing, decay: 0.28, sustain: 0.06 }
  if (track.synth === "bass") return { ...timing, decay: 0.38, sustain: 0.62 }
  return { ...timing, decay: 0.55, sustain: 0.42 }
}

export function scoreTrackTimbre(track: LinearScoreTrack): ScoreTimbreProfile {
  if (track.synth === "pad") return { filterHz: 5_200, filterQ: 0.55, level: 0.98 }
  if (track.synth === "bell") return { filterHz: 7_600, filterQ: 0.7, level: 0.9 }
  if (track.synth === "pluck") return { filterHz: 6_400, filterQ: 0.8, level: 1 }
  if (track.synth === "bass") return { filterHz: 1_500, filterQ: 0.65, level: 0.82 }
  return { filterHz: 6_000, filterQ: 0.6, level: 1.08 }
}

export function scoreTrackExpression(track: LinearScoreTrack): number {
  return "expression" in track ? track.expression : 1
}

export function scoreTrackBrightness(track: LinearScoreTrack): number {
  return "brightness" in track ? track.brightness : 0.5
}

export function scoreTrackVibrato(track: LinearScoreTrack): number {
  return "vibrato" in track ? track.vibrato : 0
}

export function scoreTrackMidiProgram(track: LinearScoreTrack): number {
  return baseProgramForTrack(track)
}

/** Compatibility facade: sampled routing is now decided by PerformanceEngine. */
export function scoreSampledProgram(track: LinearScoreTrack, articulation = "normal"): number {
  return resolvePerformanceRoute(track, articulation as any).program
}

/**
 * Live playback and sampled export both call this function, which delegates to
 * the same manifest-aware routing plan. Existing GM behavior is preserved.
 */
export function scoreSampledChannelPlan(
  tracks: readonly LinearScoreTrack[],
  events: readonly { trackId: string; articulation?: string }[],
  maxChannels = 16,
): ScoreSampledChannelPlan {
  return buildPerformanceRoutingPlan(tracks, events, undefined, maxChannels)
}

export function scoreBrightnessFrequency(baseHz: number, brightness: number): number {
  return Math.max(180, Math.min(14_000, baseHz * (0.34 + Math.max(0, Math.min(1, brightness)) * 1.32)))
}

function controlsFor(recipe: LinearScoreRecipe, trackId: string) {
  return recipe.version === 2
    ? recipe.plan.controls.filter(control => control.trackId === trackId)
    : []
}

function automatedNumber(
  recipe: LinearScoreRecipe,
  trackId: string,
  timeSeconds: number,
  key: "expression" | "brightness" | "vibrato" | "pitchBend",
  initial: number,
) {
  let startValue = initial
  let targetValue = initial
  let startTime = 0
  let endTime = 0
  for (const control of controlsFor(recipe, trackId)) {
    const next = control[key]
    if (next === null || control.timeSeconds > timeSeconds) continue
    const progress = endTime <= startTime
      ? 1
      : Math.max(0, Math.min(1, (control.timeSeconds - startTime) / (endTime - startTime)))
    const valueAtControl = startValue + (targetValue - startValue) * progress
    startValue = valueAtControl
    targetValue = next
    startTime = control.timeSeconds
    endTime = control.timeSeconds + control.rampSeconds
  }
  if (timeSeconds >= endTime || endTime <= startTime) return targetValue
  const progress = Math.max(0, Math.min(1, (timeSeconds - startTime) / (endTime - startTime)))
  return startValue + (targetValue - startValue) * progress
}

export function scoreExpressionStateAt(recipe: LinearScoreRecipe, track: LinearScoreTrack, timeSeconds: number): ScoreExpressionState {
  let pedal = false
  for (const control of controlsFor(recipe, track.id)) {
    if (control.timeSeconds > timeSeconds) break
    if (control.pedal !== null) pedal = control.pedal
  }
  return {
    expression: automatedNumber(recipe, track.id, timeSeconds, "expression", scoreTrackExpression(track)),
    brightness: automatedNumber(recipe, track.id, timeSeconds, "brightness", scoreTrackBrightness(track)),
    vibrato: automatedNumber(recipe, track.id, timeSeconds, "vibrato", scoreTrackVibrato(track)),
    pitchBend: automatedNumber(recipe, track.id, timeSeconds, "pitchBend", 0),
    pedal,
  }
}

export function scorePedalReleaseTime(recipe: LinearScoreRecipe, trackId: string, noteEndSeconds: number): number {
  if (recipe.version !== 2) return noteEndSeconds
  const track = recipe.plan.tracks.find(item => item.id === trackId)
  if (!track || !scoreExpressionStateAt(recipe, track, noteEndSeconds).pedal) return noteEndSeconds
  const release = recipe.plan.controls.find(control =>
    control.trackId === trackId && control.timeSeconds > noteEndSeconds && control.pedal === false,
  )
  return Math.min(release?.timeSeconds ?? recipe.plan.totalSeconds, noteEndSeconds + 12)
}

export function scoreRenderProfile(quality: "core" | "studio" | "master" = "studio"): ScoreRenderProfile {
  if (quality === "core") {
    return { polyphonyBudget: 32, reverbDecay: 2.4, reverbWet: 0.1, chorusWet: 0.04, stereoWidth: 0.56, makeup: 1.18, masterDrive: 1.46 }
  }
  if (quality === "master") {
    return { polyphonyBudget: 128, reverbDecay: 5.8, reverbWet: 0.22, chorusWet: 0.12, stereoWidth: 0.75, makeup: 1.42, masterDrive: 1.82 }
  }
  return { polyphonyBudget: 64, reverbDecay: 3.8, reverbWet: 0.17, chorusWet: 0.09, stereoWidth: 0.65, makeup: 1.3, masterDrive: 1.64 }
}

export function scoreMonitorVolume(
  master: number,
  cueVolume: number,
  duckFactor: number,
  narrativeGain: number,
  reference: boolean,
): number {
  const programGain = reference ? cueVolume : master * cueVolume * duckFactor * narrativeGain
  return Math.max(0, Math.min(1, programGain))
}
