/** Cosmetic policy only. Never grants ownership, billing or book access. */
export const VISUAL_ENGINE_VERSION = "tloque-visual-v2"
export const ORB_THEMES = ["singularity", "fluorescent-rose"] as const
export type OrbTheme = typeof ORB_THEMES[number]
export type VisualQuality = "auto" | "essential" | "premium" | "ultra"
export interface VisualEntitlements { themes: OrbTheme[]; expiresAt: string | null }

export function visualEntitlements(user: {
  subscriptionPlan?: unknown; subscriptionStatus?: unknown; subscriptionExpiresAt?: unknown
} | null | undefined, admin = false, now = Date.now()): VisualEntitlements {
  const expiry = user?.subscriptionExpiresAt == null ? null : new Date(String(user.subscriptionExpiresAt)).getTime()
  const active = user?.subscriptionStatus === "active"
    && (user.subscriptionPlan === "aesthetic" || user.subscriptionPlan === "audio")
    && (expiry === null || (Number.isFinite(expiry) && expiry > now))
  return {
    themes: admin || active ? [...ORB_THEMES] : ["singularity"],
    expiresAt: !admin && active && expiry !== null ? new Date(expiry).toISOString() : null,
  }
}

export function allowedOrbTheme(requested: unknown, entitlement?: VisualEntitlements | null, now = Date.now()): OrbTheme {
  if (requested !== "fluorescent-rose" || !Array.isArray(entitlement?.themes) || !entitlement.themes.includes(requested)) return "singularity"
  if (entitlement.expiresAt !== null) {
    const expiry = Date.parse(entitlement.expiresAt)
    if (!Number.isFinite(expiry) || expiry <= now) return "singularity"
  }
  return requested
}

export function normalizeVisualQuality(value: unknown): VisualQuality {
  return value === "essential" || value === "premium" || value === "ultra" ? value : "auto"
}

export function visualBudget(quality: VisualQuality, options: { reducedMotion?: boolean; saveData?: boolean; memory?: number; cores?: number } = {}) {
  const constrained = options.saveData || (options.memory !== undefined && options.memory <= 2)
  const enabled = quality !== "essential" && !options.reducedMotion && !(quality === "auto" && constrained)
  const ultra = quality === "ultra"
  const small = options.memory !== undefined && options.memory <= 4 || options.cores !== undefined && options.cores <= 4
  return { enabled, dpr: ultra ? 1.75 : small ? 1 : 1.4, fps: ultra ? 60 : 30, maxViews: 3, maxTextureEdge: ultra ? 1536 : 1024 }
}

export const VISUAL_PIXEL_BUDGET = 1_800_000
export function visualDpr(width: number, height: number, native: number, limit: number) {
  return Math.min(native > 0 && Number.isFinite(native) ? native : 1, limit, Math.sqrt(VISUAL_PIXEL_BUDGET / Math.max(1, width * height)))
}

export function selectVisualEntries<T extends { priority: number }>(entries: readonly T[], overlays: readonly { priority: number }[], maxViews: number) {
  const priority = Math.max(0, ...entries.map(entry => entry.priority), ...overlays.map(item => item.priority))
  const selected = entries.filter(entry => priority < 80 || entry.priority === priority)
    .sort((a, b) => b.priority - a.priority).slice(0, maxViews)
  return { priority, selected }
}

/** CSS-pixel viewport/scissor; preserve the full rect so partial visibility never stretches art. */
export function visualViewport(rect: { left: number; top: number; right: number; bottom: number; width: number; height: number }, width: number, height: number, clip?: { left: number; top: number; right: number; bottom: number }) {
  const left = Math.max(0, rect.left, clip?.left ?? 0), top = Math.max(0, rect.top, clip?.top ?? 0)
  const right = Math.min(width, rect.right, clip?.right ?? width), bottom = Math.min(height, rect.bottom, clip?.bottom ?? height)
  if (right <= left || bottom <= top || rect.width < 2 || rect.height < 2) return null
  return { viewport: [rect.left, height - rect.bottom, rect.width, rect.height] as const, scissor: [left, height - bottom, right - left, bottom - top] as const }
}

/** Embla's outer slide transform is reserved for looping. Apply this to a child. */
export function carouselPose(offset: number, reducedMotion = false) {
  const safe = Number.isFinite(offset) ? offset : 0
  const distance = Math.min(4, Math.abs(safe))
  return {
    scale: 1,
    opacity: reducedMotion ? 1 : 1 - Math.min(distance * 0.045, 0.15),
    rotate: 0,
    lift: 0,
    light: Math.max(0.15, 1 - distance * 0.33),
  }
}

export const boundedVisual = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
export const visualColor = (value: unknown, fallback = "#c9a84c") =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback

/** A declarative, bounded subset of the existing Workshop; no executable input. */
export function visualFrame(input: any, accent = "#c9a84c") {
  const appearance = (input?.runtimePreset ?? input)?.appearance ?? {}
  const material = appearance.material ?? {}
  const colors: Record<string, string> = { gold: "#d5aa45", silver: "#cbd4e5", copper: "#bd7752", diamond: "#aedaf0", steel: "#8091a3", titanium: "#747a86", obsidian: "#202431" }
  return {
    color: visualColor(material.baseColor, colors[material.preset] ?? visualColor(accent)),
    metalness: boundedVisual(material.metalness, 0.85, 0, 1),
    roughness: boundedVisual(material.roughness, 0.24, 0.12, 1),
    thickness: boundedVisual(appearance.geometry?.thickness?.top, 24, 8, 60) / 500,
    radius: boundedVisual(appearance.geometry?.corners?.tl, 40, 12, 100) / 500,
    glass: boundedVisual(appearance.glass?.reflection, 0.16, 0, 0.4),
  }
}
