import test from "node:test"
import assert from "node:assert/strict"
import {
  NATIVE_LIBRARY_CURATED,
  NATIVE_LIBRARY_INDEX,
  NATIVE_LIBRARY_LICENSE_BLOCKED,
  NATIVE_LIBRARY_MISSING,
} from "../shared/native-library-index"
import { NATIVE_BLOCKED_SOURCE_CANDIDATES } from "../shared/native-library-blocked-sources"

test("native library distinguishes curated, blocked and genuinely missing sources", () => {
  const englishHorn = NATIVE_LIBRARY_INDEX.find(entry => entry.instrumentId === "woodwinds.english-horn")
  const contrabassoon = NATIVE_LIBRARY_INDEX.find(entry => entry.instrumentId === "woodwinds.contrabassoon")
  const celesta = NATIVE_LIBRARY_INDEX.find(entry => entry.instrumentId === "keys.celesta")

  assert.equal(englishHorn?.status, "license-blocked")
  assert.equal(contrabassoon?.status, "license-blocked")
  assert.equal(celesta?.status, "curated")
  assert.ok((englishHorn?.blockedCandidates.length ?? 0) >= 3)
  assert.ok((contrabassoon?.blockedCandidates.length ?? 0) >= 2)
  assert.ok(NATIVE_LIBRARY_LICENSE_BLOCKED.some(entry => entry.instrumentId === "woodwinds.english-horn"))
  assert.ok(NATIVE_LIBRARY_LICENSE_BLOCKED.some(entry => entry.instrumentId === "woodwinds.contrabassoon"))
  assert.ok(NATIVE_LIBRARY_MISSING.every(entry => entry.status !== "curated"))
  assert.ok(NATIVE_LIBRARY_CURATED.every(entry => entry.status === "curated"))
})

test("blocked candidates always explain provenance and legal reason", () => {
  assert.ok(NATIVE_BLOCKED_SOURCE_CANDIDATES.length >= 7)
  for (const candidate of NATIVE_BLOCKED_SOURCE_CANDIDATES) {
    assert.match(candidate.sourceUrl, /^https:\/\//)
    assert.ok(candidate.sourceName.trim().length > 0)
    assert.ok(candidate.license.trim().length > 0)
    assert.ok(candidate.note.trim().length > 20)
    assert.ok(["noncommercial-license", "redistribution-prohibited", "unclear-provenance"].includes(candidate.reason))
  }
})
