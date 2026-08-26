import type { LinearScoreRecipeV2, LinearScoreTrackV2 } from "@shared/tloque-score-v2"

type ScoreControl = LinearScoreRecipeV2["plan"]["controls"][number]
type ScoreEvent = LinearScoreRecipeV2["plan"]["events"][number]

export interface NativeRecipeIndex {
  readonly trackById: ReadonlyMap<string, LinearScoreTrackV2>
  readonly controlsByTrack: ReadonlyMap<string, readonly ScoreControl[]>
  readonly eventsByTrack: ReadonlyMap<string, readonly ScoreEvent[]>
  readonly chronologicalEvents: readonly ScoreEvent[]
}

/** Build all hot-path lookup tables in a single linear pass. */
export function buildNativeRecipeIndex(recipe: LinearScoreRecipeV2): NativeRecipeIndex {
  const trackById = new Map(recipe.plan.tracks.map(track => [track.id, track]))
  const controlsByTrack = new Map<string, ScoreControl[]>()
  const eventsByTrack = new Map<string, ScoreEvent[]>()

  for (const track of recipe.plan.tracks) {
    controlsByTrack.set(track.id, [])
    eventsByTrack.set(track.id, [])
  }
  for (const control of recipe.plan.controls) {
    const bucket = controlsByTrack.get(control.trackId)
    if (bucket) bucket.push(control)
  }
  for (const event of recipe.plan.events) {
    const bucket = eventsByTrack.get(event.trackId)
    if (bucket) bucket.push(event)
  }
  for (const controls of controlsByTrack.values()) controls.sort((a, b) => a.timeSeconds - b.timeSeconds)
  for (const events of eventsByTrack.values()) events.sort((a, b) => a.timeSeconds - b.timeSeconds)

  return {
    trackById,
    controlsByTrack,
    eventsByTrack,
    chronologicalEvents: [...recipe.plan.events].sort((a, b) => a.timeSeconds - b.timeSeconds),
  }
}

/** Resolve only the track-level axes required by physical/hybrid scheduling. */
export function nativeTrackAtTime(
  track: LinearScoreTrackV2,
  controls: readonly ScoreControl[],
  timeSeconds: number,
): LinearScoreTrackV2 {
  let expression = track.expression
  let brightness = track.brightness
  let vibrato = track.vibrato
  for (const control of controls) {
    if (control.timeSeconds > timeSeconds) break
    if (control.expression !== null) expression = control.expression
    if (control.brightness !== null) brightness = control.brightness
    if (control.vibrato !== null) vibrato = control.vibrato
  }
  return { ...track, expression, brightness, vibrato }
}
