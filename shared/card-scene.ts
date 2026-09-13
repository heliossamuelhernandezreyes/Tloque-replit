import { z } from "zod"
import { CARD_LAYERS, CARD_REST, type CardLayer, type CardScene } from "./card-scene-runtime"
export * from "./card-scene-runtime"

const finite = (min: number, max: number) => z.number().finite().min(min).max(max)
const transform = z.object({ x: finite(-.6, .6), y: finite(-.6, .6), scale: finite(.5, 2), rotation: finite(-45, 45), opacity: finite(0, 1) }).strict()
const key = transform.extend({ time: finite(0, 12), ease: z.enum(["smooth", "cinematic", "ease-in", "ease-out", "linear", "hold"]) }).strict()
const layer = z.object({ transform, depth: finite(0, 1), keys: z.array(key).min(2).max(16) }).strict()
export const cardSceneSchema = z.object({
  version: z.literal("1.0.0"), duration: finite(3, 12),
  finish: z.object({ type: z.enum(["none", "foil", "prismatic"]), strength: finite(0, .6) }).strict(),
  layers: z.object({ back: layer, mid: layer, front: layer }).strict(),
}).strict().superRefine((scene, ctx) => {
  for (const name of CARD_LAYERS) {
    const keys = scene.layers[name].keys
    if (keys[0].time !== 0 || keys.at(-1)!.time !== scene.duration || keys.some((k, i) => k.time > scene.duration || i > 0 && k.time <= keys[i - 1].time)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["layers", name, "keys"], message: "Claves ordenadas, de 0 a la duración de la secuencia." })
    }
  }
})
const cache = new WeakMap<object, CardScene | null>()
export function readCardScene(value: unknown): CardScene | null {
  if (!value || typeof value !== "object") return null
  if (cache.has(value)) return cache.get(value)!
  const parsed = cardSceneSchema.safeParse(value)
  const scene = parsed.success ? parsed.data : null
  cache.set(value, scene)
  return scene
}
export const CARD_MOTION_PRESETS = {
  still: { name: "Composición", note: "Prepara el encuadre sin movimiento." },
  portrait: { name: "Retrato vivo", note: "Respiración visual y profundidad suave." },
  reveal: { name: "Revelación", note: "Anticipación, entrada escalonada y descanso." },
  drift: { name: "Viaje astral", note: "Capas en contramovimiento y acercamiento." },
} as const
export type CardMotionPreset = keyof typeof CARD_MOTION_PRESETS
export function createCardScene(): CardScene {
  const layers = Object.fromEntries(CARD_LAYERS.map((name, i) => [name, {
    transform: { ...CARD_REST, scale: name === "back" ? 1.08 : 1 }, depth: i / 2,
    keys: [0, 8].map(time => ({ ...CARD_REST, time, ease: "cinematic" as const })),
  }])) as CardScene["layers"]
  return { version: "1.0.0", duration: 8, finish: { type: "none", strength: .22 }, layers }
}
export function applyCardMotion(scene: CardScene, preset: CardMotionPreset): CardScene {
  const next = structuredClone(scene)
  for (const [i, name] of CARD_LAYERS.entries()) {
    const times = [0, .16 + i * .035, .48, .76, 1]
    next.layers[name].keys = times.map((t, k) => {
      const point = { ...CARD_REST, time: t === 1 ? next.duration : Number((t * next.duration).toFixed(3)), ease: "cinematic" as const }
      const depth = .3 + i * .35
      if (preset === "portrait") { point.y = [0, -.009, -.022, -.007, 0][k] * depth; point.scale = [1, 1.015, 1.035, 1.012, 1][k] }
      if (preset === "reveal") {
        point.y = [i ? .22 : .04, i ? .12 : .02, 0, -.006, 0][k]
        point.scale = [1.15, 1.08, 1.015, 1, 1][k]
        point.opacity = [i ? 0 : .7, i ? .3 : 1, 1, 1, 1][k]
        point.rotation = [i ? -5 : 0, i ? -2 : 0, 0, 0, 0][k]
      }
      if (preset === "drift") { point.x = [0, -.04, .055, -.02, 0][k] * depth * (i === 1 ? -1 : 1); point.y = [0, .008, -.018, .01, 0][k] * depth; point.scale = [1, 1.025, 1.07, 1.025, 1][k]; point.rotation = [0, -1, 1, -.5, 0][k] * depth }
      return point
    })
  }
  return cardSceneSchema.parse(next)
}
export function resizeCardDuration(scene: CardScene, duration: number): CardScene {
  const next = structuredClone(scene), ratio = duration / scene.duration
  next.duration = duration
  CARD_LAYERS.forEach(name => next.layers[name].keys.forEach((key, i, keys) => { key.time = i === keys.length - 1 ? duration : key.time * ratio }))
  return cardSceneSchema.parse(next)
}
export function setCardKey(scene: CardScene, layer: CardLayer, key: CardScene["layers"][CardLayer]["keys"][number]) {
  const next = structuredClone(scene), keys = next.layers[layer].keys
  const index = keys.findIndex(k => Math.abs(k.time - key.time) < .005)
  if (index >= 0) keys[index] = { ...key, time: keys[index].time }
  else keys.push(key)
  keys.sort((a, b) => a.time - b.time)
  return cardSceneSchema.parse(next)
}
