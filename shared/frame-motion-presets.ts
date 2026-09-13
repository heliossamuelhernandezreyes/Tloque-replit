import { frameSceneSchema, type FrameChannel, type FrameScene } from "./frame-scene"

export const FRAME_MOTION_PRESETS = { orbit: "Inspección orbital", awaken: "Despertar del relicario", blossom: "Floración ceremonial" } as const
export function applyFrameMotion(scene: FrameScene, preset: keyof typeof FRAME_MOTION_PRESETS): FrameScene {
  const next = structuredClone(scene)
  const choreography: Record<keyof typeof FRAME_MOTION_PRESETS, Record<FrameChannel, number[]>> = {
    orbit: { orbit: [0, -12, 32, -38, 14, 0], tilt: [0, 4, -10, 8, -3, 0], zoom: [1, .96, 1.12, 1.04, 1.07, 1], assembly: [0, .08, .35, .35, .1, 0], aperture: [1, 1, 1, 1, 1, 1], energy: [.35, .25, .65, .85, .5, .35] },
    awaken: { orbit: [0, -5, -16, 24, 8, 0], tilt: [0, -5, 7, -10, 3, 0], zoom: [1, .94, .94, 1.1, 1.04, 1], assembly: [0, .12, 1, .85, .15, 0], aperture: [1, .15, .05, 1, 1, 1], energy: [.35, .2, .45, 1, .55, .35] },
    blossom: { orbit: [0, -4, 10, -14, 6, 0], tilt: [0, -6, 8, -6, 2, 0], zoom: [1, .92, .96, 1.04, 1.07, 1], assembly: [0, .06, .45, 1, .4, 0], aperture: [1, .35, .6, 1, 1, 1], energy: [.35, .22, .55, .9, .65, .35] },
  }
  for (const channel of Object.keys(choreography[preset]) as FrameChannel[]) {
    next.animation.tracks[channel] = choreography[preset][channel].map((value, i) => ({
      time: i === 5 ? scene.animation.duration : [0, .15, .32, .56, .8][i] * scene.animation.duration,
      value, ease: "cinematic",
    }))
  }
  return frameSceneSchema.parse(next)
}
