import test from "node:test"
import assert from "node:assert/strict"
import { IOWA_BASS_CLARINET_FF_PACK, IOWA_BASS_TROMBONE_FF_PACK } from "../shared/curated-external-pcm-packs"
import { compileExternalPcmPathsToSfz } from "../server/externalPcmSamplePackCompiler"
import { compileCuratedSfzZones } from "../server/sfzSamplePackCompiler"
import { fixedExternalPcmUrl } from "../server/externalPcmInstaller"
import { NATIVE_LIBRARY_INDEX, nativeLibraryIntegrityIssues } from "../shared/native-library-index"
import { preferredNativeModuleForInstrument } from "../client/src/audio/NativeAutoModule"

test("Iowa Bass Clarinet conserva 46 raíces cromáticas físicas Db2-Bb5", () => {
  assert.equal(IOWA_BASS_CLARINET_FF_PACK.externalPaths.length, 46)
  const compiled = compileExternalPcmPathsToSfz(IOWA_BASS_CLARINET_FF_PACK.externalPaths, IOWA_BASS_CLARINET_FF_PACK.mappingProfile)
  const zones = compileCuratedSfzZones(compiled.sfzText)
  assert.equal(zones.length, 46)
  assert.equal(zones[0].rootMidi, 37)
  assert.equal(zones.at(-1)?.rootMidi, 82)
  assert.ok(zones.every(zone => zone.loMidi === zone.rootMidi && zone.hiMidi === zone.rootMidi))
})

test("Iowa Bass Trombone conserva 27 raíces cromáticas físicas Db1-Eb3", () => {
  assert.equal(IOWA_BASS_TROMBONE_FF_PACK.externalPaths.length, 27)
  const compiled = compileExternalPcmPathsToSfz(IOWA_BASS_TROMBONE_FF_PACK.externalPaths, IOWA_BASS_TROMBONE_FF_PACK.mappingProfile)
  const zones = compileCuratedSfzZones(compiled.sfzText)
  assert.equal(zones.length, 27)
  assert.equal(zones[0].rootMidi, 25)
  assert.equal(zones.at(-1)?.rootMidi, 51)
})

test("las URLs Iowa sólo pueden salir de su base HTTPS fijada", () => {
  const first = IOWA_BASS_CLARINET_FF_PACK.externalPaths[0]
  const url = fixedExternalPcmUrl(IOWA_BASS_CLARINET_FF_PACK, first)
  assert.match(url, /^https:\/\/theremin\.music\.uiowa\.edu\/sound%20files\/MIS%20Pitches%20-%202014\/Woodwinds\/Bass%20Clarinet\//)
  assert.throws(() => fixedExternalPcmUrl(IOWA_BASS_CLARINET_FF_PACK, "../escape.aif"), /inválida|fuera/)
})

test("native-auto e índice reconocen los dos nuevos instrumentos sin inconsistencias", () => {
  assert.equal(preferredNativeModuleForInstrument("woodwinds.bass-clarinet"), "iowa-mis-bass-clarinet-ff")
  assert.equal(preferredNativeModuleForInstrument("brass.bass-trombone"), "iowa-mis-bass-trombone-ff")
  assert.equal(NATIVE_LIBRARY_INDEX.find(item => item.instrumentId === "woodwinds.bass-clarinet")?.status, "curated")
  assert.equal(NATIVE_LIBRARY_INDEX.find(item => item.instrumentId === "brass.bass-trombone")?.status, "curated")
  assert.deepEqual(nativeLibraryIntegrityIssues(), [])
})
