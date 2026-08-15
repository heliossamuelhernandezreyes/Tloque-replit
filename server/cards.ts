// Reglas puras de las tarjetas coleccionables — testeables sin BD.
import { isSafeImageSource } from "@shared/media"

export const MAX_CARDS_PER_BOOK = 6
export const MAX_LOOSE_CARDS = 24
export const CARD_PRICE_MIN = 1
export const CARD_PRICE_MAX = 100

// Sanea la configuración de capas (mismo shape que CoverFxConfig del cliente)
const VALID_EFFECTS = ["none", "snow", "rain", "rainGlass", "embers", "fire", "smoke", "sparkle"] as const
const VALID_RARITIES = ["copper", "silver", "gold", "emerald", "sapphire", "ruby", "diamond"] as const

// Sanea un efecto individual { effect, intensity }
function sanitizeLayerFx(input: any): { effect: string; intensity: number } {
  const effect = VALID_EFFECTS.includes(input?.effect) ? input.effect : "none"
  let intensity = Number(input?.intensity)
  if (!Number.isFinite(intensity)) intensity = 0.5
  return { effect, intensity: Math.max(0, Math.min(1, intensity)) }
}

export function sanitizeCardFx(input: any): any {
  const layers = {
    back:  typeof input?.layers?.back  === "string" ? input.layers.back  : "",
    mid:   typeof input?.layers?.mid   === "string" ? input.layers.mid   : "",
    front: typeof input?.layers?.front === "string" ? input.layers.front : "",
  }
  const layered = !!(layers.mid || layers.front)

  // Clima global (compatibilidad con tarjetas anteriores)
  const effect = VALID_EFFECTS.includes(input?.effect) ? input.effect : "none"
  let effectIntensity = Number(input?.effectIntensity)
  if (!Number.isFinite(effectIntensity)) effectIntensity = 0.5
  effectIntensity = Math.max(0, Math.min(1, effectIntensity))

  // Efectos POR CAPA (back/mid/front) — cada uno con su clima independiente
  const layerFx = {
    back:  sanitizeLayerFx(input?.layerFx?.back),
    mid:   sanitizeLayerFx(input?.layerFx?.mid),
    front: sanitizeLayerFx(input?.layerFx?.front),
  }

  // Rareza → material del marco (cobre, plata, oro, gemas, diamante)
  const rarity = VALID_RARITIES.includes(input?.rarity) ? input.rarity : "silver"

  // Marco de la galería (opcional). Null = usa el anillo de rareza.
  let frameId: number | null = Math.trunc(Number(input?.frameId))
  if (!Number.isFinite(frameId) || frameId <= 0) frameId = null

  return { mode: layered ? "layered" : "simple", layers, effect, effectIntensity, layerFx, rarity, frameId }
}

// Valida y normaliza el cuerpo de creación/edición de una tarjeta.
// Devuelve { ok: true, card } o { ok: false, message }.
export function validateCard(body: any):
  | { ok: true; card: { name: string; subtitle: string; description: string; fx: any; unlock: "support" | "tinta"; priceTinta: number } }
  | { ok: false; message: string } {
  const name = String(body?.name || "").trim().slice(0, 40)
  if (!name) return { ok: false, message: "La tarjeta necesita un nombre" }

  const unlock = body?.unlock === "tinta" ? "tinta" : "support"
  let priceTinta = 0
  if (unlock === "tinta") {
    priceTinta = Math.round(Number(body?.priceTinta))
    if (!Number.isFinite(priceTinta) || priceTinta < CARD_PRICE_MIN || priceTinta > CARD_PRICE_MAX) {
      return { ok: false, message: `El precio debe ser de ${CARD_PRICE_MIN} a ${CARD_PRICE_MAX} Tinta` }
    }
  }
  const fx = sanitizeCardFx(body?.fx)
  if (!fx.layers.back) return { ok: false, message: "La tarjeta necesita al menos el arte de fondo" }
  for (const source of Object.values(fx.layers) as string[]) {
    if (source && !isSafeImageSource(source, 400_000)) {
      return { ok: false, message: "El arte debe ser una imagen HTTPS o PNG/JPEG/WebP/GIF de hasta 400 KB" }
    }
  }

  return {
    ok: true,
    card: {
      name,
      subtitle:    String(body?.subtitle || "").trim().slice(0, 60),
      description: String(body?.description || "").trim().slice(0, 240),
      fx,
      unlock,
      priceTinta,
    },
  }
}
