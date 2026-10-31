import test from "node:test"
import assert from "node:assert/strict"
import { z } from "zod"
import { api } from "../shared/routes"

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

test("un parche no aplica valores predeterminados de creación sobre campos omitidos", () => {
  const patch = api.books.update.input.parse({ title: "Nuevo título", expectedRevision: 2 })
  assert.deepEqual(Object.keys(patch).sort(), ["expectedRevision", "title"])
  const work = { title: "Antes", status: "published", content: "Manuscrito íntegro", chapters: [{ title: "Uno", content: "Texto" }], commentsEnabled: false }
  const updated = { ...work, ...patch }
  assert.equal(updated.status, "published")
  assert.equal(updated.content, work.content)
  assert.deepEqual(updated.chapters, work.chapters)
  assert.equal(updated.commentsEnabled, false)
  assert.equal(api.books.create.input.parse({ title: "Borrador", author: "Autora" }).status, "draft", "la creación conserva sus valores predeterminados")
})
