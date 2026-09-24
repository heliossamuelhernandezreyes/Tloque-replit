import { easeMotion, type MotionEase } from "./motion-easing"
import type { SceneContent } from "./scene-content"
import type { PortalCard } from "./portal-card"

export const CARD_LAYERS = ["back", "mid", "front"] as const
export type CardLayer = typeof CARD_LAYERS[number]
export const CARD_LAYER_LABELS = { back: "Fondo", mid: "Capa media", front: "Primer plano" }
export interface CardTransform { x: number; y: number; scale: number; rotation: number; opacity: number }
export interface CardKey extends CardTransform { time: number; ease: MotionEase }
export interface CardScene {
  version: "1.0.0"
  duration: number
  content?: SceneContent
  portalCard?: PortalCard
  finish: { type: "none" | "foil" | "prismatic"; strength: number }
  layers: Record<CardLayer, { transform: CardTransform; depth: number; keys: CardKey[] }>
}
export const CARD_REST: CardTransform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }

/** A key is an offset from the composition. Presets never move the base artwork. */
export function evaluateCardOffset(scene: CardScene, layer: CardLayer, seconds: number): CardTransform {
  const { keys } = scene.layers[layer]
  const time = Math.max(0, Math.min(scene.duration, Number.isFinite(seconds) ? seconds : 0))
  const next = keys.findIndex(key => key.time >= time)
  const a = keys[Math.max(0, next - 1)], b = keys[Math.max(0, next)]
  const blend = b.time === a.time ? 0 : easeMotion((time - a.time) / (b.time - a.time), b.ease)
  const value = (key: keyof CardTransform) => a[key] + (b[key] - a[key]) * blend
  return { x: value("x"), y: value("y"), scale: value("scale"), rotation: value("rotation"), opacity: value("opacity") }
}
export function evaluateCardLayer(scene: CardScene, layer: CardLayer, seconds: number, inspection = true): CardTransform {
  const { transform } = scene.layers[layer]
  if (!inspection) return { ...transform }
  const offset = evaluateCardOffset(scene, layer, seconds)
  return { x: transform.x + offset.x, y: transform.y + offset.y, scale: transform.scale * offset.scale, rotation: transform.rotation + offset.rotation, opacity: transform.opacity * offset.opacity }
}

/** Matches the 3D rest composition; DOM posters need no GPU or animation loop. */
export function cardLayerStyle(scene: CardScene, layer: CardLayer) {
  const t = scene.layers[layer].transform
  return { transform: `translate(${t.x * 100}%, ${t.y * 100}%) rotate(${t.rotation}deg) scale(${t.scale})`, opacity: t.opacity }
}
