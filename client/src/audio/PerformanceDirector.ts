import type { LinearScoreRecipe, LinearScoreTrack } from "@shared/audio"
import type { TloqueArticulation } from "@shared/instrument-manifest"

export const UNIVERSAL_PERFORMANCE_DIRECTOR_VERSION = "tloque-universal-performance-director-v2" as const

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
  reason: readonly string[]
}

function eventDurationSeconds(recipe: LinearScoreRecipe, event: LinearScoreRecipe["plan"]["events"][number]) {
  return "durationSeconds" in event ? event.durationSeconds : event.durationBeats * 60 / recipe.plan.bpm
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
    reason: reasons,
  }
}
