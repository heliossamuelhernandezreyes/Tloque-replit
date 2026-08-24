import type { LinearScoreRecipe } from "@shared/audio"
import { manifestsForModule, type InstrumentManifest, type TloqueArticulation } from "@shared/instrument-manifest"
import type { TloqueMicPosition, TloqueMute, TloqueSamplePack, TloqueSampleZone, TloqueVibratoColour } from "@shared/native-sample-pack"
import { physicalRecordedTimbre, resolveRecordedTimbre } from "@shared/recorded-timbre"
import type { ScoreTimbre } from "@shared/tloque-score-v2"
import { selectNativeSampleZone } from "./NativeSamplePackEngine"
import { buildPerformancePlan } from "./PerformanceEngine"
import { articulationDurationFactor, articulationVelocityFactor, scoreTrackExpression, scoreTrackTimbre, scoreVelocityGain } from "./ScoreAudioMath"

export interface NativeSampleTrackPlan { id: string; gain: number; pan: number; micPosition: TloqueMicPosition }
export interface NativeSampleControlPlan { trackId: string; timeSeconds: number; rampSeconds: number; gain: number }
export interface NativeSampleVoicePlan {
  trackId: string
  articulation: TloqueArticulation
  timbre: ScoreTimbre
  resolvedTimbre: Exclude<ScoreTimbre, "natural">
  note: number
  velocity: number
  roundRobin: number
  vibrato: boolean
  vibratoColour: TloqueVibratoColour
  mute: TloqueMute
  micPosition: TloqueMicPosition
  startSeconds: number
  durationSeconds: number
  zoneId: string
  sampleUrl: string
  playbackRate: number
  sampleGain: number
  oneShot: boolean
}
export interface NativeSampleAuxiliaryVoicePlan {
  kind: "release" | "legato-transition"
  trackId: string
  articulation: TloqueArticulation
  note: number
  velocity: number
  micPosition: TloqueMicPosition
  startSeconds: number
  durationSeconds: number
  zoneId: string
  sampleUrl: string
  playbackRate: number
  sampleGain: number
  transitionFromMidi?: number
}
export interface NativeSampleScorePlan {
  tracks: readonly NativeSampleTrackPlan[]
  controls: readonly NativeSampleControlPlan[]
  voices: readonly NativeSampleVoicePlan[]
  auxiliaryVoices: readonly NativeSampleAuxiliaryVoicePlan[]
  zones: readonly TloqueSampleZone[]
  totalSeconds: number
}
export interface NativeSampleScorePlanOptions {
  manifests?: readonly InstrumentManifest[]
  micPositionByTrack?: Readonly<Record<string, TloqueMicPosition>>
}

export function buildNativeSampleScorePlan(recipe: LinearScoreRecipe, pack: TloqueSamplePack, options: NativeSampleScorePlanOptions = {}): NativeSampleScorePlan {
  if (recipe.version !== 2 || recipe.plan.moduleId === "builtin") throw new Error("La partitura no solicita un paquete nativo")

  const performance = buildPerformancePlan(recipe, options.manifests ?? manifestsForModule(pack.instrumentManifestId))
  const playableTracks = recipe.plan.tracks.slice(0, 16)
  const trackById = new Map(playableTracks.map(track => [track.id, track]))
  const micForTrack = (trackId: string): TloqueMicPosition => options.micPositionByTrack?.[trackId] ?? pack.defaultMicPosition ?? pack.micPositions?.[0] ?? "default"
  const availableMics = new Set(pack.micPositions ?? [pack.defaultMicPosition ?? "default"])
  for (const track of playableTracks) {
    const requested = micForTrack(track.id)
    if (!availableMics.has(requested)) throw new Error(`El módulo ${pack.instrumentManifestId} no contiene mic=${requested}`)
  }
  const tracks: NativeSampleTrackPlan[] = playableTracks.map(track => {
    const timbre = scoreTrackTimbre(track)
    return { id: track.id, gain: Math.max(0, Math.min(1.5, track.gain * timbre.level * scoreTrackExpression(track))), pan: Math.max(-1, Math.min(1, track.pan)), micPosition: micForTrack(track.id) }
  })

  const controls: NativeSampleControlPlan[] = []
  for (const control of recipe.plan.controls) {
    if (control.expression === null) continue
    const track = trackById.get(control.trackId); if (!track) continue
    const timbre = scoreTrackTimbre(track)
    controls.push({ trackId: control.trackId, timeSeconds: control.timeSeconds, rampSeconds: Math.max(0, control.rampSeconds), gain: Math.max(0, Math.min(1.5, track.gain * timbre.level * control.expression)) })
  }

  const voices: NativeSampleVoicePlan[] = []
  const auxiliaryVoices: NativeSampleAuxiliaryVoicePlan[] = []
  const zones = new Map<string, TloqueSampleZone>()
  for (let eventIndex = 0; eventIndex < recipe.plan.events.length; eventIndex += 1) {
    const event = recipe.plan.events[eventIndex]
    const decision = performance.decisionForEvent(eventIndex)
    const track = trackById.get(event.trackId)
    if (!decision || !track) continue
    const oneShot = track.instrument === "percussion.orchestral-kit"
    const requestedTimbre = event.timbre ?? track.timbre ?? "natural"
    const naturalUsesNeutralAttack = requestedTimbre === "natural" && decision.articulation !== "normal" && decision.articulation !== "legato"
    const resolvedTimbre = naturalUsesNeutralAttack ? "non-vibrato" : resolveRecordedTimbre(pack.instrumentManifestId, requestedTimbre)
    const physical = physicalRecordedTimbre(resolvedTimbre)
    const performedVelocity = Math.max(0.01, Math.min(1, event.velocity * decision.velocityScale))
    const velocity = Math.round(Math.min(1, scoreVelocityGain(performedVelocity) * articulationVelocityFactor(decision.articulation)) * 127)
    const durationSeconds = Math.max(0.01, event.durationSeconds * articulationDurationFactor(decision.articulation) * decision.durationScale)
    const startSeconds = Math.max(0, event.timeSeconds + decision.startOffsetSeconds)
    const micPosition = micForTrack(track.id)
    for (const note of event.notes) {
      const selection = selectNativeSampleZone(pack, decision.articulation, note, velocity, decision.roundRobin, { ...physical, trigger: "attack", micPosition })
      if (!selection) throw new Error(`El módulo ${pack.instrumentManifestId} no contiene timbre=${resolvedTimbre}, mic=${micPosition} para ${track.instrument} en MIDI ${note}`)
      zones.set(selection.zone.id, selection.zone)
      voices.push({
        trackId: event.trackId,
        articulation: decision.articulation,
        timbre: requestedTimbre,
        resolvedTimbre,
        note,
        velocity,
        roundRobin: decision.roundRobin,
        vibrato: physical.vibratoColour !== "none",
        vibratoColour: physical.vibratoColour,
        mute: physical.mute,
        micPosition,
        startSeconds,
        durationSeconds,
        zoneId: selection.zone.id,
        sampleUrl: selection.zone.sampleUrl,
        playbackRate: selection.playbackRate,
        sampleGain: selection.gain,
        oneShot,
      })

      if (decision.trueLegato && decision.previousNotes?.length === 1) {
        const from = decision.previousNotes[0]
        const transition = selectNativeSampleZone(pack, "legato", note, velocity, decision.roundRobin, {
          ...physical,
          trigger: "legato-transition",
          micPosition,
          transitionFromMidi: from,
          transitionToMidi: note,
        })
        if (!transition) throw new Error(`El módulo ${pack.instrumentManifestId} declara true-legato pero no contiene transición ${from}->${note} en mic=${micPosition}`)
        zones.set(transition.zone.id, transition.zone)
        auxiliaryVoices.push({
          kind: "legato-transition",
          trackId: event.trackId,
          articulation: "legato",
          note,
          velocity,
          micPosition,
          startSeconds,
          durationSeconds: Math.min(1.5, durationSeconds),
          zoneId: transition.zone.id,
          sampleUrl: transition.zone.sampleUrl,
          playbackRate: transition.playbackRate,
          sampleGain: transition.gain,
          transitionFromMidi: from,
        })
      }

      if (decision.releaseSamples) {
        const release = selectNativeSampleZone(pack, decision.articulation, note, velocity, decision.roundRobin, { ...physical, trigger: "release", micPosition })
        if (!release) throw new Error(`El módulo ${pack.instrumentManifestId} declara release-samples pero no contiene release para MIDI ${note} en mic=${micPosition}`)
        zones.set(release.zone.id, release.zone)
        auxiliaryVoices.push({
          kind: "release",
          trackId: event.trackId,
          articulation: decision.articulation,
          note,
          velocity,
          micPosition,
          startSeconds: startSeconds + durationSeconds,
          durationSeconds: 8,
          zoneId: release.zone.id,
          sampleUrl: release.zone.sampleUrl,
          playbackRate: release.playbackRate,
          sampleGain: release.gain,
        })
      }
    }
  }

  return { tracks, controls, voices, auxiliaryVoices, zones: [...zones.values()], totalSeconds: recipe.plan.totalSeconds }
}
