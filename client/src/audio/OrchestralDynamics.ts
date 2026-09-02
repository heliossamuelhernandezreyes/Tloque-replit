import type { LinearScoreControlV2, LinearScoreTrackV2 } from "@shared/tloque-score-v2"
import { orchestralTimbreFor } from "@shared/orchestral-synthesis"
import { nativeControlValueAt } from "./NativeRecipeIndex"

export const ORCHESTRAL_DYNAMICS_VERSION = "tloque-orchestral-dynamics-v2" as const
export const ORCHESTRAL_DYNAMICS_HZ = 32
export const ORCHESTRAL_DYNAMICS_MAX_POINTS = 4096

export interface OrchestralContinuousDynamics {
  readonly version: 2
  readonly instrument: string
  readonly durationSeconds: number
  readonly sustained: boolean
  readonly effort: Float32Array
  readonly brightness: Float32Array
}

function clamp01(value: number) { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) }

/**
 * Resolve authored velocity, expression and brightness over the complete held
 * note. The curve is an intentionally bounded musical heuristic: it models the
 * audible tendency of acoustic effort to add upper-partial energy, but it is not
 * a calibrated physical model or a replacement for recorded dynamic layers.
 */
export function orchestralContinuousDynamics(
  track: LinearScoreTrackV2,
  controls: readonly LinearScoreControlV2[],
  startSeconds: number,
  durationSeconds: number,
  velocity: number,
  articulation = "normal",
): OrchestralContinuousDynamics {
  const duration = Math.max(0.01, Number.isFinite(durationSeconds) ? durationSeconds : 0.01)
  const profile = orchestralTimbreFor(track.instrument)
  const sustained = profile.decay === 0 && duration >= 0.28 && !["staccato", "spiccato", "pizzicato"].includes(articulation)
  const count = Math.max(2, Math.min(ORCHESTRAL_DYNAMICS_MAX_POINTS, Math.ceil(duration * ORCHESTRAL_DYNAMICS_HZ) + 1))
  const effort = new Float32Array(count)
  const brightness = new Float32Array(count)
  const struckVelocity = clamp01(velocity)

  for (let index = 0; index < count; index += 1) {
    const x = index / (count - 1)
    const localSeconds = x * duration
    const timeSeconds = startSeconds + localSeconds
    const expression = clamp01(nativeControlValueAt(controls, "expression", timeSeconds, track.expression))
    const authoredBrightness = clamp01(nativeControlValueAt(controls, "brightness", timeSeconds, track.brightness))
    const onsetBloom = sustained ? 0.94 + 0.06 * Math.min(1, localSeconds / 0.18) : 1
    const phraseArc = sustained ? 0.035 * Math.sin(Math.PI * x) : 0
    const acousticEffort = clamp01((0.08 + 0.51 * struckVelocity ** 0.72 + 0.41 * expression + phraseArc) * onsetBloom)
    effort[index] = acousticEffort
    brightness[index] = clamp01(0.04 + 0.42 * authoredBrightness + 0.54 * acousticEffort)
  }

  return { version: 2, instrument: track.instrument, durationSeconds: duration, sustained, effort, brightness }
}

/** Nyquist-safe timbral curve. Recorded material receives a deliberately gentler
 * range than synthesis so this layer does not pretend to manufacture missing
 * sample dynamics; it only follows authored colour during a sustain. */
export function orchestralDynamicCutoffCurve(
  dynamics: OrchestralContinuousDynamics,
  sampleRate: number,
  source: "synth" | "recorded",
): Float32Array {
  const profile = orchestralTimbreFor(dynamics.instrument)
  const nyquistSafe = Math.max(250, sampleRate * 0.44)
  const desiredFloor = source === "recorded" ? 3_600 : Math.max(720, Math.min(2_200, profile.formantHz * 0.62))
  const floor = Math.min(nyquistSafe, desiredFloor)
  const desiredCeiling = source === "recorded" ? 18_500 : Math.max(9_000, Math.min(15_500, profile.formantHz * 5.4))
  const ceiling = Math.max(floor, Math.min(nyquistSafe, desiredCeiling))
  return Float32Array.from(dynamics.brightness, amount => floor + (ceiling - floor) * clamp01(amount) ** 1.28)
}
