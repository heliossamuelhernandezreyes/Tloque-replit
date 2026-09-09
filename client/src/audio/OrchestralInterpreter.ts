import type { LinearScoreRecipe, LinearScoreTrack } from "@shared/audio"
import {
  ORCHESTRAL_INTERPRETER_RULE_VERSION,
  ORCHESTRAL_INTERPRETER_VERSION,
  type OrchestralArticulationIntent,
  type OrchestralInterpretationEnvelope,
  type OrchestralInterpretationGesture,
  type OrchestralPhrasePhase,
  type OrchestralStageIntent,
} from "@shared/orchestral-interpreter"
import type { PerformancePhraseContext } from "./PerformanceDirector"

type ScoreEvent = LinearScoreRecipe["plan"]["events"][number]

export interface OrchestralInterpreterPlan {
  version: typeof ORCHESTRAL_INTERPRETER_VERSION
  ruleVersion: typeof ORCHESTRAL_INTERPRETER_RULE_VERSION
  decisions: ReadonlyMap<number, OrchestralInterpretationGesture>
  stageByTrack: ReadonlyMap<string, OrchestralStageIntent>
}

interface HarmonyGroup {
  key: number
  timeBeats: number
  pitchClasses: Set<number>
  tension: number
}

interface TrackRange { minimum: number; maximum: number }

const TIME_PRECISION = 1_000_000

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum))
}

function eventDurationSeconds(recipe: LinearScoreRecipe, event: ScoreEvent) {
  return "durationSeconds" in event ? event.durationSeconds : event.durationBeats * 60 / recipe.plan.bpm
}

function eventArticulation(event: ScoreEvent) {
  return "articulation" in event ? event.articulation : "normal"
}

function instrumentFor(track: LinearScoreTrack) {
  return "instrument" in track ? track.instrument : `synth.${track.synth}`
}

function roleFor(track: LinearScoreTrack) {
  return "role" in track ? track.role : "harmony"
}

function meanPitch(event: ScoreEvent) {
  return event.notes.reduce((sum, note) => sum + note, 0) / Math.max(1, event.notes.length)
}

function onsetKey(event: ScoreEvent) {
  return Math.round(event.timeBeats * TIME_PRECISION)
}

/** Interval-class roughness is a conservative orchestration heuristic, not a
 * claim about a listener's emotion or cognition. Octave displacement is ignored
 * so the result stays stable when an orchestration doubles a line. */
export function orchestralPitchClassTension(pitchClasses: readonly number[]) {
  const values = [...new Set(pitchClasses.map(value => ((Math.round(value) % 12) + 12) % 12))].sort((a, b) => a - b)
  if (values.length < 2) return 0
  const weights = [0, 0.94, 0.58, 0.18, 0.11, 0.07, 0.86] as const
  let total = 0
  let pairs = 0
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      const distance = Math.abs(values[right] - values[left])
      total += weights[Math.min(distance, 12 - distance)]
      pairs += 1
    }
  }
  return clamp(total / Math.max(1, pairs))
}

function articulationIntent(articulation: string, duration: number, phraseEnd: boolean): OrchestralArticulationIntent {
  if (["staccato", "spiccato", "pizzicato", "accent", "tremolo"].includes(articulation)) return "impulse"
  if (articulation === "legato") return "connected"
  if (phraseEnd) return "release"
  if (articulation === "tenuto" || duration >= 0.72) return "sustained"
  return "separated"
}

function phrasePhase(phrase: PerformancePhraseContext, arrivalStrength: number): OrchestralPhrasePhase {
  const phraseEnd = phrase.position === phrase.length - 1
  if (phraseEnd && arrivalStrength >= 0.46) return "arrival"
  if (phrase.position === 0) return "entry"
  if (phrase.position === phrase.climaxPosition) return "climax"
  if (phrase.position > phrase.climaxPosition) return "release"
  return "direction"
}

function envelope(startScale: number, peakScale: number, endScale: number, peakPosition: number): OrchestralInterpretationEnvelope {
  return {
    startScale: clamp(startScale, 0.86, 1.12),
    peakScale: clamp(peakScale, 0.88, 1.14),
    endScale: clamp(endScale, 0.84, 1.1),
    peakPosition: clamp(peakPosition, 0.28, 0.78),
  }
}

function vibratoEnvelope(startScale: number, peakScale: number, endScale: number, peakPosition: number): OrchestralInterpretationEnvelope {
  return {
    startScale: clamp(startScale, 0, 1.2),
    peakScale: clamp(peakScale, 0, 1.24),
    endScale: clamp(endScale, 0, 1.2),
    peakPosition: clamp(peakPosition, 0.3, 0.82),
  }
}

function roleWeight(role: string) {
  if (role === "melody") return 1
  if (role === "accent") return 0.88
  if (role === "bass") return 0.72
  if (role === "harmony") return 0.6
  if (role === "pulse") return 0.52
  return 0.4
}

function stableUnit(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return (hash >>> 0) / 0xffffffff
}

export function orchestralStageIntentForTrack(track: LinearScoreTrack): OrchestralStageIntent {
  const role = roleFor(track)
  const byRole = role === "melody"
    ? { depthScale: 0.92, roomSendScale: 0.95, presenceScale: 1.025 }
    : role === "texture"
      ? { depthScale: 1.08, roomSendScale: 1.1, presenceScale: 0.95 }
      : role === "harmony"
        ? { depthScale: 1.02, roomSendScale: 1.05, presenceScale: 0.98 }
        : role === "pulse"
          ? { depthScale: 1.03, roomSendScale: 0.98, presenceScale: 0.985 }
          : role === "bass"
            ? { depthScale: 0.99, roomSendScale: 1.02, presenceScale: 1 }
            : { depthScale: 1, roomSendScale: 1, presenceScale: 1 }
  const id = "id" in track ? track.id : instrumentFor(track)
  return {
    contractVersion: ORCHESTRAL_INTERPRETER_VERSION,
    ruleVersion: ORCHESTRAL_INTERPRETER_RULE_VERSION,
    ...byRole,
    panOffset: (stableUnit(id) - 0.5) * 0.024,
  }
}

function metricWeight(emphasis: PerformancePhraseContext["metricEmphasis"]) {
  return emphasis === "primary" ? 1 : emphasis === "secondary" ? 0.48 : 0
}

function buildHarmonyGroups(
  recipe: LinearScoreRecipe,
  tracksById: ReadonlyMap<string, LinearScoreTrack>,
  playableTrackIds: ReadonlySet<string>,
) {
  const groups = new Map<number, HarmonyGroup>()
  for (const event of recipe.plan.events) {
    if (!playableTrackIds.has(event.trackId)) continue
    const track = tracksById.get(event.trackId)
    if (!track || instrumentFor(track).startsWith("percussion.")) continue
    const key = onsetKey(event)
    const group = groups.get(key) ?? { key, timeBeats: event.timeBeats, pitchClasses: new Set<number>(), tension: 0 }
    for (const note of event.notes) group.pitchClasses.add(((note % 12) + 12) % 12)
    groups.set(key, group)
  }
  const ordered = [...groups.values()].sort((left, right) => left.timeBeats - right.timeBeats || left.key - right.key)
  for (const group of ordered) group.tension = orchestralPitchClassTension([...group.pitchClasses])
  return { groups, ordered, indexByKey: new Map(ordered.map((group, index) => [group.key, index])) }
}

function trackRanges(recipe: LinearScoreRecipe, playableTrackIds: ReadonlySet<string>) {
  const ranges = new Map<string, TrackRange>()
  for (const event of recipe.plan.events) {
    if (!playableTrackIds.has(event.trackId)) continue
    const minimum = Math.min(...event.notes)
    const maximum = Math.max(...event.notes)
    const current = ranges.get(event.trackId)
    if (!current) ranges.set(event.trackId, { minimum, maximum })
    else {
      current.minimum = Math.min(current.minimum, minimum)
      current.maximum = Math.max(current.maximum, maximum)
    }
  }
  return ranges
}

export function buildOrchestralInterpreterPlan(
  recipe: LinearScoreRecipe,
  phrases: ReadonlyMap<number, PerformancePhraseContext>,
  playableTrackIds: ReadonlySet<string> = new Set(recipe.plan.tracks.map(track => track.id)),
): OrchestralInterpreterPlan {
  const tracksById = new Map(recipe.plan.tracks.map(track => [track.id, track]))
  const ranges = trackRanges(recipe, playableTrackIds)
  const harmony = buildHarmonyGroups(recipe, tracksById, playableTrackIds)
  const decisions = new Map<number, OrchestralInterpretationGesture>()
  const stageByTrack = new Map(
    recipe.plan.tracks
      .filter(track => playableTrackIds.has(track.id))
      .map(track => [track.id, orchestralStageIntentForTrack(track)] as const),
  )

  for (let eventIndex = 0; eventIndex < recipe.plan.events.length; eventIndex += 1) {
    const event = recipe.plan.events[eventIndex]
    if (!playableTrackIds.has(event.trackId)) continue
    const track = tracksById.get(event.trackId)
    if (!track) continue
    const phrase = phrases.get(eventIndex) ?? { phraseIndex: 0, position: 0, length: 1, climaxPosition: 0, metricEmphasis: "primary" as const }
    const duration = eventDurationSeconds(recipe, event)
    const articulation = eventArticulation(event)
    const phraseEnd = phrase.position === phrase.length - 1
    const groupIndex = harmony.indexByKey.get(onsetKey(event))
    const group = groupIndex === undefined ? undefined : harmony.ordered[groupIndex]
    const previousGroup = groupIndex === undefined || groupIndex === 0 ? undefined : harmony.ordered[groupIndex - 1]
    const tension = group?.tension ?? 0
    const tensionResolution = Math.max(0, (previousGroup?.tension ?? tension) - tension)
    const metric = metricWeight(phrase.metricEmphasis)
    const heldWeight = clamp(duration / 2.4)
    const arrivalStrength = clamp(
      (phraseEnd ? 0.44 : 0)
      + metric * (phraseEnd ? 0.2 : 0.04)
      + heldWeight * (phraseEnd ? 0.15 : 0.02)
      + tensionResolution * 0.34,
    )
    const range = ranges.get(event.trackId) ?? { minimum: 60, maximum: 72 }
    const register = clamp((meanPitch(event) - range.minimum) / Math.max(1, range.maximum - range.minimum))
    const climax = phrase.position === phrase.climaxPosition ? 1 : 0
    const melodicWeight = clamp(
      roleWeight(roleFor(track)) * 0.3
      + event.velocity * 0.27
      + register * 0.1
      + climax * 0.2
      + heldWeight * 0.07
      + metric * 0.06,
    )
    const phase = phrasePhase(phrase, arrivalStrength)
    const intent = articulationIntent(articulation, duration, phraseEnd)
    const short = intent === "impulse" || duration < 0.28
    const sustainedMedium = instrumentFor(track).startsWith("strings.")
      || instrumentFor(track).startsWith("woodwinds.")
      || instrumentFor(track).startsWith("brass.")
    const reasons: string[] = [`phrase-${phase}`, `articulation-${intent}`]
    if (tension >= 0.42) reasons.push("harmonic-tension")
    if (tensionResolution >= 0.18) reasons.push("harmonic-resolution")
    if (arrivalStrength >= 0.46) reasons.push("structural-arrival")
    if (climax) reasons.push("melodic-climax")

    const dynamic = short
      ? envelope(1 + melodicWeight * 0.02, 1 + melodicWeight * 0.03, 0.96, 0.34)
      : envelope(
          phase === "entry" ? 0.93 : intent === "connected" ? 0.975 : 0.985,
          0.98 + melodicWeight * 0.075 + tension * 0.025,
          phraseEnd ? 0.9 + arrivalStrength * 0.045 : phase === "release" ? 0.965 : 0.99,
          phase === "arrival" ? 0.48 : phase === "climax" ? 0.56 : 0.62,
        )
    const vibrato = !sustainedMedium || short || ("timbre" in event && event.timbre === "non-vibrato")
      ? vibratoEnvelope(0, 0, 0, 0.62)
      : vibratoEnvelope(
          phase === "entry" ? 0.38 : intent === "connected" ? 0.64 : 0.52,
          0.76 + melodicWeight * 0.28 + tension * 0.08,
          phraseEnd ? 0.5 + arrivalStrength * 0.16 : phase === "release" ? 0.82 : 0.92,
          phase === "arrival" ? 0.68 : 0.62,
        )
    const instrument = instrumentFor(track)
    const breathReset = (instrument.startsWith("woodwinds.") || instrument.startsWith("brass."))
      && (phrase.position === 0 || (phraseEnd && intent !== "connected"))
    const bowDirection = instrument.startsWith("strings.") && instrument !== "strings.harp" && articulation !== "pizzicato"
      ? ((phrase.phraseIndex + (articulation === "legato" ? 0 : phrase.position)) % 2 === 0 ? "down" : "up")
      : null
    const attackTimeScale = intent === "connected" ? 0.78 : intent === "impulse" ? 0.84 : phase === "entry" ? 1.045 : phase === "climax" ? 0.95 : 1
    const releaseTimeScale = breathReset && phraseEnd ? 0.88 : phraseEnd ? 1.07 : intent === "impulse" ? 0.82 : 1

    decisions.set(eventIndex, {
      contractVersion: ORCHESTRAL_INTERPRETER_VERSION,
      ruleVersion: ORCHESTRAL_INTERPRETER_RULE_VERSION,
      basis: "music-design-heuristic",
      phrasePhase: phase,
      articulationIntent: intent,
      harmonicTension: tension,
      melodicWeight,
      arrivalStrength,
      dynamic,
      vibrato,
      sampleDynamicsScale: clamp(0.955 + melodicWeight * 0.055 + tension * 0.025 + arrivalStrength * 0.015, 0.94, 1.065),
      attackTimeScale: clamp(attackTimeScale, 0.72, 1.08),
      releaseTimeScale: clamp(releaseTimeScale, 0.78, 1.1),
      breathReset,
      bowDirection,
      reasons,
    })
  }

  return {
    version: ORCHESTRAL_INTERPRETER_VERSION,
    ruleVersion: ORCHESTRAL_INTERPRETER_RULE_VERSION,
    decisions,
    stageByTrack,
  }
}

/** Choose recorded dynamic colour from authored velocity plus expression while
 * leaving amplitude under the renderer's existing gain contract. */
export function orchestralSampleLayerIntensity(
  performedVelocity: number,
  expression: number,
  gesture: OrchestralInterpretationGesture,
) {
  const authored = clamp(performedVelocity, 0.01, 1)
  const continuousExpression = clamp(expression, 0.01, 1)
  return clamp((authored * 0.68 + continuousExpression * 0.32) * gesture.sampleDynamicsScale, 0.01, 1)
}
