import { z } from "zod"

export const NARRATIVE_PROJECT_VERSION = 1 as const
export const EXPERIENCE_PROFILE_VERSION = 1 as const

export const narrativeMoodSchema = z.enum([
  "neutral",
  "calm",
  "wonder",
  "melancholy",
  "rising_tension",
  "confrontation",
  "climax",
  "release",
  "silence",
])

export const narrativeTextureSchema = z.enum([
  "minimal",
  "open",
  "warm",
  "dark",
  "suspended",
  "rhythmic",
  "dense",
])

export const percussionSchema = z.enum(["none", "subtle", "gradual"])

const paragraphIndexSchema = z.number().int().min(0)
const unitSchema = z.number().finite().min(0).max(1)
const musicIntensitySchema = z.number().finite().min(0).max(0.8)
const forbiddenLiteralAudioTag = /(?:^|[-_\s])(sfx|foley|sword|blade|gunshot|explosion|impact|hit|choque|espada|disparo|explosi[oó]n|golpe)(?:$|[-_\s])/i
const musicalLayerTagSchema = z.string().trim().min(1).max(80).refine(
  tag => !forbiddenLiteralAudioTag.test(tag),
  "La dirección sólo admite cualidades musicales, nunca efectos literales",
)

export const transitionWindowSchema = z.object({
  minimumSeconds: z.number().finite().min(6).max(120).default(8),
  preferredSeconds: z.number().finite().min(8).max(120).default(14),
  maximumSeconds: z.number().finite().min(10).max(120).default(24),
}).superRefine((window, ctx) => {
  if (window.minimumSeconds > window.preferredSeconds) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["preferredSeconds"], message: "La transición preferida debe ser igual o mayor que la mínima" })
  }
  if (window.preferredSeconds > window.maximumSeconds) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maximumSeconds"], message: "La transición máxima debe ser igual o mayor que la preferida" })
  }
})

const narrativeRegionObjectSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(160),
  startParagraph: paragraphIndexSchema,
  preferredParagraph: paragraphIndexSchema,
  endParagraph: paragraphIndexSchema,
  mood: narrativeMoodSchema,
  targetIntensity: musicIntensitySchema.default(0.35),
  tension: unitSchema.default(0.2),
  warmth: unitSchema.default(0.5),
  density: unitSchema.default(0.25),
  texture: narrativeTextureSchema.default("minimal"),
  percussion: percussionSchema.default("none"),
  transition: transitionWindowSchema.default({
    minimumSeconds: 8,
    preferredSeconds: 14,
    maximumSeconds: 24,
  }),
  scoreId: z.number().int().positive().nullable().default(null),
  layerTags: z.array(musicalLayerTagSchema).max(12).default([]),
  confidence: unitSchema.default(1),
  source: z.enum(["manual", "oracle"]).default("manual"),
  locked: z.boolean().default(false),
  note: z.string().trim().max(500).default(""),
}).strict()

export const narrativeRegionSchema = narrativeRegionObjectSchema.superRefine((region, ctx) => {
  if (region.startParagraph > region.preferredParagraph) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["preferredParagraph"], message: "El punto preferido debe estar dentro de la región" })
  }
  if (region.preferredParagraph > region.endParagraph) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endParagraph"], message: "El final debe estar después del punto preferido" })
  }
})

export const narrativeProjectSchema = z.object({
  version: z.literal(NARRATIVE_PROJECT_VERSION),
  bookId: z.number().int().positive(),
  chapterIndex: paragraphIndexSchema,
  revision: z.number().int().min(1),
  directionStyle: z.enum(["subtle", "narrative", "cinematic"]).default("subtle"),
  defaultScoreId: z.number().int().positive().nullable().default(null),
  regions: z.array(narrativeRegionSchema).max(120).default([]),
}).strict()

export type NarrativeMood = z.infer<typeof narrativeMoodSchema>
export type NarrativeRegionV1 = z.infer<typeof narrativeRegionSchema>
export type NarrativeProjectV1 = z.infer<typeof narrativeProjectSchema>

export const experienceRegionSchema = narrativeRegionObjectSchema.omit({
  startParagraph: true,
  preferredParagraph: true,
  endParagraph: true,
  source: true,
  locked: true,
  note: true,
}).extend({
  startProgress: unitSchema,
  preferredProgress: unitSchema,
  endProgress: unitSchema,
})

export const experienceProfileSchema = z.object({
  version: z.literal(EXPERIENCE_PROFILE_VERSION),
  bookId: z.number().int().positive(),
  chapterIndex: paragraphIndexSchema,
  revision: z.number().int().min(1),
  compiledFromProjectRevision: z.number().int().min(1),
  paragraphCount: z.number().int().positive(),
  directionStyle: z.enum(["subtle", "narrative", "cinematic"]),
  defaultScoreId: z.number().int().positive().nullable(),
  regions: z.array(experienceRegionSchema).max(120),
}).strict()

export type ExperienceRegionV1 = z.infer<typeof experienceRegionSchema>
export type ExperienceProfileV1 = z.infer<typeof experienceProfileSchema>

export interface NarrativeRuntimeState {
  activeRegionId: string | null
  lastProgress: number
}

export interface NarrativeRuntimeDecision {
  region: ExperienceRegionV1 | null
  changed: boolean
  reason: "entered" | "held" | "low-confidence" | "no-region"
}

export class NarrativeCompilationError extends Error {
  public constructor(message: string, public readonly regionId?: string) {
    super(message)
    this.name = "NarrativeCompilationError"
  }
}

function progressFor(paragraph: number, paragraphCount: number): number {
  if (paragraphCount <= 1) return 0
  return Math.min(1, Math.max(0, paragraph / (paragraphCount - 1)))
}

export function compileNarrativeProject(
  input: NarrativeProjectV1,
  paragraphCount: number,
): ExperienceProfileV1 {
  const project = narrativeProjectSchema.parse(input)
  if (!Number.isInteger(paragraphCount) || paragraphCount < 1) {
    throw new NarrativeCompilationError("El capítulo necesita al menos un párrafo")
  }

  const ordered = [...project.regions].sort((a, b) =>
    a.startParagraph - b.startParagraph || a.endParagraph - b.endParagraph,
  )
  const ids = new Set<string>()
  let previousEnd = -1
  for (const region of ordered) {
    if (ids.has(region.id)) {
      throw new NarrativeCompilationError("Cada región necesita un identificador único", region.id)
    }
    ids.add(region.id)
    if (region.endParagraph >= paragraphCount) {
      throw new NarrativeCompilationError("La región termina fuera del capítulo", region.id)
    }
    if (region.startParagraph <= previousEnd) {
      throw new NarrativeCompilationError("Las regiones narrativas no pueden solaparse", region.id)
    }
    previousEnd = region.endParagraph
  }

  const profile: ExperienceProfileV1 = {
    version: EXPERIENCE_PROFILE_VERSION,
    bookId: project.bookId,
    chapterIndex: project.chapterIndex,
    revision: project.revision,
    compiledFromProjectRevision: project.revision,
    paragraphCount,
    directionStyle: project.directionStyle,
    defaultScoreId: project.defaultScoreId,
    regions: ordered.map((region) => ({
      id: region.id,
      name: region.name,
      startProgress: progressFor(region.startParagraph, paragraphCount),
      preferredProgress: progressFor(region.preferredParagraph, paragraphCount),
      endProgress: progressFor(region.endParagraph, paragraphCount),
      mood: region.mood,
      targetIntensity: region.targetIntensity,
      tension: region.tension,
      warmth: region.warmth,
      density: region.density,
      texture: region.texture,
      percussion: region.percussion,
      transition: region.transition,
      scoreId: region.scoreId,
      layerTags: region.layerTags,
      confidence: region.confidence,
    })),
  }
  return experienceProfileSchema.parse(profile)
}

export function resolveNarrativeRegion(
  profile: ExperienceProfileV1,
  progressInput: number,
  state: NarrativeRuntimeState,
  observedConfidence: number,
  minimumConfidence = 0.65,
): NarrativeRuntimeDecision {
  const progress = Math.min(1, Math.max(0, Number.isFinite(progressInput) ? progressInput : state.lastProgress))
  const confidence = Math.min(1, Math.max(0, Number.isFinite(observedConfidence) ? observedConfidence : 0))
  const active = state.activeRegionId
    ? profile.regions.find(region => region.id === state.activeRegionId) ?? null
    : null

  // Una banda pequeña evita que el runtime oscile cuando la zona de atención
  // queda sobre un límite. Ante incertidumbre siempre conserva el estado.
  const hysteresis = 0.015
  if (active && progress >= active.startProgress - hysteresis && progress <= active.endProgress + hysteresis) {
    return { region: active, changed: false, reason: "held" }
  }
  if (confidence < minimumConfidence) {
    return { region: active, changed: false, reason: "low-confidence" }
  }

  const candidate = profile.regions.find(region =>
    progress >= region.startProgress && progress <= region.endProgress && region.confidence >= minimumConfidence,
  ) ?? null
  if (!candidate) return { region: active, changed: false, reason: "no-region" }
  if (candidate.id === active?.id) return { region: active, changed: false, reason: "held" }
  return { region: candidate, changed: true, reason: "entered" }
}

export function narrativeParagraphsFor(content: string): string[] {
  const paragraphs = content
    .split(/\n\s*\n/g)
    .map(part => part.trim())
    .filter(Boolean)
  return paragraphs.length > 0 ? paragraphs : [""]
}

export function paragraphCountFor(content: string): number {
  return narrativeParagraphsFor(content).length
}
