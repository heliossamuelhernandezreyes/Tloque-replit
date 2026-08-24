import test from "node:test"
import assert from "node:assert/strict"
import { validateTloqueSamplePack } from "../shared/native-sample-pack"
import { summarizeNativeSamplePackCoverage } from "../client/src/audio/NativeSampleCoverageAudit"

function pack(roots: readonly number[]) {
  return validateTloqueSamplePack({
    version: 1,
    id: "fixture",
    name: "Fixture",
    instrumentManifestId: "vsco2-ce-solo-violin",
    license: "CC0-1.0",
    sourceName: "fixture",
    sourceUrl: "https://example.invalid",
    zones: roots.map((root, index) => ({
      id: `z${index}`,
      articulation: "normal",
      sampleUrl: `/api/audio/sample-packs/${index}.wav`,
      rootMidi: root,
      loMidi: root - 1,
      hiMidi: root + 1,
      loVelocity: 0,
      hiVelocity: 127,
      velocityLayer: 0,
      roundRobin: 0,
      gainDb: 0,
      tuneCents: 0,
    })),
  })
}

test("clasifica como denso un mapa con raíces a dos semitonos", () => {
  const summary = summarizeNativeSamplePackCoverage(pack([60, 62, 64, 66]))
  assert.equal(summary.density, "dense")
  assert.equal(summary.maxRootGap, 2)
  assert.equal(summary.maxTransposeNeed, 1)
  assert.deepEqual(summary.uncoveredMidi, [])
})

test("indexa huecos reales y mapas peligrosamente dispersos", () => {
  const summary = summarizeNativeSamplePackCoverage(pack([60, 68]))
  assert.equal(summary.density, "risk")
  assert.ok(summary.uncoveredMidi.length > 0)
  assert.equal(summary.maxRootGap, 8)
})
