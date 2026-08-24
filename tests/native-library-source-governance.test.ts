import test from "node:test"
import assert from "node:assert/strict"
import {
  NATIVE_LIBRARY_CURATED,
  NATIVE_LIBRARY_INDEX,
  NATIVE_LIBRARY_LICENSE_BLOCKED,
  NATIVE_LIBRARY_MASTER_PENDING,
  NATIVE_LIBRARY_MISSING,
  NATIVE_LIBRARY_MODELED_STUDIO,
} from "../shared/native-library-index"
import { NATIVE_BLOCKED_SOURCE_CANDIDATES } from "../shared/native-library-blocked-sources"

test("native library distinguishes curated, modeled, blocked and genuinely missing sources", () => {
  const englishHorn = NATIVE_LIBRARY_INDEX.find(entry => entry.instrumentId === "woodwinds.english-horn")
  const contrabassoon = NATIVE_LIBRARY_INDEX.find(entry => entry.instrumentId === "woodwinds.contrabassoon")
  const celesta = NATIVE_LIBRARY_INDEX.find(entry => entry.instrumentId === "keys.celesta")

  assert.equal(englishHorn?.status, "modeled-studio")
  assert.equal(contrabassoon?.status, "modeled-studio")
  assert.equal(englishHorn?.sourceKind, "physical-model")
  assert.equal(contrabassoon?.sourceKind, "physical-model")
  assert.equal(englishHorn?.masterApproved, false)
  assert.equal(contrabassoon?.masterApproved, false)
  assert.equal(celesta?.status, "curated")
  assert.equal(celesta?.sourceKind, "sample-pack")
  assert.equal(celesta?.masterApproved, true)

  // Rejected/blocked sample candidates remain recorded for provenance even when
  // an original Tloque model supplies Studio playback.
  assert.ok((englishHorn?.blockedCandidates.length ?? 0) >= 3)
  assert.ok((contrabassoon?.blockedCandidates.length ?? 0) >= 2)
  assert.ok(NATIVE_LIBRARY_MODELED_STUDIO.some(entry => entry.instrumentId === "woodwinds.english-horn"))
  assert.ok(NATIVE_LIBRARY_MODELED_STUDIO.some(entry => entry.instrumentId === "woodwinds.contrabassoon"))
  assert.ok(NATIVE_LIBRARY_MASTER_PENDING.some(entry => entry.instrumentId === "woodwinds.english-horn"))
  assert.ok(NATIVE_LIBRARY_MASTER_PENDING.some(entry => entry.instrumentId === "woodwinds.contrabassoon"))
  assert.ok(NATIVE_LIBRARY_LICENSE_BLOCKED.every(entry => entry.status === "license-blocked"))
  assert.ok(NATIVE_LIBRARY_MISSING.every(entry => entry.status === "license-blocked" || entry.status === "missing-source"))
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
