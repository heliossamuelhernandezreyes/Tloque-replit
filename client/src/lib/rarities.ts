// Materiales de rareza para el marco de las tarjetas.
// El marco comunica la rareza sin números: cobre (común) → diamante (mítico).
export type Rarity = "copper" | "silver" | "gold" | "emerald" | "sapphire" | "ruby" | "diamond"
export type CollectionRarity = "common" | "rare" | "very_rare" | "unusual" | "golden" | "legendary" | "mythic" | "absolute"

export interface Material {
  id:        Rarity
  label:     string       // nombre visible (español; se puede traducir aparte)
  base:      string       // color principal del metal/gema
  light:     string       // reflejo claro
  dark:      string       // sombra profunda
  glow:      string       // halo de la sombra flotante
  shimmer:   boolean      // ¿tiene destello iridiscente animado? (gemas y diamante)
  order:     number       // jerarquía de rareza (para ordenar)
}

export const MATERIALS: Record<Rarity, Material> = {
  copper:   { id: "copper",   label: "Cobre",    base: "#c87d4a", light: "#e8a877", dark: "#7a4525", glow: "#c87d4a", shimmer: false, order: 1 },
  silver:   { id: "silver",   label: "Plata",    base: "#b8c2d0", light: "#eef2f7", dark: "#6b7280", glow: "#b8c2d0", shimmer: false, order: 2 },
  gold:     { id: "gold",     label: "Oro",      base: "#d4af5a", light: "#f5e6a8", dark: "#8a6d20", glow: "#d4af5a", shimmer: false, order: 3 },
  emerald:  { id: "emerald",  label: "Esmeralda",base: "#3fae74", light: "#8ff0bc", dark: "#1a6640", glow: "#3fae74", shimmer: true,  order: 4 },
  sapphire: { id: "sapphire", label: "Zafiro",   base: "#4a7fd4", light: "#9fc0f5", dark: "#254a8a", glow: "#4a7fd4", shimmer: true,  order: 5 },
  ruby:     { id: "ruby",     label: "Rubí",     base: "#d44a6a", light: "#f5a0b5", dark: "#8a2540", glow: "#d44a6a", shimmer: true,  order: 6 },
  diamond:  { id: "diamond",  label: "Diamante", base: "#c8e8f0", light: "#ffffff", dark: "#7fa8c0", glow: "#a0e0f0", shimmer: true,  order: 7 },
}

export const RARITY_ORDER: Rarity[] = ["copper", "silver", "gold", "emerald", "sapphire", "ruby", "diamond"]
export const COLLECTION_RARITY_ORDER: CollectionRarity[] = [
  "common", "rare", "very_rare", "unusual", "golden", "legendary", "mythic", "absolute",
]

// La rareza del sorteo es económica; el material es su traducción visual.
// Solo se aplica a cartas del pozo para no pisar la dirección artística del autor.
export const COLLECTION_MATERIAL: Record<CollectionRarity, Rarity> = {
  common: "copper",
  rare: "silver",
  very_rare: "emerald",
  unusual: "sapphire",
  golden: "gold",
  legendary: "ruby",
  mythic: "diamond",
  absolute: "diamond",
}

export function materialFor(rarity?: string): Material {
  return MATERIALS[(rarity as Rarity)] || MATERIALS.silver
}

export function collectionMaterialFor(
  rarity: string | undefined,
  inGachaPool: boolean | undefined,
  authoredMaterial?: string,
): Material {
  if (inGachaPool && COLLECTION_RARITY_ORDER.includes(rarity as CollectionRarity)) {
    return MATERIALS[COLLECTION_MATERIAL[rarity as CollectionRarity]]
  }
  return materialFor(authoredMaterial)
}

export function collectionTier(rarity?: string): number {
  const index = COLLECTION_RARITY_ORDER.indexOf(rarity as CollectionRarity)
  return index < 0 ? 0 : index
}

// Gradiente del marco metálico (para el borde de la tarjeta)
export function frameGradient(m: Material): string {
  return `linear-gradient(150deg, ${m.light} 0%, ${m.base} 30%, ${m.dark} 55%, ${m.base} 80%, ${m.light} 100%)`
}
