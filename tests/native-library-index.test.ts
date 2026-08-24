import test from "node:test"
import assert from "node:assert/strict"
import { NATIVE_LIBRARY_CURATED, NATIVE_LIBRARY_MISSING, nativeLibraryIntegrityIssues } from "../shared/native-library-index"

test("cada fuente nativa curada tiene manifest semántico consistente", () => {
  assert.deepEqual(nativeLibraryIntegrityIssues(), [])
})

test("el índice distingue cobertura existente de huecos del roadmap", () => {
  assert.ok(NATIVE_LIBRARY_CURATED.length >= 20)
  assert.ok(NATIVE_LIBRARY_MISSING.some(item => item.instrumentId === "strings.harp"))
  assert.ok(NATIVE_LIBRARY_MISSING.some(item => item.instrumentId === "woodwinds.piccolo"))
  assert.ok(NATIVE_LIBRARY_MISSING.some(item => item.instrumentId === "brass.bass-trombone"))
  assert.ok(NATIVE_LIBRARY_MISSING.some(item => item.instrumentId === "guitar.acoustic"))
})
