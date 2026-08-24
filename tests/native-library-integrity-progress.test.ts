import test from "node:test"
import assert from "node:assert/strict"
import { NATIVE_LIBRARY_CURATED, NATIVE_LIBRARY_MISSING, nativeLibraryIntegrityIssues } from "../shared/native-library-index"

test("la biblioteca nativa sigue íntegra tras añadir Martin HD28", () => {
  assert.deepEqual(nativeLibraryIntegrityIssues(), [])
  assert.ok(NATIVE_LIBRARY_CURATED.some(item => item.instrumentId === "guitar.acoustic" && item.moduleId === "discord-martin-hd28"))
})

test("el progreso no borra huecos cuya fuente aún no es instalable", () => {
  const missing = new Set(NATIVE_LIBRARY_MISSING.map(item => item.instrumentId))
  assert.ok(missing.has("woodwinds.bass-clarinet"))
  assert.ok(missing.has("brass.bass-trombone"))
  assert.ok(missing.has("keys.celesta"))
})
