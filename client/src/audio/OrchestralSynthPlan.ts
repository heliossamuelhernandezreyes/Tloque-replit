import type { LinearScoreRecipeV2 } from "@shared/tloque-score-v2"
import { buildPerformancePlan, performedEventValues } from "./PerformanceEngine"
import { articulationDurationFactor, scorePedalReleaseTime } from "./ScoreAudioMath"

export type OrchestralSynthPlannedEvent = LinearScoreRecipeV2["plan"]["events"][number] & {
  durationIsPerformed: true
  legatoFromPrevious?: boolean
  transitionFromMidi?: number
  performancePhraseIndex: number
  performancePhraseStart: boolean
  performancePhraseEnd: boolean
}

export type OrchestralSynthRenderUnit =
  | { kind: "event"; timeSeconds: number; event: OrchestralSynthPlannedEvent }
  | { kind: "string-phrase"; timeSeconds: number; events: OrchestralSynthPlannedEvent[] }

function canUseContinuousStringVoice(instrument: string, event: OrchestralSynthPlannedEvent) {
  return instrument.startsWith("strings.")
    && instrument !== "strings.harp"
    && event.notes.length === 1
    && !["pizzicato", "harmonic"].includes(event.articulation)
}

/** The same phrase director serves recorded and synthesized instruments. Empty
 * manifests mean no fabricated sample, true-legato or keyswitch capabilities. */
export function buildOrchestralSynthPlan(recipe: LinearScoreRecipeV2, trackIds: ReadonlySet<string>) {
  const performance = buildPerformancePlan(recipe, [])
  const previousByTrack = new Map<string, LinearScoreRecipeV2["plan"]["events"][number]>()
  const planned: OrchestralSynthPlannedEvent[] = []
  for (let eventIndex = 0; eventIndex < recipe.plan.events.length; eventIndex += 1) {
    const event = recipe.plan.events[eventIndex]
    if (!trackIds.has(event.trackId)) continue
    const decision = performance.decisionForEvent(eventIndex)
    const performed = performedEventValues(recipe, event, decision)
    const timeSeconds = performed.startSeconds
    const duration = performed.durationSeconds * articulationDurationFactor(event.articulation)
    const track = recipe.plan.tracks.find(item => item.id === event.trackId)
    const pedalEnd = track?.instrument === "piano.grand" ? scorePedalReleaseTime(recipe, event.trackId, timeSeconds + duration) : timeSeconds + duration
    const previous = previousByTrack.get(event.trackId)
    const authoredGap = previous ? event.timeSeconds - (previous.timeSeconds + previous.durationSeconds) : Infinity
    const transitionFromMidi = previous?.notes.length === 1 ? previous.notes[0] : undefined
    const linked = (decision?.articulation ?? event.articulation) === "legato"
      && decision?.phraseStart === false
      && event.notes.length === 1
      && transitionFromMidi !== undefined
      && event.notes[0] !== transitionFromMidi
      && authoredGap >= -0.12
      && authoredGap <= 0.09
      && Math.abs(event.notes[0] - transitionFromMidi) <= 12
    planned.push({
      ...event,
      articulation: decision?.articulation ?? event.articulation,
      timeSeconds,
      durationIsPerformed: true,
      durationSeconds: Math.max(duration, pedalEnd - timeSeconds),
      velocity: performed.velocity,
      performancePhraseIndex: decision?.phraseIndex ?? eventIndex,
      performancePhraseStart: decision?.phraseStart ?? true,
      performancePhraseEnd: decision?.phraseEnd ?? true,
      ...(linked ? { legatoFromPrevious: true, transitionFromMidi } : {}),
    })
    previousByTrack.set(event.trackId, event)
  }
  return planned.sort((a, b) => a.timeSeconds - b.timeSeconds || a.trackId.localeCompare(b.trackId))
}

/** Collapse only explicitly connected monophonic string events into one physical
 * voice. Chords, rests, phrase boundaries and unsupported gestures remain
 * independent render units, so grouping never rewrites authored notes. */
export function buildOrchestralSynthRenderUnits(recipe: LinearScoreRecipeV2, trackIds: ReadonlySet<string>): OrchestralSynthRenderUnit[] {
  const tracks = new Map(recipe.plan.tracks.map(track => [track.id, track]))
  const units: OrchestralSynthRenderUnit[] = []
  const activePhraseByTrack = new Map<string, Extract<OrchestralSynthRenderUnit, { kind: "string-phrase" }>>()

  for (const event of buildOrchestralSynthPlan(recipe, trackIds)) {
    const track = tracks.get(event.trackId)
    if (!track || !canUseContinuousStringVoice(track.instrument, event)) {
      activePhraseByTrack.delete(event.trackId)
      units.push({ kind: "event", timeSeconds: event.timeSeconds, event })
      continue
    }

    const active = activePhraseByTrack.get(event.trackId)
    const continues = Boolean(
      active
      && event.legatoFromPrevious
      && !event.performancePhraseStart
      && active.events.at(-1)?.performancePhraseIndex === event.performancePhraseIndex,
    )
    if (continues) active!.events.push(event)
    else {
      const phrase: Extract<OrchestralSynthRenderUnit, { kind: "string-phrase" }> = {
        kind: "string-phrase",
        timeSeconds: event.timeSeconds,
        events: [event],
      }
      units.push(phrase)
      activePhraseByTrack.set(event.trackId, phrase)
    }
    if (event.performancePhraseEnd) activePhraseByTrack.delete(event.trackId)
  }

  return units.sort((left, right) => left.timeSeconds - right.timeSeconds
    || (left.kind === "event" ? left.event.trackId : left.events[0].trackId)
      .localeCompare(right.kind === "event" ? right.event.trackId : right.events[0].trackId))
}
