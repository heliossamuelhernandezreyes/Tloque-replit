import type { LinearScoreRecipe } from "@shared/audio"
import type { IntelligentPerformanceGesture } from "@shared/intelligent-performance"
import type { OrchestraConductorGesture } from "@shared/orchestra-conductor"
import { manifestsForModule, type InstrumentManifest, type TloqueArticulation } from "@shared/instrument-manifest"
import type { TloqueMicPosition, TloqueMute, TloqueSamplePack, TloqueSampleZone, TloqueVibratoColour } from "@shared/native-sample-pack"
import { physicalRecordedTimbre, recordedTimbreProfileFor, resolveRecordedTimbre, type ExplicitRecordedTimbre } from "@shared/recorded-timbre"
import type { LinearScoreRecipeV2, ScoreTimbre } from "@shared/tloque-score-v2"
import { selectNativeSampleZone, type NativeSamplePlaybackEnvelope } from "./NativeSamplePackEngine"
import { selectNativeSampleVelocityBlend, selectNativeSampleVelocityTrajectory, type DynamicNativeSampleSelection } from "./NativeSampleVelocityBlend"
import { buildPerformancePlan, performedEventValues, type PerformanceEventDecision } from "./PerformanceEngine"
import { orchestralSampleLayerIntensity } from "./OrchestralInterpreter"
import { applyIntelligentPerformanceGestureToExpression, orchestralNoteExpression, type OrchestralNoteExpression } from "./OrchestralExpression"
import { applyIntelligentPerformanceGestureToDynamics, applyOrchestraConductorToDynamics, orchestralContinuousDynamics, type OrchestralContinuousDynamics } from "./OrchestralDynamics"
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
  layerVelocity: number
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
  layerGainCurve?: Float32Array
  oneShot: boolean
  fadeInSeconds: number
  performanceGesture?: IntelligentPerformanceGesture
  conductorGesture?: OrchestraConductorGesture
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
  /** Full-score conductor state keeps ensemble balance identical when native-auto
   * partitions tracks across separate installed banks. Event objects are stable
   * references in recipeForNativeModule. */
  conductorByEvent?: ReadonlyMap<LinearScoreRecipeV2["plan"]["events"][number], OrchestraConductorGesture | undefined>
  /** Preserve full-score phrase/harmony interpretation when native-auto renders
   * one bank at a time. Local route capabilities (true legato, RR, releases)
   * still come from that bank's manifest. */
  fullScoreDecisionByEvent?: ReadonlyMap<LinearScoreRecipeV2["plan"]["events"][number], PerformanceEventDecision | undefined>
}

export function trueLegatoCrossfadeSeconds(noteDurationSeconds: number) {
  return Math.max(0.025, Math.min(0.12, noteDurationSeconds * 0.18))
}

/** Single render hand-off for realtime and offline, including source-layer
 * automation. Keep amplitude/expression independent of recorded-layer weights. */
export function nativeSampleVoiceEnvelope(voice: NativeSampleVoicePlan): NativeSamplePlaybackEnvelope {
  return {
    ...(voice.fadeInSeconds > 0 ? { fadeInSeconds: voice.fadeInSeconds } : {}),
    expression: voice.expression,
    dynamics: voice.dynamics,
    layerGainCurve: voice.layerGainCurve,
    performanceGesture: voice.performanceGesture,
    conductorGesture: voice.conductorGesture,
  }
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

function mergeFullScoreInterpretation(local: PerformanceEventDecision, full: PerformanceEventDecision | undefined) {
  if (!full) return local
  return {
    ...local,
    startOffsetSeconds: full.startOffsetSeconds,
    durationScale: full.durationScale,
    velocityScale: full.velocityScale,
    phraseStart: full.phraseStart,
    phraseEnd: full.phraseEnd,
    phraseIndex: full.phraseIndex,
    phrasePosition: full.phrasePosition,
    phraseLength: full.phraseLength,
    phraseProgress: full.phraseProgress,
    phraseClimaxPosition: full.phraseClimaxPosition,
    metricEmphasis: full.metricEmphasis,
    directorReasons: full.directorReasons,
    interpretation: full.interpretation,
    gesture: { ...full.gesture, connection: local.gesture.connection },
    conductor: full.conductor,
    identity: full.identity,
  } satisfies PerformanceEventDecision
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
  for (let eventIndex = 0; eventIndex < recipe.plan.events.length; eventIndex += 1) {
    const event = recipe.plan.events[eventIndex]
    const localDecision = performance.decisionForEvent(eventIndex)
    const interpretedDecision = localDecision
      ? mergeFullScoreInterpretation(localDecision, options.fullScoreDecisionByEvent?.get(event))
      : undefined
    const fullScoreConductor = recipe.version === 2 ? options.conductorByEvent?.get(event) : undefined
    const decision = interpretedDecision && fullScoreConductor ? { ...interpretedDecision, conductor: fullScoreConductor } : interpretedDecision
    const track = trackById.get(event.trackId)
    if (!decision || !track) continue
    const connectedPerformancePhrase = decision.gesture.connection === "phrase-carry"
    const oneShot = track.instrument === "percussion.orchestral-kit"
    const requestedTimbre = event.timbre ?? track.timbre ?? "natural"
    const trackControls = index.controlsByTrack.get(track.id) ?? []
    const performedVibrato = requestedTimbre === "non-vibrato" ? 0 : nativeControlValueAt(trackControls, "vibrato", event.timeSeconds, track.vibrato ?? 0)
    const candidates = timbreCandidates(pack.instrumentManifestId, requestedTimbre, performedVibrato)
    const performed = performedEventValues(recipe, event, decision)
    const performedVelocity = performed.velocity
    const performedExpression = nativeControlValueAt(trackControls, "expression", event.timeSeconds, track.expression)
    const layerIntensity = orchestralSampleLayerIntensity(performedVelocity, performedExpression, decision.interpretation)
    const amplitudeVelocity = Math.round(Math.min(1, scoreVelocityGain(performedVelocity) * articulationVelocityFactor(decision.articulation)) * 127)
    const velocity = Math.round(Math.min(1, scoreVelocityGain(layerIntensity) * articulationVelocityFactor(decision.articulation)) * 127)
    const durationSeconds = Math.max(0.01, performed.durationSeconds * articulationDurationFactor(decision.articulation))
    const startSeconds = performed.startSeconds
    const dynamics = applyOrchestraConductorToDynamics(
      applyIntelligentPerformanceGestureToDynamics(
        orchestralContinuousDynamics(track, trackControls, startSeconds, durationSeconds, performedVelocity, decision.articulation),
        decision.gesture,
      ),
      decision.conductor,
    )
    const micPosition = micForTrack(track.id)
    let layerVelocities: Float32Array | undefined
    if (!oneShot && dynamics.sustained && trackControls.some(control => control.expression !== null)) {
      const values = new Float32Array(dynamics.effort.length)
      // Keep the original onset selection (including its MIDI rounding), then
      // follow global control time even when humanization moves the attack.
      const onsetExpression = nativeControlValueAt(trackControls, "expression", startSeconds, track.expression)
      const onsetIntensity = orchestralSampleLayerIntensity(performedVelocity, onsetExpression, decision.interpretation)
      const onset = Math.min(1, scoreVelocityGain(onsetIntensity) * articulationVelocityFactor(decision.articulation)) * 127
      let changed = false
      for (let point = 0; point < values.length; point += 1) {
        const time = startSeconds + durationSeconds * point / (values.length - 1)
        const expression = nativeControlValueAt(trackControls, "expression", time, track.expression)
        const intensity = orchestralSampleLayerIntensity(performedVelocity, expression, decision.interpretation)
        values[point] = Math.max(0, Math.min(127, velocity - onset + Math.min(1, scoreVelocityGain(intensity) * articulationVelocityFactor(decision.articulation)) * 127))
        if (Math.abs(values[point] - velocity) > 1e-4) changed = true
      }
      if (changed) layerVelocities = values
    }
    for (const note of event.notes) {
      let selections: readonly DynamicNativeSampleSelection[] = []
      let resolvedTimbre: ExplicitRecordedTimbre | null = null
      let fallbackSelections: ReturnType<typeof selectNativeSampleVelocityBlend> = []
      let fallbackTimbre: ExplicitRecordedTimbre | null = null
      for (const candidate of candidates) {
        const physical = physicalRecordedTimbre(candidate)
        const blend = selectNativeSampleVelocityBlend(pack, decision.articulation, note, velocity, decision.roundRobin, { ...physical, trigger: "attack", micPosition, amplitudeVelocity })
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
      if (layerVelocities) {
        selections = selectNativeSampleVelocityTrajectory(pack, decision.articulation, note, layerVelocities, decision.roundRobin, {
          ...physical, trigger: "attack", micPosition, amplitudeVelocity,
        })
      }
      const noteVoices: NativeSampleVoicePlan[] = selections.map(selected => {
        zones.set(selected.zone.id, selected.zone)
        const voice: NativeSampleVoicePlan = {
          trackId: event.trackId,
          articulation: decision.articulation,
          timbre: requestedTimbre,
          resolvedTimbre,
          note,
          velocity: amplitudeVelocity,
          layerVelocity: velocity,
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
          sampleGain: selected.gain * decision.conductor.balanceScale,
          ...(selected.layerGainCurve ? { layerGainCurve: selected.layerGainCurve } : {}),
          oneShot,
          fadeInSeconds: 0,
          performanceGesture: decision.gesture,
          conductorGesture: decision.conductor,
          expression: applyIntelligentPerformanceGestureToExpression(
            orchestralNoteExpression(track.instrument, decision.articulation, durationSeconds, performedVibrato, physical.vibratoColour !== "none", `${recipe.plan.seed}:${event.trackId}:${event.timeSeconds}:${note}`),
            decision.gesture,
          ),
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
          amplitudeVelocity,
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
          velocity: amplitudeVelocity,
          micPosition,
          startSeconds,
          durationSeconds: Math.min(1.5, durationSeconds),
          zoneId: transition.zone.id,
          sampleUrl: transition.zone.sampleUrl,
          playbackRate: transition.playbackRate,
          sampleGain: transition.gain * decision.conductor.balanceScale,
          transitionFromMidi: from,
          fadeOutSeconds: crossfadeSeconds,
        })
      } else if (connectedPerformancePhrase && (decision.articulation === "legato" || decision.articulation === "tenuto" || decision.articulation === "normal")) {
        const performanceCrossfade = decision.gesture.transitionSeconds
        for (const voice of noteVoices) voice.fadeInSeconds = Math.max(voice.fadeInSeconds, performanceCrossfade)
      }

      if (decision.releaseSamples) {
        const releaseVelocity = layerVelocities ? Math.round(layerVelocities[layerVelocities.length - 1]) : velocity
        const release = selectNativeSampleZone(pack, decision.articulation, note, releaseVelocity, decision.roundRobin, { ...physical, trigger: "release", micPosition, amplitudeVelocity })
        if (!release) throw new Error(`El módulo ${pack.instrumentManifestId} declara release-samples pero no contiene release para MIDI ${note} en mic=${micPosition}`)
        zones.set(release.zone.id, release.zone)
        auxiliaryVoices.push({
          kind: "release",
          trackId: event.trackId,
          articulation: decision.articulation,
          note,
          velocity: amplitudeVelocity,
          micPosition,
          startSeconds: startSeconds + durationSeconds,
          durationSeconds: 8,
          zoneId: release.zone.id,
          sampleUrl: release.zone.sampleUrl,
          playbackRate: release.playbackRate,
          sampleGain: release.gain * decision.conductor.balanceScale,
          fadeOutSeconds: 0,
        })
      }
    }
  }

  return { tracks, controls, voices, auxiliaryVoices, zones: [...zones.values()], totalSeconds: recipe.plan.totalSeconds }
}
