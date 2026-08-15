import { z } from "zod"

export const audioSourceTypeSchema = z.enum(["stream", "procedural", "soundfont"])
export type AudioSourceType = z.infer<typeof audioSourceTypeSchema>

export const proceduralPresetSchema = z.enum([
  "quiet_observatory",
  "warm_memory",
  "cold_suspense",
  "deep_focus",
])

export const proceduralRecipeSchema = z.object({
  version: z.literal(1).default(1),
  preset: proceduralPresetSchema.default("quiet_observatory"),
  rootMidi: z.number().int().min(36).max(72).default(48),
  scale: z.enum(["major", "minor", "dorian", "pentatonic"]).default("minor"),
  bpm: z.number().int().min(32).max(140).default(58),
  bars: z.number().int().min(2).max(16).default(4),
  density: z.number().min(0).max(1).default(0.35),
  brightness: z.number().min(0).max(1).default(0.45),
  movement: z.number().min(0).max(1).default(0.3),
  seed: z.number().int().min(0).max(2_147_483_647).default(1),
}).strict()

export type ProceduralRecipe = z.infer<typeof proceduralRecipeSchema>

export const DEFAULT_PROCEDURAL_RECIPE: ProceduralRecipe = proceduralRecipeSchema.parse({})

export function proceduralRecipeFor(value: unknown): ProceduralRecipe {
  return proceduralRecipeSchema.parse(value ?? {})
}
