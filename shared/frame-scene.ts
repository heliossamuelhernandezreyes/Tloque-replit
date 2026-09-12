import { z } from "zod"
import { visualFrame } from "./visual-experience"

/** Portable art direction, never executable code or arbitrary GPU programs. */
export const FRAME_SCENE_VERSION = "2.0.0"
export const FRAME_CHANNELS = {
  orbit: { label: "Órbita de cámara", min: -80, max: 80, step: 1 },
  tilt: { label: "Inclinación", min: -35, max: 35, step: 1 },
  zoom: { label: "Acercamiento", min: .8, max: 1.3, step: .01 },
  assembly: { label: "Despliegue", min: 0, max: 1, step: .01 },
  aperture: { label: "Apertura del portal", min: 0, max: 1, step: .01 },
  energy: { label: "Energía", min: 0, max: 1, step: .01 },
} as const
export type FrameChannel = keyof typeof FRAME_CHANNELS
const finite = (min: number, max: number) => z.number().finite().min(min).max(max)
const color = z.string().regex(/^#[a-f\d]{6}$/i)
const point = z.object({ time: finite(0, 12), value: z.number().finite(), ease: z.enum(["linear", "smooth"]) }).strict()
const tracks = Object.fromEntries(Object.entries(FRAME_CHANNELS).map(([key, bounds]) => [key,
  z.array(point.extend({ value: finite(bounds.min, bounds.max) })).min(2).max(16),
])) as unknown as { [K in FrameChannel]: z.ZodArray<z.ZodType<{ time: number; value: number; ease: "linear" | "smooth" }>> }

export const frameSceneSchema = z.object({
  version: z.literal(FRAME_SCENE_VERSION),
  style: z.enum(["astral", "reliquary", "bloom"]),
  geometry: z.object({ width: finite(.06, .2), depth: finite(.04, .22), radius: finite(.05, .3), ornaments: z.number().int().min(4).max(16) }).strict(),
  material: z.object({ color, accent: color, metalness: finite(0, 1), roughness: finite(.12, 1), glow: finite(0, 1.5) }).strict(),
  lighting: z.object({ key: color, rim: color, intensity: finite(.5, 5) }).strict(),
  portal: z.object({ enabled: z.boolean(), color, depth: finite(.2, 1), particles: z.number().int().min(0).max(96), speed: finite(0, 1) }).strict(),
  animation: z.object({ duration: finite(3, 12), tracks: z.object(tracks).strict() }).strict(),
}).strict().superRefine((scene, ctx) => {
  for (const [channel, keys] of Object.entries(scene.animation.tracks)) {
    if (keys[0]?.time !== 0 || keys.at(-1)?.time !== scene.animation.duration || keys.some((key, i) => key.time > scene.animation.duration || i > 0 && key.time <= keys[i - 1].time)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["animation", "tracks", channel], message: "Las claves deben estar ordenadas, empezar en 0 y terminar en la duración." })
    }
  }
})
export type FrameScene = z.infer<typeof frameSceneSchema>
export type FramePose = Record<FrameChannel, number>
export type FrameTarget = "card" | "profile" | "both"
export interface SceneTransport { time: number; mode: "idle" | "inspection" }

const cache = new WeakMap<object, FrameScene | null>()
export function readFrameScene(pkg: unknown): FrameScene | null {
  if (!pkg || typeof pkg !== "object") return null
  if (cache.has(pkg)) return cache.get(pkg)!
  const result = frameSceneSchema.safeParse((pkg as { scene?: unknown }).scene)
  const scene = result.success ? result.data : null
  cache.set(pkg, scene)
  return scene
}

/** Absolute-time evaluation: seek, pause and replay do not accumulate simulation drift. */
export function evaluateFrameScene(scene: FrameScene, seconds: number): FramePose {
  const time = Math.max(0, Math.min(scene.animation.duration, Number.isFinite(seconds) ? seconds : 0))
  return Object.fromEntries(Object.entries(scene.animation.tracks).map(([channel, keys]) => {
    let next = keys.findIndex(key => key.time >= time)
    if (next <= 0) return [channel, keys[0].value]
    const a = keys[next - 1], b = keys[next]
    const progress = (time - a.time) / (b.time - a.time)
    const eased = b.ease === "smooth" ? progress * progress * (3 - 2 * progress) : progress
    return [channel, a.value + (b.value - a.value) * eased]
  })) as FramePose
}

export function createFrameScene(style: FrameScene["style"] = "astral"): FrameScene {
  const keys = (values: number[]) => values.map((value, i) => ({ time: [0, 1.2, 2.6, 4.4, 6.4, 8][i], value, ease: "smooth" as const }))
  const palettes = {
    astral: ["#c9b88a", "#93bfff", "#29377f"],
    reliquary: ["#c99650", "#ffb875", "#4e2940"],
    bloom: ["#a590bd", "#ff6bbc", "#55205b"],
  }
  const [base, accent, portal] = palettes[style]
  return {
    version: FRAME_SCENE_VERSION, style,
    geometry: { width: .1, depth: .12, radius: .16, ornaments: style === "bloom" ? 12 : 8 },
    material: { color: base, accent, metalness: .88, roughness: .25, glow: .65 },
    lighting: { key: "#fff0d7", rim: accent, intensity: 3.5 },
    portal: { enabled: true, color: portal, depth: .75, particles: 72, speed: .35 },
    animation: { duration: 8, tracks: {
      orbit: keys([0, -24, 32, -42, 18, 0]), tilt: keys([0, 10, -12, 8, -5, 0]),
      zoom: keys([1, 1.06, 1.12, .92, 1.06, 1]), assembly: keys([0, .85, 1, .6, .15, 0]),
      aperture: keys([1, .25, 1, 1, 1, 1]), energy: keys([.35, .6, 1, .65, .5, .35]),
    } },
  }
}

/** Creates a NEW version. Legacy originals are never rewritten or silently replaced. */
export function sceneFromLegacy(pkg: unknown): FrameScene {
  const native = readFrameScene(pkg)
  if (native) return structuredClone(native)
  const scene = createFrameScene()
  const legacy = visualFrame(pkg)
  scene.material.color = legacy.color
  scene.material.metalness = legacy.metalness
  scene.material.roughness = legacy.roughness
  scene.geometry.width = Math.max(.06, Math.min(.2, legacy.thickness))
  scene.geometry.radius = Math.max(.05, Math.min(.3, legacy.radius))
  return scene
}

export function packageFrameScene(scene: FrameScene, name: string, target: FrameTarget) {
  const canonical = frameSceneSchema.parse(scene)
  return {
    schemaVersion: FRAME_SCENE_VERSION, renderer: "tloque-scene-v2", scene: canonical,
    // A poster-compatible subset keeps old clients readable; v2 consumers use scene.
    runtimePreset: { schemaVersion: FRAME_SCENE_VERSION, target, name: name.slice(0, 60), appearance: {
      material: { baseColor: canonical.material.color, metalness: canonical.material.metalness, roughness: canonical.material.roughness },
      geometry: { thickness: { top: canonical.geometry.width * 500 }, corners: { tl: canonical.geometry.radius * 500 } },
    } },
  }
}

/** Renderer rebuilds only when topology, texture sources or portal allocation changes. */
export function frameGeometryKey(scene: FrameScene) {
  return [scene.style, scene.geometry, scene.portal.enabled, scene.portal.particles]
}
