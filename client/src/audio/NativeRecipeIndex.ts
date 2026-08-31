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
  const expression = nativeControlValueAt(controls, "expression", timeSeconds, track.expression)
  const brightness = nativeControlValueAt(controls, "brightness", timeSeconds, track.brightness)
  const vibrato = nativeControlValueAt(controls, "vibrato", timeSeconds, track.vibrato)
  return { ...track, expression, brightness, vibrato }
}

/** A new ramp begins at the interpolated value of the previous ramp, not at its
 * future target. Authored crescendo/bend automation therefore never jumps early. */
type ControlSegment = { from: number; target: number; start: number; ramp: number }
const numericCurves = new WeakMap<readonly ScoreControl[], Map<string, readonly ControlSegment[]>>()
function segmentValue(segment: ControlSegment, time: number) {
  return segment.ramp > 0 ? segment.from + (segment.target - segment.from) * Math.max(0, Math.min(1, (time - segment.start) / segment.ramp)) : segment.target
}
export function nativeControlValueAt(controls: readonly ScoreControl[], axis: "expression" | "brightness" | "vibrato" | "pitchBend", timeSeconds: number, initial: number) {
  let cached = numericCurves.get(controls)
  if (!cached) { cached = new Map(); numericCurves.set(controls, cached) }
  const key = `${axis}:${initial}`
  let segments = cached.get(key)
  if (!segments) {
    const compiled: ControlSegment[] = []
    for (const control of controls) {
      const target = control[axis]
      if (target === null) continue
      const previous = compiled[compiled.length - 1]
      compiled.push({ from: previous ? segmentValue(previous, control.timeSeconds) : initial, target, start: control.timeSeconds, ramp: control.rampSeconds })
    }
    segments = compiled; cached.set(key, segments)
  }
  let low = 0, high = segments.length
  while (low < high) { const middle = (low + high) >>> 1; if (segments[middle].start <= timeSeconds) low = middle + 1; else high = middle }
  return low === 0 ? initial : segmentValue(segments[low - 1], timeSeconds)
}
