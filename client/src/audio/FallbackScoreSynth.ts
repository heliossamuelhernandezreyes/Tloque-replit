import type { LinearScoreTrackV2 } from "@shared/tloque-score-v2"
import { scheduleOrchestralSynthVoice } from "./OrchestralSynthVoice"

export interface FallbackScoreEvent {
  timeSeconds: number
  durationSeconds: number
  notes: readonly number[]
  velocity: number
  articulation?: string
  timbre?: string
  durationIsPerformed?: boolean
}

/**
 * Bounded emergency voice used only for tracks whose native source cannot be
 * fetched or decoded. It shares the native track graph, stage and master.
 */
export function scheduleFallbackSynthVoice(
  context: BaseAudioContext,
  destination: AudioNode,
  startAt: number,
  event: FallbackScoreEvent,
  track: LinearScoreTrackV2,
) {
  const count = scheduleOrchestralSynthVoice(context, destination, startAt, event, track, 0.72)
  if (count < event.notes.length) throw new Error("La recuperación sintética supera el presupuesto de voces; reduce la polifonía o divide la obra por secciones")
  return count
}
