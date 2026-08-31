export const ORCHESTRAL_ROOM_VERSION = "tloque-concert-stage-v2" as const
export interface StageReflection { delaySeconds: number; gain: number; pan: number }

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
