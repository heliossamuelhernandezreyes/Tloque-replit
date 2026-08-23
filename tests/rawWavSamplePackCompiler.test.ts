import assert from "node:assert/strict"
import test from "node:test"
import { compileRawWavIndexToSfz } from "../server/rawWavSamplePackCompiler"
import { compileCuratedSfzZones } from "../server/sfzSamplePackCompiler"
import {
  VCSL_ESTUARY_GRAND_PIANO_PACK,
  VCSL_ESTUARY_PIPE_ORGAN_PACK,
} from "../shared/curated-raw-wav-packs"

function index(entries: Array<{ bank: string; url: string }>) {
  return JSON.stringify(entries.map((entry, n) => ({ ...entry, n, type: "audio" })))
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
})
