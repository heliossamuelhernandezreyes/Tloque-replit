import type { LinearScoreRecipeV2 } from "@shared/tloque-score-v2"
import { buildPerformancePlan } from "./PerformanceEngine"
import { articulationDurationFactor, scorePedalReleaseTime } from "./ScoreAudioMath"

/** The same phrase director serves recorded and synthesized instruments. Empty
 * manifests mean no fabricated sample, true-legato or keyswitch capabilities. */
export function buildOrchestralSynthPlan(recipe: LinearScoreRecipeV2, trackIds: ReadonlySet<string>) {
  const performance = buildPerformancePlan(recipe, [])
  return recipe.plan.events.flatMap((event, eventIndex) => {
    if (!trackIds.has(event.trackId)) return []
    const decision = performance.decisionForEvent(eventIndex)
    const timeSeconds = Math.max(0, event.timeSeconds + (decision?.startOffsetSeconds ?? 0))
    const duration = event.durationSeconds * (decision?.durationScale ?? 1) * articulationDurationFactor(event.articulation)
    const track = recipe.plan.tracks.find(item => item.id === event.trackId)
    const pedalEnd = track?.instrument === "piano.grand" ? scorePedalReleaseTime(recipe, event.trackId, timeSeconds + duration) : timeSeconds + duration
    return [{ ...event, timeSeconds, durationIsPerformed: true, durationSeconds: Math.max(duration, pedalEnd - timeSeconds), velocity: Math.max(0.01, Math.min(1, event.velocity * (decision?.velocityScale ?? 1))) }]
  }).sort((a, b) => a.timeSeconds - b.timeSeconds || a.trackId.localeCompare(b.trackId))
}
