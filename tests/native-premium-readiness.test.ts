import test from "node:test"
import assert from "node:assert/strict"
import { premiumReadinessError, type NativePremiumReadiness } from "../client/src/audio/NativePremiumReadiness"
import { auditNativeSampleDemand } from "../client/src/audio/NativeSampleDemandAudit"

test("el error premium explica la fuente acústica responsable y la política Master", () => {
  const readiness = {
    ready: false,
    blockers: [{ moduleId: "brass", instruments: ["brass.trumpet"], reason: "coverage-risk", message: "transposición máx. 7 semitonos" }],
    warnings: [],
    demand: [],
    audit: { ready: true, scorePlayable: true, items: [], missingModules: [], riskyModules: [], totalZones: 0, totalRoots: 0 },
  } satisfies NativePremiumReadiness
  const message = premiumReadinessError(readiness)
  assert.match(message, /brass\.trumpet/)
  assert.match(message, /7 semitonos/)
  assert.match(message, /Master premium detenido/)
  assert.match(message, /modelos físicos|fuentes híbridas/)
})

test("la demanda real detecta pitch shift audible aunque el plan compile", () => {
  const plan = {
    tracks: [], controls: [], auxiliaryVoices: [], zones: [], totalSeconds: 2,
    voices: [
      { trackId: "v", articulation: "normal", timbre: "natural", resolvedTimbre: "non-vibrato", note: 60, velocity: 80, roundRobin: 0, vibrato: false, vibratoColour: "none", mute: "none", micPosition: "default", startSeconds: 0, durationSeconds: 1, zoneId: "a", sampleUrl: "a.wav", playbackRate: 1, sampleGain: 1, oneShot: false, fadeInSeconds: 0 },
      { trackId: "v", articulation: "normal", timbre: "natural", resolvedTimbre: "non-vibrato", note: 64, velocity: 80, roundRobin: 0, vibrato: false, vibratoColour: "none", mute: "none", micPosition: "default", startSeconds: 1, durationSeconds: 1, zoneId: "a", sampleUrl: "a.wav", playbackRate: 2 ** (4 / 12), sampleGain: 1, oneShot: false, fadeInSeconds: 0 },
    ],
  } as const
  const audit = auditNativeSampleDemand(plan)
  assert.equal(audit.risk, "high")
  assert.equal(audit.shiftedOverThreeSemitones, 1)
  assert.ok(audit.maxShiftSemitones > 3.9)
})
