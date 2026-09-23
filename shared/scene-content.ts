import { z } from "zod"

export const MODEL_MAX_BYTES = 20 * 1024 * 1024
export const SCENE_MAX_SECONDS = 1200
export const MODEL_ANIMATION_MAX_SECONDS = 120
export const MODEL_SOURCE = /^\/api\/visual\/models\/[a-f0-9]{64}\.glb$/
export const SHAPES = { sphere: "Esfera", box: "Bloque", crystal: "Cristal", ring: "Anillo", cone: "Cono", cylinder: "Columna" } as const
export const EFFECTS = { none: "Sin efecto", rain: "Lluvia", fire: "Llamas", snow: "Nieve", embers: "Brasas", smoke: "Niebla", sparkle: "Destellos" } as const
const color = z.string().regex(/^#[a-f\d]{6}$/i)
const vector = (min: number, max: number) => z.object({ x: z.number().finite().min(min).max(max), y: z.number().finite().min(min).max(max), z: z.number().finite().min(min).max(max) }).strict()
const base = {
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), name: z.string().min(1).max(80),
  placement: z.enum(["scene", "frame"]), position: vector(-1.5, 1.5), rotation: vector(-180, 180), scale: vector(.03, 3),
  motion: z.enum(["still", "spin", "float"]), speed: z.number().finite().min(.1).max(2),
}
export const modelClipSchema = z.object({ name: z.string().max(128), duration: z.number().finite().min(0).max(MODEL_ANIMATION_MAX_SECONDS) }).strict()
export const sceneObjectSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("shape"), shape: z.enum(["sphere", "box", "crystal", "ring", "cone", "cylinder"]), color, metalness: z.number().min(0).max(1), roughness: z.number().min(.04).max(1) }).strict(),
  z.object({ ...base, kind: z.literal("model"), source: z.string().regex(MODEL_SOURCE), clips: z.array(modelClipSchema).max(24), clip: z.number().int().min(-2).max(23), loop: z.boolean() }).strict(),
])
export const sceneContentSchema = z.object({
  background: color,
  objects: z.array(sceneObjectSchema).max(16),
  glass: z.object({ enabled: z.boolean(), tint: color, opacity: z.number().min(0).max(.6), roughness: z.number().min(.04).max(1) }).strict(),
  effect: z.object({ type: z.enum(["none", "rain", "fire", "snow", "embers", "smoke", "sparkle"]), intensity: z.number().min(0).max(1), speed: z.number().min(.1).max(2), color }).strict(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.objects.map(o => o.id)).size !== value.objects.length || value.objects.filter(o => o.kind === "model").length > 2) ctx.addIssue({ code: "custom", message: "Usa identificadores únicos y hasta dos modelos importados." })
  value.objects.forEach((o, i) => { if (o.kind === "model" && o.clip >= o.clips.length) ctx.addIssue({ code: "custom", path: ["objects", i, "clip"], message: "La animación no existe en el modelo." }) })
})
export type SceneContent = z.infer<typeof sceneContentSchema>
export type SceneObject = z.infer<typeof sceneObjectSchema>
export const createSceneContent = (): SceneContent => ({ background: "#090c19", objects: [], glass: { enabled: false, tint: "#c8deff", opacity: .22, roughness: .12 }, effect: { type: "none", intensity: .5, speed: 1, color: "#badbff" } })
export function createShape(shape: keyof typeof SHAPES, id: string, placement: "scene" | "frame" = "scene"): Extract<SceneObject, { kind: "shape" }> {
  return { id, name: SHAPES[shape], kind: "shape", shape, placement, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: .7, y: .7, z: .7 }, color: "#b8a4f2", metalness: .65, roughness: .24, motion: "still", speed: 1 }
}
/** Only topology belongs in the GPU key; dragging a control never reloads a model. */
export const contentGeometryKey = (content?: SceneContent) => content?.objects.map(o => [o.id, o.kind, o.kind === "model" ? o.source : o.shape, o.placement])
export function contentDuration(content: SceneContent): number {
  return Math.min(SCENE_MAX_SECONDS, Math.max(3, ...content.objects.flatMap(o => o.kind === "model" && o.clip !== -1 ? (o.clip === -2 ? o.clips : o.clips.slice(o.clip, o.clip + 1)).map(c => c.duration / o.speed) : [])))
}
