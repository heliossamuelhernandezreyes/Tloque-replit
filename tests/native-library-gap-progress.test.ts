import test from "node:test"
import assert from "node:assert/strict"
import { NATIVE_LIBRARY_INDEX, NATIVE_LIBRARY_MISSING } from "../shared/native-library-index"

test("guitar.acoustic deja de ser missing tras integrar Martin HD28", () => {
  assert.equal(NATIVE_LIBRARY_INDEX.find(item => item.instrumentId === "guitar.acoustic")?.status, "curated")
})

test("los huecos sin fuente redistribuible verificada siguen explícitos", () => {
  const missing = new Set(NATIVE_LIBRARY_MISSING.map(item => item.instrumentId))
  assert.ok(missing.has("woodwinds.english-horn"))
  assert.ok(missing.has("woodwinds.contrabassoon"))
})
