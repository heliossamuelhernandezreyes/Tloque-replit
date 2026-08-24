import test from "node:test"
import assert from "node:assert/strict"
import { compileRawWavPathsToSfz } from "../server/rawWavSamplePackCompiler"
import {
  VCSL_ESTUARY_OCARINA_PACK,
  VCSL_ESTUARY_ALTO_RECORDER_PACK,
  VCSL_ESTUARY_PIPE_ORGAN_PACK,
  VCSL_ESTUARY_PIPE_ORGAN_SOFT_PACK,
  VCSL_ESTUARY_PIPE_ORGAN_PEDAL_PACK,
} from "../shared/curated-raw-wav-packs"
import { instrumentManifestById } from "../shared/instrument-manifest"
import { preferredNativeModuleForInstrument } from "../client/src/audio/NativeAutoModule"

test("native-auto resolves ocarina and alto recorder to physical VCSL packs", () => {
  assert.equal(preferredNativeModuleForInstrument("woodwinds.ocarina"), "vcsl-estuary-ocarina")
  assert.equal(preferredNativeModuleForInstrument("woodwinds.alto-recorder"), "vcsl-estuary-alto-recorder")
  assert.equal(VCSL_ESTUARY_OCARINA_PACK.rawWavBank, "ocarina")
  assert.equal(VCSL_ESTUARY_ALTO_RECORDER_PACK.rawWavBank, "altorecorder")
})

test("ocarina and recorder preserve their recorded staccato instead of synthesizing it", () => {
  const ocarina = compileRawWavPathsToSfz([
    "ocarina/00_StdOcarina_Sus_C5.wav",
    "ocarina/04_ocarina_C6_staccato0.wav",
    "ocarina/01_StdOcarina_SusVib_C4.wav",
  ], VCSL_ESTUARY_OCARINA_PACK)
  assert.match(ocarina.sfzText, /sw_label=normal/)
  assert.match(ocarina.sfzText, /sw_label=staccato/)
  assert.equal(ocarina.samplePaths.includes("ocarina/01_StdOcarina_SusVib_C4.wav"), false)

  const recorder = compileRawWavPathsToSfz([
    "altorecorder/AltRecorder_Sus_C4_rr1_Main.wav",
    "altorecorder/AltRecorder_Stac_C4_rr1_Main.wav",
    "altorecorder/AltRecorder_SusVib_C4_rr1_Main.wav",
  ], VCSL_ESTUARY_ALTO_RECORDER_PACK)
  assert.match(recorder.sfzText, /sw_label=normal/)
  assert.match(recorder.sfzText, /sw_label=staccato/)
  assert.equal(recorder.samplePaths.includes("altorecorder/AltRecorder_SusVib_C4_rr1_Main.wav"), false)
})

test("pipe organ exposes open manual, quiet manual and pedal as independent physical layers", () => {
  assert.equal(preferredNativeModuleForInstrument("keys.pipe-organ"), "vcsl-estuary-pipe-organ")
  assert.equal(preferredNativeModuleForInstrument("keys.pipe-organ-soft"), "vcsl-estuary-pipe-organ-soft")
  assert.equal(preferredNativeModuleForInstrument("keys.pipe-organ-pedal"), "vcsl-estuary-pipe-organ-pedal")

  const open = compileRawWavPathsToSfz(["pipeorgan/00_Rode_Man3Open_C1.wav"], VCSL_ESTUARY_PIPE_ORGAN_PACK)
  const soft = compileRawWavPathsToSfz(["pipeorgan/09_NT5_Man3Quiet_C1_rr1.wav"], VCSL_ESTUARY_PIPE_ORGAN_SOFT_PACK)
  const pedal = compileRawWavPathsToSfz(["pipeorgan/06_Rode_Pedal_C1.wav"], VCSL_ESTUARY_PIPE_ORGAN_PEDAL_PACK)
  assert.deepEqual(open.samplePaths, ["pipeorgan/00_Rode_Man3Open_C1.wav"])
  assert.deepEqual(soft.samplePaths, ["pipeorgan/09_NT5_Man3Quiet_C1_rr1.wav"])
  assert.deepEqual(pedal.samplePaths, ["pipeorgan/06_Rode_Pedal_C1.wav"])
})

test("new manifests promise only capabilities actually curated", () => {
  const ocarina = instrumentManifestById("vcsl-estuary-ocarina")!
  const recorder = instrumentManifestById("vcsl-estuary-alto-recorder")!
  const pedal = instrumentManifestById("vcsl-estuary-pipe-organ-pedal")!
  assert.deepEqual(ocarina.articulations.map(item => item.articulation), ["normal", "staccato"])
  assert.deepEqual(recorder.articulations.map(item => item.articulation), ["normal", "staccato"])
  assert.deepEqual(pedal.capabilities, [])
})
