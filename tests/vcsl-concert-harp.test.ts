import test from "node:test"
import assert from "node:assert/strict"
import { VCSL_CONCERT_HARP_PACK } from "../shared/curated-raw-wav-packs"
import { instrumentManifestById } from "../shared/instrument-manifest"
import { NATIVE_LIBRARY_INDEX, nativeLibraryIntegrityIssues } from "../shared/native-library-index"
import { compileRawWavPathsToSfz } from "../server/rawWavSamplePackCompiler"
import { compileCuratedSfzZones } from "../server/sfzSamplePackCompiler"

test("VCSL Concert Harp conserva fuente CC0 fijada", () => {
  assert.equal(VCSL_CONCERT_HARP_PACK.license, "CC0-1.0")
  assert.equal(VCSL_CONCERT_HARP_PACK.rawWavStaticPaths?.length, 45)
})

test("el arpa compila dos capas físicas", () => {
  const paths = [
    "Chordophones/Composite Chordophones/Concert Harp/KSHarp_E1_f1.wav",
    "Chordophones/Composite Chordophones/Concert Harp/KSHarp_G1_mp1.wav",
    "Chordophones/Composite Chordophones/Concert Harp/KSHarp_B1_f1.wav",
    "Chordophones/Composite Chordophones/Concert Harp/KSHarp_B1_mf1.wav",
  ]
  const { sfzText } = compileRawWavPathsToSfz(paths, VCSL_CONCERT_HARP_PACK)
  const zones = compileCuratedSfzZones(sfzText)
  assert.equal(new Set(zones.map(zone => zone.velocityLayer)).size, 2)
  assert.ok(zones.some(zone => zone.loVelocity === 88 && zone.hiVelocity === 127))
  assert.ok(zones.some(zone => zone.loVelocity === 0 && zone.hiVelocity === 87))
})

test("native-auto reconoce strings.harp", () => {
  assert.ok(instrumentManifestById("vcsl-concert-harp")?.instruments.includes("strings.harp"))
  assert.equal(NATIVE_LIBRARY_INDEX.find(item => item.instrumentId === "strings.harp")?.status, "curated")
  assert.deepEqual(nativeLibraryIntegrityIssues(), [])
})
