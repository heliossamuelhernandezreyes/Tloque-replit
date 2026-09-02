export const ORCHESTRAL_ROOM_VERSION = "tloque-concert-stage-v3" as const
export const ORCHESTRAL_ROOM_MAX_SECONDS = 3.6
export interface StageReflection { delaySeconds: number; gain: number; pan: number }

/** Two-slope late-field envelope with a gradual density bloom. This is original
 * room design, not a measured hall response. */
export function orchestralLateFieldEnvelope(timeSeconds: number, seconds: number, decay: number) {
  const time = Math.max(0, timeSeconds)
  const boundedSeconds = Math.max(0.1, Math.min(ORCHESTRAL_ROOM_MAX_SECONDS, seconds))
  if (time >= boundedSeconds) return 0
  const bloom = 1 - Math.exp(-time * 10.5)
  const earlySlope = Math.exp(-time * decay * 1.34)
  const lateSlope = Math.exp(-time * decay * 0.86)
  const tailWindow = Math.min(1, Math.max(0, (boundedSeconds - time) / 0.12))
  return bloom * (0.58 * earlySlope + 0.42 * lateSlope) * tailWindow
}

/** Original image-source approximation of a 24 m wide stage/room. Reflection
 * timing is relative to the direct source, not an extra delay on the whole mix.
 * This is a designed stereo hall, not a measured IR or personalized binaural HRTF. */
export function orchestralEarlyReflections(pan: number, depth: number): readonly StageReflection[] {
  const x = Math.max(-1, Math.min(1, pan)) * 8
  const z = 7 + Math.max(0, Math.min(1, depth)) * 8
  const direct = Math.hypot(x, z, 0.3)
  const images = [
    { x: -24 - x, z, height: 0.3, absorption: 0.20 },
    { x: 24 - x, z, height: 0.3, absorption: 0.20 },
    { x, z: 40 - z, height: 0.3, absorption: 0.14 },
    { x, z, height: 17.3, absorption: 0.13 },
  ]
  return images.map(image => {
    const path = Math.hypot(image.x, image.z, image.height)
    return {
      delaySeconds: Math.max(0.001, (path - direct) / 343),
      gain: image.absorption * direct / path,
      pan: Math.max(-0.92, Math.min(0.92, image.x / Math.hypot(image.x, image.z))),
    }
  }).sort((a, b) => a.delaySeconds - b.delaySeconds)
}
