import type { LinearScoreRecipe } from "@shared/audio"
import { manifestsForModule, type TloqueArticulation } from "@shared/instrument-manifest"
import type { TloqueMute, TloqueSamplePack, TloqueSampleZone } from "@shared/native-sample-pack"
import { selectNativeSampleZone } from "./NativeSamplePackEngine"
import { buildPerformancePlan } from "./PerformanceEngine"
import {
  articulationDurationFactor,
  articulationVelocityFactor,
  scoreTrackExpression,
  scoreTrackTimbre,
  scoreVelocityGain,
} from "./ScoreAudioMath"

export interface NativeSampleTrackPlan {
  id: string
  gain: number
  pan: number
}

export interface NativeSampleControlPlan {
  trackId: string
  timeSeconds: number
  rampSeconds: number
  gain: number
}

export interface NativeSampleVoicePlan {
  trackId: string
  articulation: TloqueArticulation
  note: number
  velocity: number
  roundRobin: number
  vibrato: boolean
  mute: TloqueMute
  startSeconds: number
  durationSeconds: number
  sampleUrl?: string
  playbackRate: number
  /** Unpitched percussion hits are one-shots: event duration is rhythmic, not a hard sample cutoff. */
  oneShot: boolean
}

export interface NativeSampleScorePlan {
  tracks: readonly NativeSampleTrackPlan[]
  controls: readonly NativeSampleControlPlan[]
  voices: readonly NativeSampleVoicePlan[]
  zones: readonly TloqueSampleZone[]
  totalSeconds: number
}

function muteForInstrument(instrument: string): TloqueMute {
  if (instrument.endsWith(".straight-mute")) return "straight"
  if (instrument.endsWith(".harmon-mute")) return "harmon"
  if (instrument.endsWith(".mute")) return "mute"
  return "none"
}

function vibratoAt(recipe: Extract<LinearScoreRecipe, { version: 2 }>, trackId: string, initial: number, timeSeconds: number) {
  let value = initial
  let ramp: { from: number; to: number; start: number; end: number } | null = null
  const valueAt = (time: number) => {
    if (!ramp) return value
    if (time >= ramp.end) return ramp.to
    if (time <= ramp.start || ramp.end <= ramp.start) return ramp.from
    const phase = (time - ramp.start) / (ramp.end - ramp.start)
    return ramp.from + (ramp.to - ramp.from) * phase
  }
  for (const control of recipe.plan.controls) {
    if (control.trackId !== trackId || control.vibrato === null || control.timeSeconds > timeSeconds) continue
    value = valueAt(control.timeSeconds)
    ramp = control.rampSeconds > 0
      ? { from: value, to: control.vibrato, start: control.timeSeconds, end: control.timeSeconds + control.rampSeconds }
      : null
    if (!ramp) value = control.vibrato
  }
  return valueAt(timeSeconds)
}

/**
 * Compiles renderer-neutral acoustic decisions once. Live playback and WAV
 * export consume the same selected articulation, velocity, RR and recorded
 * timbre dimensions so they cannot silently diverge.
 */
export function buildNativeSampleScorePlan(recipe: LinearScoreRecipe, pack: TloqueSamplePack): NativeSampleScorePlan {
  if (recipe.version !== 2 || recipe.plan.moduleId === "builtin") {
    throw new Error("La partitura no solicita un paquete nativo")
  }

  const performance = buildPerformancePlan(recipe, manifestsForModule(pack.instrumentManifestId))
  const playableTracks = recipe.plan.tracks.slice(0, 16)
  const trackById = new Map(playableTracks.map(track => [track.id, track]))
  const tracks: NativeSampleTrackPlan[] = playableTracks.map(track => {
    const timbre = scoreTrackTimbre(track)
    return {
      id: track.id,
      gain: Math.max(0, Math.min(1.5, track.gain * timbre.level * scoreTrackExpression(track))),
      pan: Math.max(-1, Math.min(1, track.pan)),
    }
  })

  const controls: NativeSampleControlPlan[] = []
  for (const control of recipe.plan.controls) {
    if (control.expression === null) continue
    const track = trackById.get(control.trackId)
    if (!track) continue
    const timbre = scoreTrackTimbre(track)
    controls.push({
      trackId: control.trackId,
      timeSeconds: control.timeSeconds,
      rampSeconds: Math.max(0, control.rampSeconds),
      gain: Math.max(0, Math.min(1.5, track.gain * timbre.level * control.expression)),
    })
  }

  const voices: NativeSampleVoicePlan[] = []
  const zones = new Map<string, TloqueSampleZone>()
  for (let eventIndex = 0; eventIndex < recipe.plan.events.length; eventIndex += 1) {
    const event = recipe.plan.events[eventIndex]
    const decision = performance.decisionForEvent(eventIndex)
    const track = trackById.get(event.trackId)
    if (!decision || !track) continue
    const oneShot = track.instrument === "percussion.orchestral-kit"
    const vibrato = vibratoAt(recipe, track.id, track.vibrato, event.timeSeconds) > 0.05
    const mute = muteForInstrument(track.instrument)
    const velocity = Math.round(
      Math.min(1, scoreVelocityGain(event.velocity) * articulationVelocityFactor(decision.articulation)) * 127,
    )
    const durationSeconds = event.durationSeconds * articulationDurationFactor(decision.articulation)
    for (const note of event.notes) {
      const selection = selectNativeSampleZone(
        pack,
        decision.articulation,
        note,
        velocity,
        decision.roundRobin,
        { vibrato, mute },
      )
      if (selection) zones.set(selection.zone.id, selection.zone)
      voices.push({
        trackId: event.trackId,
        articulation: decision.articulation,
        note,
        velocity,
        roundRobin: decision.roundRobin,
        vibrato,
        mute,
        startSeconds: event.timeSeconds,
        durationSeconds,
        sampleUrl: selection?.zone.sampleUrl,
        playbackRate: selection?.playbackRate ?? 1,
        oneShot,
      })
    }
  }

  return {
    tracks,
    controls,
    voices,
    zones: [...zones.values()],
    totalSeconds: recipe.plan.totalSeconds,
  }
}
