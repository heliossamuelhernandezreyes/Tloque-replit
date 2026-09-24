import { z } from "zod"

const unit = z.number().finite().min(0).max(1)
const range = (min: number, max: number) => z.number().finite().min(min).max(max)
const color = z.string().regex(/^#[a-f\d]{6}$/i)
export const PORTAL_WEATHER = { none: "Sin efecto", rain: "Lluvia", snow: "Nieve", mist: "Niebla", embers: "Brasas", fire: "Llamas", dust: "Polvo", magic: "Luz mágica" } as const
export const WEATHER_ZONES = ["Detrás de la capa media", "Entre la capa media y el primer plano", "Delante del primer plano"] as const
export const weatherZoneSchema = z.object({
  type: z.enum(["none", "rain", "snow", "mist", "embers", "fire", "dust", "magic"]),
  color, intensity: unit, size: range(.25, 2.5), speed: range(.1, 2), wind: range(-1, 1), depth: unit,
}).strict()

/** A portable recipe, with bounded costs and no executable shader/HTML content. */
export const portalCardSchema = z.object({
  version: z.literal("1.0.0"),
  inheritFrameFinish: z.boolean().optional(),
  frame: z.object({ width: range(.035, .28), thickness: range(.035, .3), radius: range(.04, .32), bevel: range(.003, .035), color, metalness: unit, roughness: range(.08, 1), lightColor: color, glow: unit, pulse: unit }).strict(),
  back: z.object({ color, ink: color, title: z.string().max(64), inscription: z.string().max(140), signature: z.string().max(72), treatment: z.enum(["engraved", "raised", "printed"]) }).strict(),
  mica: z.object({ enabled: z.boolean(), finish: z.enum(["clear", "satin", "foil", "holographic"]), tint: color, reflection: unit, strength: unit, surface: z.enum(["dry", "drops", "fog", "frost"]), amount: unit }).strict(),
  world: z.object({ depth: unit, curvature: range(0, .5), background: color }).strict(),
  weather: z.tuple([weatherZoneSchema, weatherZoneSchema, weatherZoneSchema]),
}).strict()
export type PortalCard = z.infer<typeof portalCardSchema>
export type WeatherZone = z.infer<typeof weatherZoneSchema>
export type CardOrientation = { yaw: number; pitch: number; zoom: number }
export const FRAME_MATERIALS = {
  gold: { label: "Oro", color: "#c7a660", metalness: .88, roughness: .26 },
  silver: { label: "Plata", color: "#c6cfda", metalness: .92, roughness: .22 },
  bronze: { label: "Bronce", color: "#a97850", metalness: .8, roughness: .38 },
  obsidian: { label: "Obsidiana", color: "#242332", metalness: .35, roughness: .18 },
  porcelain: { label: "Porcelana", color: "#efe8d8", metalness: .08, roughness: .3 },
  matte: { label: "Grafito mate", color: "#303842", metalness: .15, roughness: .75 },
} as const

export function createPortalCard(): PortalCard {
  const zone = (): WeatherZone => ({ type: "none", color: "#d4e6ff", intensity: .35, size: 1, speed: .65, wind: .1, depth: .5 })
  return {
    version: "1.0.0",
    inheritFrameFinish: true,
    frame: { width: .09, thickness: .12, radius: .16, bevel: .016, color: "#c7a660", metalness: .88, roughness: .26, lightColor: "#bad7ff", glow: 0, pulse: 0 },
    back: { color: "#17212c", ink: "#cab585", title: "TLOQUE", inscription: "Una puerta hacia otra historia", signature: "", treatment: "engraved" },
    mica: { enabled: true, finish: "clear", tint: "#edf7ff", reflection: .3, strength: .35, surface: "dry", amount: .35 },
    world: { depth: .55, curvature: .18, background: "#101c29" },
    weather: [zone(), zone(), zone()],
  }
}
export function withPortalWeather(value: PortalCard, type: WeatherZone["type"]): PortalCard {
  const next = structuredClone(value)
  const warm = type === "fire" || type === "embers"
  next.weather.forEach((zone, i) => Object.assign(zone, { type, color: warm ? "#ff985e" : type === "magic" ? "#c5a1ff" : "#d4e6ff", intensity: [.28, .38, .22][i], size: [.7, 1, 1.4][i], speed: [.55, .7, .85][i] }))
  return next
}
export const wrapCardAngle = (angle: number) => Number.isFinite(angle) ? ((angle + 180) % 360 + 360) % 360 - 180 : 0
export function portalView(orientation: CardOrientation) {
  const yaw = orientation.yaw * Math.PI / 180, pitch = orientation.pitch * Math.PI / 180
  return { x: Math.sin(yaw), y: -Math.sin(pitch), front: Math.cos(yaw) * Math.cos(pitch) > 0 }
}

/** All four rotated viewport corners fit the source image, even during animation.
 * Background is a full-aperture surface: user scale is a crop, never a smaller quad. */
export function coveredBackgroundScale(x: number, y: number, rotation: number, requested: number, aspect: number) {
  const r = rotation * Math.PI / 180, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r))
  const halfX = .5 + Math.abs(x), halfY = .5 + Math.abs(y)
  return Math.max(requested, 2 * (halfX * c + halfY / aspect * s), 2 * (halfY * c + halfX * aspect * s)) + .002
}

/** Layer order cannot invert. Depth changes travel inside a slot, not ownership of it. */
export const portalLayerZ = (layer: number, depth: number) => [-3, -1.6, -.35][layer] + Math.max(0, Math.min(1, depth)) * .25
export const portalWeatherZ = (zone: number, depth: number) => [-2.6, -1.18, .1][zone] + Math.max(0, Math.min(1, depth)) * .48
