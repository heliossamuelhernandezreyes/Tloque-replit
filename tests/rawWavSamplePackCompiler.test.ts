import assert from "node:assert/strict"
import test from "node:test"
import { curatedSamplePackSource } from "../server/audioModuleInstaller"
import { compileRawWavIndexToSfz, compileRawWavPathsToSfz } from "../server/rawWavSamplePackCompiler"
import { compileCuratedSfzZones, compileSfzToTloqueSamplePack } from "../server/sfzSamplePackCompiler"
import {
  VCSL_ESTUARY_GRAND_PIANO_PACK,
  VCSL_ESTUARY_PIPE_ORGAN_PACK,
  VCSL_ITALIAN_HARPSICHORD_PACK,
} from "../shared/curated-raw-wav-packs"
import {
  VCSL_ESTUARY_GRAND_PIANO_MANIFEST,
  VCSL_ESTUARY_PIPE_ORGAN_MANIFEST,
  instrumentManifestById,
} from "../shared/instrument-manifest"
import { VCSL_ITALIAN_HARPSICHORD_MANIFEST } from "../shared/instrument-manifest-keys"

function index(entries: Array<{ bank: string; url: string }>) {
  return JSON.stringify(entries.map((entry, n) => ({ ...entry, n, type: "audio" })))
}

function internalUrl(path: string) {
  return `/api/audio/sample-packs/samples/${Buffer.from(path).toString("hex")}.wav`
}

test("raw VCSL piano keeps three physical velocity layers and close mic", () => {
  const source = index([
    { bank: "grandpiano", url: "grandpiano/03_JHPiano_Sus_Close_C3_vl2_rr1.wav" },
    { bank: "grandpiano", url: "grandpiano/04_JHPiano_Sus_Close_C3_vl3_rr1.wav" },
    { bank: "grandpiano", url: "grandpiano/05_JHPiano_Sus_Close_C3_vl4_rr1.wav" },
    { bank: "grandpiano", url: "grandpiano/09_JHPiano_Sus_Close_C4_vl2_rr1.wav" },
    { bank: "grandpiano", url: "grandpiano/10_JHPiano_Sus_Close_C4_vl3_rr1.wav" },
    { bank: "grandpiano", url: "grandpiano/11_JHPiano_Sus_Close_C4_vl4_rr1.wav" },
  ])
  const compiled = compileRawWavIndexToSfz(source, VCSL_ESTUARY_GRAND_PIANO_PACK)
  const zones = compileCuratedSfzZones(compiled.sfzText)
  assert.equal(compiled.samplePaths.length, 6)
  assert.equal(zones.length, 6)
  assert.deepEqual([...new Set(zones.map(zone => zone.velocityLayer))], [0, 1, 2])
  assert.ok(zones.every(zone => zone.micPosition === "close"))
  assert.deepEqual([...new Set(zones.map(zone => zone.rootMidi))].sort((a, b) => a - b), [48, 60])

  const pack = compileSfzToTloqueSamplePack(compiled.sfzText, {
    id: VCSL_ESTUARY_GRAND_PIANO_PACK.moduleId,
    name: VCSL_ESTUARY_GRAND_PIANO_PACK.displayName,
    instrumentManifestId: VCSL_ESTUARY_GRAND_PIANO_PACK.manifestId,
    license: VCSL_ESTUARY_GRAND_PIANO_PACK.license,
    sourceName: VCSL_ESTUARY_GRAND_PIANO_PACK.libraryName,
    sourceUrl: VCSL_ESTUARY_GRAND_PIANO_PACK.repositoryUrl,
    sourceCommit: VCSL_ESTUARY_GRAND_PIANO_PACK.pinnedCommit,
    sampleUrlForPath: internalUrl,
  })
  assert.equal(pack.instrumentManifestId, "vcsl-estuary-grand-piano")
  assert.deepEqual(pack.micPositions, ["close"])
  assert.equal(pack.defaultMicPosition, "close")
  assert.deepEqual([...new Set(pack.zones.map(zone => zone.velocityLayer))], [0, 1, 2])
})

test("raw VCSL pipe organ selects only Rode Man3 Open samples", () => {
  const source = index([
    { bank: "pipeorgan", url: "pipeorgan/00_Rode_Man3Open_C1.wav" },
    { bank: "pipeorgan", url: "pipeorgan/01_Rode_Man3Open_C2.wav" },
    { bank: "pipeorgan", url: "pipeorgan/06_Rode_Pedal_C1.wav" },
    { bank: "pipeorgan", url: "pipeorgan/09_NT5_Man3Quiet_C1_rr1.wav" },
  ])
  const compiled = compileRawWavIndexToSfz(source, VCSL_ESTUARY_PIPE_ORGAN_PACK)
  const zones = compileCuratedSfzZones(compiled.sfzText)
  assert.equal(compiled.samplePaths.length, 2)
  assert.deepEqual(compiled.samplePaths, [
    "pipeorgan/00_Rode_Man3Open_C1.wav",
    "pipeorgan/01_Rode_Man3Open_C2.wav",
  ])
  assert.equal(zones.length, 2)
  assert.ok(zones.every(zone => zone.loVelocity === 0 && zone.hiVelocity === 127))

  const pack = compileSfzToTloqueSamplePack(compiled.sfzText, {
    id: VCSL_ESTUARY_PIPE_ORGAN_PACK.moduleId,
    name: VCSL_ESTUARY_PIPE_ORGAN_PACK.displayName,
    instrumentManifestId: VCSL_ESTUARY_PIPE_ORGAN_PACK.manifestId,
    license: VCSL_ESTUARY_PIPE_ORGAN_PACK.license,
    sourceName: VCSL_ESTUARY_PIPE_ORGAN_PACK.libraryName,
    sourceUrl: VCSL_ESTUARY_PIPE_ORGAN_PACK.repositoryUrl,
    sourceCommit: VCSL_ESTUARY_PIPE_ORGAN_PACK.pinnedCommit,
    sampleUrlForPath: internalUrl,
  })
  assert.equal(pack.instrumentManifestId, "vcsl-estuary-pipe-organ")
  assert.ok(pack.zones.every(zone => zone.articulation === "normal"))
})

test("VCSL Italian harpsichord keeps physical key-off releases", () => {
  const paths = [
    "Chordophones/Zithers/Harpsichord, Italian/Sustains/stop1/Harpsichord_stop1_A#2_1.wav",
    "Chordophones/Zithers/Harpsichord, Italian/Sustains/stop1/Harpsichord_stop1_B2_1.wav",
    "Chordophones/Zithers/Harpsichord, Italian/Releases/stop1/Harpsichord_stop1-rel_A#2_1.wav",
    "Chordophones/Zithers/Harpsichord, Italian/Releases/stop1/Harpsichord_stop1-rel_B2_1.wav",
  ]
  const compiled = compileRawWavPathsToSfz(paths, VCSL_ITALIAN_HARPSICHORD_PACK)
  const zones = compileCuratedSfzZones(compiled.sfzText)
  assert.equal(zones.filter(zone => zone.trigger === "attack").length, 2)
  assert.equal(zones.filter(zone => zone.trigger === "release").length, 2)

  const pack = compileSfzToTloqueSamplePack(compiled.sfzText, {
    id: VCSL_ITALIAN_HARPSICHORD_PACK.moduleId,
    name: VCSL_ITALIAN_HARPSICHORD_PACK.displayName,
    instrumentManifestId: VCSL_ITALIAN_HARPSICHORD_PACK.manifestId,
    license: VCSL_ITALIAN_HARPSICHORD_PACK.license,
    sourceName: VCSL_ITALIAN_HARPSICHORD_PACK.libraryName,
    sourceUrl: VCSL_ITALIAN_HARPSICHORD_PACK.repositoryUrl,
    sourceCommit: VCSL_ITALIAN_HARPSICHORD_PACK.pinnedCommit,
    sampleUrlForPath: internalUrl,
  })
  assert.equal(pack.instrumentManifestId, "vcsl-italian-harpsichord-stop1")
  assert.equal(pack.zones.filter(zone => zone.trigger === "release").length, 2)
})

test("VCSL keyboard packs resolve through the canonical catalog and manifest registry", () => {
  assert.equal(curatedSamplePackSource("vcsl-estuary-grand-piano")?.moduleId, "vcsl-estuary-grand-piano")
  assert.equal(curatedSamplePackSource("vcsl-estuary-pipe-organ")?.moduleId, "vcsl-estuary-pipe-organ")
  assert.equal(curatedSamplePackSource("vcsl-italian-harpsichord-stop1")?.moduleId, "vcsl-italian-harpsichord-stop1")
  assert.equal(instrumentManifestById("vcsl-estuary-grand-piano"), VCSL_ESTUARY_GRAND_PIANO_MANIFEST)
  assert.equal(instrumentManifestById("vcsl-estuary-pipe-organ"), VCSL_ESTUARY_PIPE_ORGAN_MANIFEST)
  assert.equal(instrumentManifestById("vcsl-italian-harpsichord-stop1"), VCSL_ITALIAN_HARPSICHORD_MANIFEST)
  assert.deepEqual(VCSL_ESTUARY_GRAND_PIANO_MANIFEST.capabilities, ["velocity-layers", "mic-positions"])
  assert.deepEqual(VCSL_ESTUARY_PIPE_ORGAN_MANIFEST.capabilities, [])
  assert.deepEqual(VCSL_ITALIAN_HARPSICHORD_MANIFEST.capabilities, ["release-samples"])
  assert.equal(VCSL_ESTUARY_GRAND_PIANO_MANIFEST.articulations[0].velocityLayers, 3)
  assert.equal(VCSL_ESTUARY_PIPE_ORGAN_MANIFEST.articulations[0].trueLegato, undefined)
  assert.equal(VCSL_ESTUARY_PIPE_ORGAN_MANIFEST.articulations[0].releaseSamples, undefined)
  assert.equal(VCSL_ITALIAN_HARPSICHORD_MANIFEST.articulations[0].releaseSamples, true)
})
