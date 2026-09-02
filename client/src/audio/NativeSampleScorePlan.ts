import type { LinearScoreRecipe } from "@shared/audio"
import { manifestsForModule, type InstrumentManifest, type TloqueArticulation } from "@shared/instrument-manifest"
import type { TloqueMicPosition, TloqueMute, TloqueSamplePack, TloqueSampleZone, TloqueVibratoColour } from "@shared/native-sample-pack"
import { physicalRecordedTimbre, recordedTimbreProfileFor, resolveRecordedTimbre, type ExplicitRecordedTimbre } from "@shared/recorded-timbre"
import type { LinearScoreRecipeV2, ScoreTimbre } from "@shared/tloque-score-v2"
import { selectNativeSampleZone } from "./NativeSamplePackEngine"
import { selectNativeSampleVelocityBlend } from "./NativeSampleVelocityBlend"
import { buildPerformancePlan } from "./PerformanceEngine"
import { orchestralNoteExpression, type OrchestralNoteExpression } from "./OrchestralExpression"
import { orchestralContinuousDynamics, type OrchestralContinuousDynamics } from "./OrchestralDynamics"
import { buildNativeRecipeIndex, nativeControlValueAt } from "./NativeRecipeIndex"
import { articulationDurationFactor, articulationVelocityFactor, scoreTrackExpression, scoreTrackTimbre, scoreVelocityGain } from "./ScoreAudioMath"

export interface NativeSampleTrackPlan { id: string; gain: number; pan: number; micPosition: TloqueMicPosition; brightness: number }
export interface NativeSampleControlPlan { trackId: string; timeSeconds: number; rampSeconds: number; gain: number | null; brightness: number | null }
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
  fadeInSeconds: number
  expression?: OrchestralNoteExpression
  dynamics?: OrchestralContinuousDynamics
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
  fadeOutSeconds: number
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

export function trueLegatoCrossfadeSeconds(noteDurationSeconds: number) {
  return Math.max(0.025, Math.min(0.12, noteDurationSeconds * 0.18))
}

const NATURAL_OPEN_TIMBRES: readonly ExplicitRecordedTimbre[] = ["non-vibrato", "vibrato", "expression-vibrato"]

function naturalTimbreCandidates(moduleId: string, vibratoAmount: number): readonly ExplicitRecordedTimbre[] {
  const profile = recordedTimbreProfileFor(moduleId)
  const preferred = resolveRecordedTimbre(moduleId, "natural")
  const available = profile?.availableTimbres.filter(timbre => NATURAL_OPEN_TIMBRES.includes(timbre)) ?? NATURAL_OPEN_TIMBRES
  const desired: ExplicitRecordedTimbre = vibratoAmount < 0.18
    ? "non-vibrato"
    : vibratoAmount < 0.72
      ? "vibrato"
      : "expression-vibrato"
  return [...new Set([desired, preferred, ...available])]
}

function timbreCandidates(moduleId: string, requested: ScoreTimbre, vibratoAmount: number): readonly ExplicitRecordedTimbre[] {
  return requested === "natural" ? naturalTimbreCandidates(moduleId, vibratoAmount) : [resolveRecordedTimbre(moduleId, requested)]
}

function blendHasExactNoteCoverage(blend: ReturnType<typeof selectNativeSampleVelocityBlend>, note: number) {
  return blend.some(selection => note >= selection.zone.loMidi && note <= selection.zone.hiMidi)
}

export function buildNativeSampleScorePlan(recipe: LinearScoreRecipe, pack: TloqueSamplePack, options: NativeSampleScorePlanOptions = {}): NativeSampleScorePlan {
  if (recipe.version !== 2 || recipe.plan.moduleId === "builtin") throw new Error("La partitura no solicita un paquete nativo")

  const performance = buildPerformancePlan(recipe, options.manifests ?? manifestsForModule(pack.instrumentManifestId))
  const index = buildNativeRecipeIndex(recipe)
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
    return {
      id: track.id,
      gain: Math.max(0, Math.min(1.5, track.gain * timbre.level * scoreTrackExpression(track))),
      pan: Math.max(-1, Math.min(1, track.pan)),
      micPosition: micForTrack(track.id),
      brightness: Math.max(0, Math.min(1, track.brightness ?? 0.5)),
    }
  })

  const controls: NativeSampleControlPlan[] = []
  for (const control of recipe.plan.controls) {
    if (control.expression === null && control.brightness === null) continue
    const track = trackById.get(control.trackId); if (!track) continue
    const timbre = scoreTrackTimbre(track)
    controls.push({
      trackId: control.trackId,
      timeSeconds: control.timeSeconds,
      rampSeconds: Math.max(0, control.rampSeconds),
      gain: control.expression === null ? null : Math.max(0, Math.min(1.5, track.gain * timbre.level * control.expression)),
      brightness: control.brightness === null ? null : Math.max(0, Math.min(1, control.brightness)),
    })
  }

  const voices: NativeSampleVoicePlan[] = []
  const auxiliaryVoices: NativeSampleAuxiliaryVoicePlan[] = []
  const zones = new Map<string, TloqueSampleZone>()
  const previousEventByTrack = new Map<string, LinearScoreRecipeV2["plan"]["events"][number]>()
  for (let eventIndex = 0; eventIndex < recipe.plan.events.length; eventIndex += 1) {
    const event = recipe.plan.events[eventIndex]
    const decision = performance.decisionForEvent(eventIndex)
    const track = trackById.get(event.trackId)
    if (!decision || !track) continue
    const previousEvent = previousEventByTrack.get(event.trackId)
    const connectedPerformancePhrase = Boolean(
      previousEvent
      && previousEvent.notes.length === 1
      && event.notes.length === 1
      && event.timeSeconds - (previousEvent.timeSeconds + previousEvent.durationSeconds) <= 0.09
      && event.timeSeconds - (previousEvent.timeSeconds + previousEvent.durationSeconds) >= -0.12,
    )
    const oneShot = track.instrument === "percussion.orchestral-kit"
    const requestedTimbre = event.timbre ?? track.timbre ?? "natural"
    const performedVibrato = requestedTimbre === "non-vibrato" ? 0 : nativeControlValueAt(index.controlsByTrack.get(track.id) ?? [], "vibrato", event.timeSeconds, track.vibrato ?? 0)
    const candidates = timbreCandidates(pack.instrumentManifestId, requestedTimbre, performedVibrato)
    const performedVelocity = Math.max(0.01, Math.min(1, event.velocity * decision.velocityScale))
    const velocity = Math.round(Math.min(1, scoreVelocityGain(performedVelocity) * articulationVelocityFactor(decision.articulation)) * 127)
    const durationSeconds = Math.max(0.01, event.durationSeconds * articulationDurationFactor(decision.articulation) * decision.durationScale)
    const startSeconds = Math.max(0, event.timeSeconds + decision.startOffsetSeconds)
    const dynamics = orchestralContinuousDynamics(track, index.controlsByTrack.get(track.id) ?? [], startSeconds, durationSeconds, performedVelocity, decision.articulation)
    const micPosition = micForTrack(track.id)
    for (const note of event.notes) {
      let selections: ReturnType<typeof selectNativeSampleVelocityBlend> = []
      let resolvedTimbre: ExplicitRecordedTimbre | null = null
      let fallbackSelections: ReturnType<typeof selectNativeSampleVelocityBlend> = []
      let fallbackTimbre: ExplicitRecordedTimbre | null = null
      for (const candidate of candidates) {
        const physical = physicalRecordedTimbre(candidate)
        const blend = selectNativeSampleVelocityBlend(pack, decision.articulation, note, velocity, decision.roundRobin, { ...physical, trigger: "attack", micPosition })
        if (!blend.length) continue
        if (!fallbackSelections.length) {
          fallbackSelections = blend
          fallbackTimbre = candidate
        }
        if (requestedTimbre !== "natural" || blendHasExactNoteCoverage(blend, note)) {
          selections = blend
          resolvedTimbre = candidate
          break
        }
      }
      if (!selections.length && fallbackSelections.length && fallbackTimbre) {
        selections = fallbackSelections
        resolvedTimbre = fallbackTimbre
      }
      if (!selections.length || !resolvedTimbre) {
        const attempted = candidates.join("|")
        throw new Error(`El módulo ${pack.instrumentManifestId} no contiene timbre=${attempted}, mic=${micPosition} para ${track.instrument} en MIDI ${note}`)
      }
      const physical = physicalRecordedTimbre(resolvedTimbre)
      const noteVoices: NativeSampleVoicePlan[] = selections.map(selected => {
        zones.set(selected.zone.id, selected.zone)
        const voice: NativeSampleVoicePlan = {
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
          zoneId: selected.zone.id,
          sampleUrl: selected.zone.sampleUrl,
          playbackRate: selected.playbackRate,
          sampleGain: selected.gain,
          oneShot,
          fadeInSeconds: 0,
          expression: orchestralNoteExpression(track.instrument, decision.articulation, durationSeconds, performedVibrato, physical.vibratoColour !== "none", `${recipe.plan.seed}:${event.trackId}:${event.timeSeconds}:${note}`),
          ...(!oneShot && dynamics.sustained ? { dynamics } : {}),
        }
        voices.push(voice)
        return voice
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
        const crossfadeSeconds = trueLegatoCrossfadeSeconds(durationSeconds)
        for (const voice of noteVoices) voice.fadeInSeconds = crossfadeSeconds
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
          fadeOutSeconds: crossfadeSeconds,
        })
      } else if (connectedPerformancePhrase && (decision.articulation === "legato" || decision.articulation === "tenuto" || decision.articulation === "normal")) {
        const performanceCrossfade = Math.max(0.018, Math.min(0.065, durationSeconds * 0.12))
        for (const voice of noteVoices) voice.fadeInSeconds = Math.max(voice.fadeInSeconds, performanceCrossfade)
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
          fadeOutSeconds: 0,
        })
      }
    }
    previousEventByTrack.set(event.trackId, event)
  }

  return { tracks, controls, voices, auxiliaryVoices, zones: [...zones.values()], totalSeconds: recipe.plan.totalSeconds }
}
