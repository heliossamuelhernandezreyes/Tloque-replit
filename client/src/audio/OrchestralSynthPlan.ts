import type { LinearScoreRecipeV2 } from "@shared/tloque-score-v2"
import { buildPerformancePlan } from "./PerformanceEngine"
import { articulationDurationFactor, scorePedalReleaseTime } from "./ScoreAudioMath"

/** The same phrase director serves recorded and synthesized instruments. Empty
 * manifests mean no fabricated sample, true-legato or keyswitch capabilities. */
export function buildOrchestralSynthPlan(recipe: LinearScoreRecipeV2, trackIds: ReadonlySet<string>) {
  const performance = buildPerformancePlan(recipe, [])
  const previousByTrack = new Map<string, LinearScoreRecipeV2["plan"]["events"][number]>()
  const planned: Array<LinearScoreRecipeV2["plan"]["events"][number] & {
    durationIsPerformed: true
    legatoFromPrevious?: boolean
    transitionFromMidi?: number
  }> = []
  for (let eventIndex = 0; eventIndex < recipe.plan.events.length; eventIndex += 1) {
    const event = recipe.plan.events[eventIndex]
    if (!trackIds.has(event.trackId)) continue
    const decision = performance.decisionForEvent(eventIndex)
    const timeSeconds = Math.max(0, event.timeSeconds + (decision?.startOffsetSeconds ?? 0))
    const duration = event.durationSeconds * (decision?.durationScale ?? 1) * articulationDurationFactor(event.articulation)
    const track = recipe.plan.tracks.find(item => item.id === event.trackId)
    const pedalEnd = track?.instrument === "piano.grand" ? scorePedalReleaseTime(recipe, event.trackId, timeSeconds + duration) : timeSeconds + duration
    const previous = previousByTrack.get(event.trackId)
    const authoredGap = previous ? event.timeSeconds - (previous.timeSeconds + previous.durationSeconds) : Infinity
    const transitionFromMidi = previous?.notes.length === 1 ? previous.notes[0] : undefined
    const linked = (decision?.articulation ?? event.articulation) === "legato"
      && event.notes.length === 1
      && transitionFromMidi !== undefined
      && authoredGap >= -0.12
      && authoredGap <= 0.09
      && Math.abs(event.notes[0] - transitionFromMidi) <= 12
    planned.push({
      ...event,
      articulation: decision?.articulation ?? event.articulation,
      timeSeconds,
      durationIsPerformed: true,
      durationSeconds: Math.max(duration, pedalEnd - timeSeconds),
      velocity: Math.max(0.01, Math.min(1, event.velocity * (decision?.velocityScale ?? 1))),
      ...(linked ? { legatoFromPrevious: true, transitionFromMidi } : {}),
    })
    previousByTrack.set(event.trackId, event)
  }
  return planned.sort((a, b) => a.timeSeconds - b.timeSeconds || a.trackId.localeCompare(b.trackId))
}
