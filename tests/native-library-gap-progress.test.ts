import test from "node:test"
import assert from "node:assert/strict"
import { NATIVE_LIBRARY_INDEX, NATIVE_LIBRARY_MODELED_STUDIO } from "../shared/native-library-index"

test("guitar.acoustic deja de ser missing tras integrar Martin HD28", () => {
  assert.equal(NATIVE_LIBRARY_INDEX.find(item => item.instrumentId === "guitar.acoustic")?.status, "curated")
})

test("English Horn y Contrabassoon ya tienen fuente modelada pero siguen pendientes de Master", () => {
  const modeled = new Set(NATIVE_LIBRARY_MODELED_STUDIO.map(item => item.instrumentId))
  assert.ok(modeled.has("woodwinds.english-horn"))
  assert.ok(modeled.has("woodwinds.contrabassoon"))
  assert.equal(NATIVE_LIBRARY_INDEX.find(item => item.instrumentId === "woodwinds.english-horn")?.masterApproved, false)
  assert.equal(NATIVE_LIBRARY_INDEX.find(item => item.instrumentId === "woodwinds.contrabassoon")?.masterApproved, false)
})
