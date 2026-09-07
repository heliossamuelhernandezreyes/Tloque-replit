import type { LinearScoreRecipe, LinearScoreTrack } from "@shared/audio"
import type { TloqueArticulation } from "@shared/instrument-manifest"
import {
  INTELLIGENT_PERFORMER_RULE_VERSION,
  INTELLIGENT_PERFORMER_VERSION,
  type IntelligentPerformanceGesture,
  type PerformanceMedium,
} from "@shared/intelligent-performance"

export const UNIVERSAL_PERFORMANCE_DIRECTOR_VERSION = "tloque-universal-performance-director-v5-acoustic-continuity" as const

export type MetricEmphasis = "primary" | "secondary" | "light"

export interface PerformancePhraseContext {
  phraseIndex: number
  position: number
  length: number
  climaxPosition: number
  metricEmphasis: MetricEmphasis
}

export interface PerformanceDirectorContext {
  track: LinearScoreTrack
  event: LinearScoreRecipe["plan"]["events"][number]
  previous: LinearScoreRecipe["plan"]["events"][number] | null
  next: LinearScoreRecipe["plan"]["events"][number] | null
  articulation: TloqueArticulation
  phrase: PerformancePhraseContext
}

export interface PerformanceDirectorDecision {
  startOffsetSeconds: number
  durationScale: number
  velocityScale: number
  phraseStart: boolean
  phraseEnd: boolean
  phraseProgress: number
  gesture: IntelligentPerformanceGesture
  reason: readonly string[]
}

function eventDurationSeconds(recipe: LinearScoreRecipe, event: LinearScoreRecipe["plan"]["events"][number]) {
  return "durationSeconds" in event ? event.durationSeconds : event.durationBeats * 60 / recipe.plan.bpm
}

function eventStartSeconds(recipe: LinearScoreRecipe, event: LinearScoreRecipe["plan"]["events"][number]) {
  return "timeSeconds" in event ? event.timeSeconds : event.timeBeats * 60 / recipe.plan.bpm
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function roleArcStrength(track: LinearScoreTrack) {
  if (!("role" in track)) return 0.65
  if (track.role === "melody") return 1
  if (track.role === "bass") return 0.72
  if (track.role === "harmony") return 0.58
  if (track.role === "accent") return 0.52
  if (track.role === "pulse") return 0.42
  return 0.34
}

function phraseArc(phrase: PerformancePhraseContext) {
  if (phrase.length < 3) return 0
  const last = phrase.length - 1
  const climax = clamp(phrase.climaxPosition, 1, Math.max(1, last - 1))
  if (phrase.position <= climax) {
    return -0.01 + 0.042 * (phrase.position / climax)
  }
  return 0.032 - 0.05 * ((phrase.position - climax) / Math.max(1, last - climax))
}

function metricVelocityScale(track: LinearScoreTrack, emphasis: MetricEmphasis) {
  const role = "role" in track ? track.role : "harmony"
  if (emphasis === "primary") {
    if (role === "pulse" || role === "bass" || role === "accent") return 1.022
    if (role === "melody") return 1.012
    if (role === "harmony") return 1.008
    return 1.004
  }
  if (emphasis === "secondary") return role === "pulse" || role === "bass" ? 1.01 : 1.005
  return role === "pulse" ? 0.997 : 1
}

function performanceMedium(instrument: string, articulation: TloqueArticulation): PerformanceMedium {
  if (instrument.startsWith("strings.") && instrument !== "strings.harp" && articulation !== "pizzicato") return "bow"
  if (instrument.startsWith("woodwinds.") || instrument.startsWith("brass.")) return "breath"
  if (instrument === "strings.harp" || instrument.startsWith("guitar.") || articulation === "pizzicato") return "pluck"
  if (instrument.startsWith("percussion.")) return "strike"
  if (instrument.startsWith("piano.") || instrument.startsWith("keys.")) return "key"
  return "sustain"
}

function gestureFor(
  recipe: LinearScoreRecipe,
  context: PerformanceDirectorContext,
  duration: number,
  phraseStart: boolean,
  phraseEnd: boolean,
): IntelligentPerformanceGesture {
  const { track, event, previous, articulation, phrase } = context
  const instrument = "instrument" in track ? track.instrument : ""
  const medium = performanceMedium(instrument, articulation)
  const previousEnd = previous ? eventStartSeconds(recipe, previous) + eventDurationSeconds(recipe, previous) : Number.NEGATIVE_INFINITY
  const eventStart = eventStartSeconds(recipe, event)
  const interval = previous?.notes.length === 1 && event.notes.length === 1
    ? Math.abs(event.notes[0] - previous.notes[0])
    : Number.POSITIVE_INFINITY
  const connected = Boolean(
    previous
    && !phraseStart
    && (articulation === "legato" || articulation === "tenuto")
    && previous.notes.length === 1
    && event.notes.length === 1
    && previous.notes[0] !== event.notes[0]
    && interval <= 12
    && eventStart - previousEnd >= -0.12
    && eventStart - previousEnd <= 0.08,
  )
  const shortAttack = articulation === "staccato" || articulation === "spiccato" || articulation === "accent"
  const progress = phrase.length <= 1 ? 1 : phrase.position / (phrase.length - 1)
  const climaxDistance = phrase.length <= 1 ? 1 : Math.abs(phrase.position - phrase.climaxPosition) / Math.max(1, phrase.length - 1)
  const climaxEnergy = 1 - clamp(climaxDistance * 1.8, 0, 1)

  let attackTimeScale = phraseStart ? 1.08 : 1
  let releaseTimeScale = phraseEnd ? 1.12 : 1
  let onsetEffort = phraseStart ? 0.94 : 1
  let sustainEffort = 0.97 + climaxEnergy * 0.08
  let releaseEffort = phraseEnd ? 0.78 : 0.94
  let brightnessScale = 0.96 + climaxEnergy * 0.08
  let vibratoDepthScale = medium === "bow" || medium === "breath"
    ? clamp(0.72 + progress * 0.38 + climaxEnergy * 0.08, 0.72, 1.14)
    : 1
  let vibratoDelaySeconds = medium === "bow" || medium === "breath"
    ? Math.min(duration * 0.25, phraseStart ? 0.18 : connected ? 0.06 : 0.11)
    : 0

  if (connected) {
    attackTimeScale = 0.68
    onsetEffort = medium === "breath" ? 0.48 : 0.56
    releaseEffort = phraseEnd ? releaseEffort : 0.98
  }
  if (shortAttack) {
    attackTimeScale = articulation === "accent" ? 0.72 : 0.62
    releaseTimeScale = articulation === "accent" ? 0.78 : 0.62
    onsetEffort = articulation === "accent" ? 1.16 : 1.1
    sustainEffort = articulation === "accent" ? 0.9 : 0.76
    releaseEffort = 0.64
    brightnessScale *= articulation === "accent" ? 1.08 : 1.04
    vibratoDepthScale = 0
    vibratoDelaySeconds = 0
  }
  if (medium === "key" || medium === "pluck" || medium === "strike") {
    vibratoDepthScale = 0
    vibratoDelaySeconds = 0
    releaseTimeScale = phraseEnd && medium === "key" ? 1.04 : releaseTimeScale
  }
  if (medium === "breath" && phraseEnd && !connected) {
    releaseTimeScale = 0.86
    releaseEffort = 0.7
  }

  const bowDirection = medium === "bow"
    ? ((phrase.phraseIndex + (connected ? 0 : phrase.position)) % 2 === 0 ? "down" : "up")
    : null
  if (bowDirection === "down" && !connected) onsetEffort *= 1.025
  if (bowDirection === "up" && !connected) onsetEffort *= 0.985

  return {
    contractVersion: INTELLIGENT_PERFORMER_VERSION,
    ruleVersion: INTELLIGENT_PERFORMER_RULE_VERSION,
    medium,
    connection: connected ? "phrase-carry" : "fresh-attack",
    attackTimeScale: clamp(attackTimeScale, 0.55, 1.18),
    releaseTimeScale: clamp(releaseTimeScale, 0.58, 1.2),
    onsetEffort: clamp(onsetEffort, 0.42, 1.2),
    sustainEffort: clamp(sustainEffort, 0.7, 1.1),
    releaseEffort: clamp(releaseEffort, 0.58, 1.08),
    brightnessScale: clamp(brightnessScale, 0.9, 1.12),
    vibratoDepthScale: clamp(vibratoDepthScale, 0, 1.18),
    vibratoDelaySeconds: clamp(vibratoDelaySeconds, 0, 0.32),
    transitionSeconds: connected ? clamp(0.018 + interval * 0.0022, 0.018, 0.052) : 0,
    bowDirection,
    breathReset: medium === "breath" && !connected,
  }
}

/**
 * Phrase-aware renderer-neutral interpretation layer.
 *
 * The Director never changes authored pitch, rhythm class, articulation or timbre and
 * never claims a sample capability that is not present. It applies conservative,
 * deterministic timing/length/velocity shaping from complete phrase position,
 * metrical hierarchy, melodic contour and instrument-family breathing/bowing.
 */
export function directPerformanceEvent(
  recipe: LinearScoreRecipe,
  context: PerformanceDirectorContext,
): PerformanceDirectorDecision {
  const { track, event, previous, next, articulation, phrase } = context
  const instrument = "instrument" in track ? track.instrument : ""
  const duration = eventDurationSeconds(recipe, event)
  const phraseStart = phrase.position === 0
  const phraseEnd = phrase.position === phrase.length - 1
  const phraseProgress = phrase.length <= 1 ? 1 : phrase.position / (phrase.length - 1)
  const reasons: string[] = []

  let velocityScale = 1
  let durationScale = 1
  let startOffsetSeconds = 0

  const legatoLike = articulation === "legato" || articulation === "tenuto"
  const accentLike = articulation === "accent" || articulation === "spiccato" || articulation === "staccato"

  const arc = phraseArc(phrase) * roleArcStrength(track)
  if (Math.abs(arc) > 0.0001 && !accentLike) {
    velocityScale *= 1 + arc
    reasons.push(phrase.position === phrase.climaxPosition ? "phrase-climax" : phrase.position < phrase.climaxPosition ? "phrase-arc-rise" : "phrase-arc-release")
  }

  const metricScale = metricVelocityScale(track, phrase.metricEmphasis)
  if (metricScale !== 1) {
    velocityScale *= metricScale
    reasons.push(`metric-${phrase.metricEmphasis}`)
  }

  if (phraseStart && !accentLike) {
    velocityScale *= 0.99
    reasons.push("phrase-entry")
    if (instrument.startsWith("woodwinds.") || instrument.startsWith("brass.")) startOffsetSeconds += 0.004
  }

  if (phraseEnd) {
    velocityScale *= 0.98
    durationScale *= legatoLike ? 1.018 : 0.985
    reasons.push("phrase-release")
  }

  if (previous && previous.notes.length === 1 && event.notes.length === 1) {
    const interval = Math.abs(event.notes[0] - previous.notes[0])
    if (interval >= 7 && !phraseStart) {
      velocityScale *= 1.025
      reasons.push("leap-destination")
    } else if (interval === 0) {
      velocityScale *= 0.992
      durationScale *= 0.985
      reasons.push("repeated-note")
    }
  }

  if (previous?.notes.length === 1 && event.notes.length === 1 && next?.notes.length === 1) {
    const incoming = event.notes[0] - previous.notes[0]
    const outgoing = next.notes[0] - event.notes[0]
    if (incoming > 0 && outgoing < 0) {
      velocityScale *= 1.012
      reasons.push("melodic-apex")
    } else if (incoming < 0 && outgoing > 0) {
      velocityScale *= 0.996
      reasons.push("melodic-valley")
    }
  }

  if (duration >= 1.6 && !accentLike) {
    durationScale *= 1.008
    velocityScale *= 1.008
    reasons.push("sustained-destination")
  }

  if (instrument.startsWith("strings.") && articulation === "legato" && !phraseEnd) {
    durationScale *= 1.012
    reasons.push("string-line-carry")
  }

  if ((instrument.startsWith("woodwinds.") || instrument.startsWith("brass.")) && phraseEnd && !legatoLike) {
    durationScale *= 0.97
    reasons.push("breath-release")
  }

  if (instrument.startsWith("keys.pipe-organ")) {
    // Registration changes are not synthesized here; organ phrasing remains nearly exact.
    startOffsetSeconds *= 0.25
    velocityScale = 1 + (velocityScale - 1) * 0.35
    durationScale = 1 + (durationScale - 1) * 0.45
  }

  return {
    startOffsetSeconds: clamp(startOffsetSeconds, -0.008, 0.008),
    durationScale: clamp(durationScale, 0.94, 1.06),
    velocityScale: clamp(velocityScale, 0.94, 1.06),
    phraseStart,
    phraseEnd,
    phraseProgress,
    gesture: gestureFor(recipe, context, duration, phraseStart, phraseEnd),
    reason: reasons,
  }
}
