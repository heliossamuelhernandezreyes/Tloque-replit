import test from "node:test"
import assert from "node:assert/strict"
import { z } from "zod"

test("una colección sobredimensionada se rechaza antes de validar miles de elementos", () => {
  let visited = 0
  const schema = z.array(z.string().superRefine(() => { visited++ })).max(10)
  const result = schema.safeParse(Array.from({ length: 20_000 }, () => "elemento"))
  assert.equal(result.success, false)
  assert.equal(visited, 0, "la cota debe comprobarse antes de recorrer el contenido")
  if (!result.success) {
    assert.equal(result.error.issues.length, 1)
    assert.equal(result.error.issues[0].code, "too_big")
  }
})
