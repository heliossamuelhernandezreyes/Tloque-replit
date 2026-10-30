import { z } from "zod"

/** Missing patch fields must stay absent, even when creation has defaults. */
export function patchSchema<Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>) {
  const fields = Object.fromEntries(Object.entries(schema.shape).map(([key, field]) => [key, z.union([z.undefined(), field]).optional()]))
  return schema.extend(fields as { [Key in keyof Shape]: z.ZodOptional<z.ZodUnion<[z.ZodUndefined, Shape[Key]]>> })
}
