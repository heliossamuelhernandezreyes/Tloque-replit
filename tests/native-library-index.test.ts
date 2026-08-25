import test from "node:test"
import assert from "node:assert/strict"
import { NATIVE_LIBRARY_CURATED, NATIVE_LIBRARY_INDEX, NATIVE_LIBRARY_MODELED_STUDIO, nativeLibraryIntegrityIssues } from "../shared/native-library-index"

test("cada fuente nativa curada tiene manifest semántico consistente", () => {
  assert.deepEqual(nativeLibraryIntegrityIssues(), [])
})

test("el índice refleja los huecos ya cerrados y los modelos Studio", () => {
  assert.ok(NATIVE_LIBRARY_CURATED.length >= 18)
  const status = (instrumentId: string) => NATIVE_LIBRARY_INDEX.find(item => item.instrumentId === instrumentId)?.status
  for (const id of ["strings.harp", "woodwinds.piccolo", "woodwinds.bass-clarinet", "brass.bass-trombone", "guitar.acoustic", "keys.celesta"]) {
    assert.equal(status(id), "curated", `${id} debe conservar una fuente curada`)
  }
  const modeled = new Set(NATIVE_LIBRARY_MODELED_STUDIO.map(item => item.instrumentId))
  assert.ok(modeled.has("woodwinds.english-horn"))
  assert.ok(modeled.has("woodwinds.contrabassoon"))
})
