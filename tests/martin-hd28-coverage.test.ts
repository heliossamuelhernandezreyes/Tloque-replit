import test from "node:test"
import assert from "node:assert/strict"
import { DISCORD_MARTIN_HD28_PACK } from "../shared/curated-raw-wav-packs"
import { compileRawWavPathsToSfz } from "../server/rawWavSamplePackCompiler"
import { compileCuratedSfzZones } from "../server/sfzSamplePackCompiler"
import { validateTloqueSamplePack } from "../shared/native-sample-pack"
import { summarizeNativeSamplePackCoverage } from "../client/src/audio/NativeSampleCoverageAudit"

test("Martin HD28 declara únicamente su registro físico y no deja huecos internos", () => {
  const { sfzText } = compileRawWavPathsToSfz(DISCORD_MARTIN_HD28_PACK.rawWavStaticPaths ?? [], DISCORD_MARTIN_HD28_PACK)
  const parsed = compileCuratedSfzZones(sfzText)
  const pack = validateTloqueSamplePack({
    version: 1,
    id: DISCORD_MARTIN_HD28_PACK.id,
    name: DISCORD_MARTIN_HD28_PACK.displayName,
    instrumentManifestId: DISCORD_MARTIN_HD28_PACK.manifestId,
    license: DISCORD_MARTIN_HD28_PACK.license,
    sourceName: DISCORD_MARTIN_HD28_PACK.libraryName,
    sourceUrl: DISCORD_MARTIN_HD28_PACK.repositoryUrl,
    zones: parsed.map((zone, index) => ({ ...zone, id: `z${index}`, sampleUrl: `/api/audio/sample-packs/samples/${String(index).padStart(64, "0")}.wav` })),
  })
  const summary = summarizeNativeSamplePackCoverage(pack)
  assert.equal(summary.midiMin, 40)
  assert.equal(summary.midiMax, 83)
  assert.deepEqual(summary.uncoveredMidi, [])
  assert.ok((summary.maxTransposeNeed ?? 99) <= 2)
  assert.notEqual(summary.density, "risk")
})
