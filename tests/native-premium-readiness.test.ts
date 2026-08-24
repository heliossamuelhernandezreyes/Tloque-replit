import test from "node:test"
import assert from "node:assert/strict"
import { premiumReadinessError, type NativePremiumReadiness } from "../client/src/audio/NativePremiumReadiness"

test("el error premium explica el banco físico responsable", () => {
  const readiness = {
    ready: false,
    blockers: [{ moduleId: "brass", instruments: ["brass.trumpet"], reason: "coverage-risk", message: "transposición máx. 7 semitonos" }],
    warnings: [],
    audit: { ready: true, scorePlayable: true, items: [], missingModules: [], riskyModules: [], totalZones: 0, totalRoots: 0 },
  } satisfies NativePremiumReadiness
  const message = premiumReadinessError(readiness)
  assert.match(message, /brass\.trumpet/)
  assert.match(message, /7 semitonos/)
  assert.match(message, /no ocultará huecos físicos/)
})
