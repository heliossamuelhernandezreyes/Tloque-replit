import type { LinearScoreRecipe, LinearScoreTrack } from "@shared/audio"
import type { TloqueArticulation } from "@shared/instrument-manifest"

export interface PerformanceDirectorContext {
  track: LinearScoreTrack
  event: LinearScoreRecipe["plan"]["events"][number]
  previous: LinearScoreRecipe["plan"]["events"][number] | null
  next: LinearScoreRecipe["plan"]["events"][number] | null
  articulation: TloqueArticulation
}

export interface PerformanceDirectorDecision {
  startOffsetSeconds: number
  durationScale: number
  velocityScale: number
  phraseStart: boolean
  phraseEnd: boolean
  reason: readonly string[]
}

function eventStartSeconds(recipe: LinearScoreRecipe, event: LinearScoreRecipe["plan"]["events"][number]) {
  return "timeSeconds" in event ? event.timeSeconds : event.timeBeats * 60 / recipe.plan.bpm
}

function eventDurationSeconds(recipe: LinearScoreRecipe, event: LinearScoreRecipe["plan"]["events"][number]) {
  return "durationSeconds" in event ? event.durationSeconds : event.durationBeats * 60 / recipe.plan.bpm
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/**
 * Phrase-aware renderer-neutral interpretation layer.
 *
 * The Director never changes authored pitch, rhythm class, articulation or timbre and
 * never claims a sample capability that is not present. It only applies conservative
 * contextual timing/length/velocity shaping around phrase boundaries, melodic leaps,
 * repeated notes and long destinations. This is intentionally deterministic.
 */
export function directPerformanceEvent(
  recipe: LinearScoreRecipe,
  context: PerformanceDirectorContext,
): PerformanceDirectorDecision {
  const { track, event, previous, next, articulation } = context
  const instrument = "instrument" in track ? track.instrument : ""
  const start = eventStartSeconds(recipe, event)
  const duration = eventDurationSeconds(recipe, event)
  const previousEnd = previous ? eventStartSeconds(recipe, previous) + eventDurationSeconds(recipe, previous) : Number.NEGATIVE_INFINITY
  const nextStart = next ? eventStartSeconds(recipe, next) : Number.POSITIVE_INFINITY
  const gapBefore = previous ? Math.max(0, start - previousEnd) : Number.POSITIVE_INFINITY
  const gapAfter = next ? Math.max(0, nextStart - (start + duration)) : Number.POSITIVE_INFINITY
  const phraseStart = !previous || gapBefore >= 0.18
  const phraseEnd = !next || gapAfter >= 0.22
  const reasons: string[] = []

  let velocityScale = 1
  let durationScale = 1
  let startOffsetSeconds = 0

  const legatoLike = articulation === "legato" || articulation === "tenuto"
  const accentLike = articulation === "accent" || articulation === "spiccato" || articulation === "staccato"

  if (phraseStart && !accentLike) {
    velocityScale *= 0.985
    reasons.push("phrase-entry")
    if (instrument.startsWith("woodwinds.") || instrument.startsWith("brass.")) startOffsetSeconds += 0.003
  }

  if (phraseEnd) {
    velocityScale *= 0.975
    durationScale *= legatoLike ? 1.025 : 1.012
    reasons.push("phrase-release")
  }

  if (previous && previous.notes.length === 1 && event.notes.length === 1) {
    const interval = Math.abs(event.notes[0] - previous.notes[0])
    if (interval >= 7 && !phraseStart) {
      velocityScale *= 1.025
      reasons.push("leap-destination")
    } else if (interval === 0) {
      velocityScale *= 0.992
      durationScale *= 0.995
      reasons.push("repeated-note")
    }
  }

  if (duration >= 1.6 && !accentLike) {
    durationScale *= 1.008
    velocityScale *= 1.008
    reasons.push("sustained-destination")
  }

  if (instrument.startsWith("strings.") && articulation === "legato" && !phraseEnd) {
    durationScale *= 1.008
    reasons.push("string-line-carry")
  }

  if ((instrument.startsWith("woodwinds.") || instrument.startsWith("brass.")) && phraseEnd && !legatoLike) {
    durationScale *= 0.985
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
    reason: reasons,
  }
}
