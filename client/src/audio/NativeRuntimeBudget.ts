import { buildNativeHybridPerformancePlan } from "@shared/native-hybrid-performance"
import type { LinearScoreRecipeV2 } from "@shared/tloque-score-v2"

export interface NativeRuntimeBudget {
  eventCount: number
  controlCount: number
  noteVoiceCount: number
  hybridVoiceCount: number
  peakNoteVoices: number
  peakHybridVoices: number
}

type Point = { time: number; delta: number }

function peakConcurrent(points: Point[]) {
  // Ends are applied before starts at the same timestamp: adjacent notes are not
  // considered concurrent merely because one ends exactly when the next begins.
  points.sort((a, b) => a.time - b.time || a.delta - b.delta)
  let active = 0
  let peak = 0
  for (const point of points) {
    active += point.delta
    if (active > peak) peak = active
  }
  return peak
}

/**
 * Pure score-side pressure measurement. It intentionally does not guess CPU time;
 * browser/device profiling can correlate these stable counts with real timings.
 */
export function measureNativeRuntimeBudget(recipe: LinearScoreRecipeV2): NativeRuntimeBudget {
  const notePoints: Point[] = []
  const hybridPoints: Point[] = []
  let noteVoiceCount = 0
  let hybridVoiceCount = 0

  for (const event of recipe.plan.events) {
    const voices = event.notes.length
    if (!voices) continue
    const start = event.timeSeconds
    const end = event.timeSeconds + Math.max(0, event.durationSeconds)
    noteVoiceCount += voices
    notePoints.push({ time: start, delta: voices }, { time: end, delta: -voices })

  }

  const hybridPerformance = buildNativeHybridPerformancePlan(recipe)
  for (const decision of hybridPerformance.decisions) {
    const voices = decision.midis.length
    const start = decision.event.timeSeconds
    const end = decision.event.timeSeconds + Math.max(0, decision.event.durationSeconds)
    hybridVoiceCount += voices
    hybridPoints.push({ time: start, delta: voices }, { time: end, delta: -voices })
  }

  return {
    eventCount: recipe.plan.events.length,
    controlCount: recipe.plan.controls.length,
    noteVoiceCount,
    hybridVoiceCount,
    peakNoteVoices: peakConcurrent(notePoints),
    peakHybridVoices: peakConcurrent(hybridPoints),
  }
}
