import { z } from "zod"
import { cardSceneSchema, readCardScene } from "./card-scene"
import { isSafeImageSource } from "./media"

export const CARD_DIRECTION_MAX_BYTES = 12_000_000
export const cardDirectionSchema = z.object({
  type: z.literal("tloque-card-direction"),
  version: z.literal(2),
  scene: cardSceneSchema,
  images: z.array(z.string().max(3_000_000).refine(isSafeImageSource, "Imagen no permitida")).length(3),
}).strict()
export type CardDirectionDocument = z.infer<typeof cardDirectionSchema>
export function readCardDirection(input: unknown, fallbackImages: string[] = []): CardDirectionDocument | null {
  const parsed = cardDirectionSchema.safeParse(input)
  if (parsed.success) return parsed.data
  if ((input as any)?.version === 2) return null
  const scene = readCardScene((input as any)?.scene ?? input)
  if (!scene) return null
  const legacy = cardDirectionSchema.safeParse({ type: "tloque-card-direction", version: 2, scene, images: [0, 1, 2].map(i => fallbackImages[i] || "") })
  return legacy.success ? legacy.data : null
}
