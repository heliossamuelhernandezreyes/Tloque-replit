import test from "node:test"
import assert from "node:assert/strict"
import { DISCORD_MARTIN_HD28_PACK } from "../shared/curated-raw-wav-packs"
import { instrumentManifestById } from "../shared/instrument-manifest"
import { NATIVE_LIBRARY_INDEX, nativeLibraryIntegrityIssues } from "../shared/native-library-index"
import { compileRawWavPathsToSfz } from "../server/rawWavSamplePackCompiler"
import { compileCuratedSfzZones } from "../server/sfzSamplePackCompiler"

test("Martin HD28 conserva fuente CC0 fijada y sólo WAV físicos declarados", () => {
  assert.equal(DISCORD_MARTIN_HD28_PACK.license, "CC0-1.0")
  assert.equal(DISCORD_MARTIN_HD28_PACK.pinnedCommit, "7a9c478fe331f94f246d33332f0adedb25bbbe27")
  assert.equal(DISCORD_MARTIN_HD28_PACK.rawWavStaticPaths?.length, 15)
  assert.ok(DISCORD_MARTIN_HD28_PACK.rawWavStaticPaths?.every(path => path.endsWith(".wav")))
})

test("el perfil Martin HD28 conserva las raíces físicas del nombre de archivo", () => {
  const paths = [
    "Discord GM/Melodic/026-Acoustic Guitar (steel)/MartinGM2_040__E2_1.wav",
    "Discord GM/Melodic/026-Acoustic Guitar (steel)/MartinGM2_043__G2_1.wav",
    "Discord GM/Melodic/026-Acoustic Guitar (steel)/MartinGM2_046_Bb2_1.wav",
  ]
  const { sfzText, samplePaths } = compileRawWavPathsToSfz(paths, DISCORD_MARTIN_HD28_PACK)
  const zones = compileCuratedSfzZones(sfzText)
  assert.deepEqual(samplePaths, paths)
  assert.deepEqual(zones.map(zone => zone.rootMidi), [40, 43, 46])
  assert.deepEqual(zones.map(zone => zone.articulation), ["normal", "normal", "normal"])
})

test("native-auto reconoce guitar.acoustic y el índice deja de marcarla missing", () => {
  assert.ok(instrumentManifestById("discord-martin-hd28")?.instruments.includes("guitar.acoustic"))
  assert.equal(NATIVE_LIBRARY_INDEX.find(item => item.instrumentId === "guitar.acoustic")?.status, "curated")
  assert.deepEqual(nativeLibraryIntegrityIssues(), [])
})
