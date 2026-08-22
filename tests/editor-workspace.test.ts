import test from "node:test"
import assert from "node:assert/strict"
import {
  buildDirectionWorkspaceUrl,
  isServerBookId,
  parseDirectionWorkspaceLocation,
} from "../client/src/lib/editor-workspace.ts"

test("solo abre Dirección para obras persistidas en servidor", () => {
  assert.equal(isServerBookId(42), true)
  assert.equal(isServerBookId(Date.now()), false)
  assert.equal(isServerBookId(-1), false)
  assert.equal(isServerBookId("42"), false)
})

test("construye una ruta de Dirección con capítulo normalizado", () => {
  assert.equal(buildDirectionWorkspaceUrl(42, 3), "/editor/direction?id=42&chapter=3")
  assert.equal(buildDirectionWorkspaceUrl(42, -8), "/editor/direction?id=42&chapter=0")
  assert.equal(buildDirectionWorkspaceUrl(Date.now(), 0), null)
})

test("rechaza ubicaciones inválidas y normaliza el capítulo", () => {
  assert.deepEqual(parseDirectionWorkspaceLocation("?id=42&chapter=2"), {
    bookId: 42,
    chapterIndex: 2,
  })
  assert.deepEqual(parseDirectionWorkspaceLocation("id=42&chapter=2.9"), {
    bookId: 42,
    chapterIndex: 2,
  })
  assert.equal(parseDirectionWorkspaceLocation("?id=not-a-number"), null)
})
