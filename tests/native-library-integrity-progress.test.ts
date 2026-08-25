import test from "node:test"
import assert from "node:assert/strict"
import { NATIVE_LIBRARY_CURATED, nativeLibraryIntegrityIssues } from "../shared/native-library-index"

test("la biblioteca nativa sigue íntegra tras añadir Martin HD28", () => {
  assert.deepEqual(nativeLibraryIntegrityIssues(), [])
  assert.ok(NATIVE_LIBRARY_CURATED.some(item => item.instrumentId === "guitar.acoustic" && item.moduleId === "discord-martin-hd28"))
})

test("Iowa y Celesta permanecen como fuentes curadas instalables", () => {
  const curated = new Map(NATIVE_LIBRARY_CURATED.map(item => [item.instrumentId, item]))
  assert.equal(curated.get("woodwinds.bass-clarinet")?.moduleId, "iowa-mis-bass-clarinet-ff")
  assert.equal(curated.get("brass.bass-trombone")?.moduleId, "iowa-mis-bass-trombone-ff")
  assert.ok(curated.get("keys.celesta")?.moduleId)
})
