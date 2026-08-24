import test from "node:test"
import assert from "node:assert/strict"
import { SAMPLED_CELESTA_TUNED_DENOISED_MIX_PACK } from "../shared/curated-external-pcm-packs"
import { instrumentManifestById } from "../shared/instrument-manifest"
import { NATIVE_LIBRARY_INDEX, nativeLibraryIntegrityIssues } from "../shared/native-library-index"
import { compileExternalPcmPathsToSfz } from "../server/externalPcmSamplePackCompiler"
import { compileCuratedSfzZones } from "../server/sfzSamplePackCompiler"
import { fixedExternalPcmUrl } from "../server/externalPcmInstaller"

test("A Sampled Celesta conserva fuente CC0 y revisión GitLab fijada", () => {
  const source = SAMPLED_CELESTA_TUNED_DENOISED_MIX_PACK
  assert.equal(source.license, "CC0-1.0")
  assert.equal(source.pinnedCommit, "934c7fd6")
  assert.equal(source.gitlabProjectId, 18547990)
  assert.equal(source.inputFormat, "wav")
  assert.equal(source.externalPaths.length, 48)
  assert.ok(source.externalPaths.every(path => path.startsWith("Samples/Tuned/Denoised Mix/") && path.endsWith(" rr1.wav")))
})

test("GitLab LFS se consulta por project id + commit y nunca por una URL del cliente", () => {
  const source = SAMPLED_CELESTA_TUNED_DENOISED_MIX_PACK
  const url = fixedExternalPcmUrl(source, source.externalPaths[0])
  assert.match(url, /^https:\/\/gitlab\.com\/api\/v4\/projects\/18547990\/repository\/files\//)
  assert.match(url, /ref=934c7fd6/)
  assert.match(url, /lfs=true/)
  assert.ok(url.includes(encodeURIComponent("Samples/Tuned/Denoised Mix/C4 rr1.wav")))
})

test("celesta cubre C4-C8 con raíces físicas y sólo un semitono máximo en F5", () => {
  const source = SAMPLED_CELESTA_TUNED_DENOISED_MIX_PACK
  const compiled = compileExternalPcmPathsToSfz(source.externalPaths, source.mappingProfile)
  const zones = compileCuratedSfzZones(compiled.sfzText)
  assert.equal(zones.length, 48)
  const playable = new Set<number>()
  let maxShift = 0
  for (const zone of zones) {
    for (let midi = zone.loMidi; midi <= zone.hiMidi; midi += 1) {
      playable.add(midi)
      maxShift = Math.max(maxShift, Math.abs(midi - zone.rootMidi))
    }
  }
  assert.deepEqual([...playable].sort((a, b) => a - b), Array.from({ length: 49 }, (_, index) => 60 + index))
  assert.equal(maxShift, 1)
  assert.ok(zones.some(zone => zone.loMidi <= 77 && zone.hiMidi >= 77 && zone.rootMidi !== 77))
})

test("native-auto ya reconoce keys.celesta como banco físico curado", () => {
  const manifest = instrumentManifestById("sampled-celesta-tuned-denoised-mix")
  assert.ok(manifest?.instruments.includes("keys.celesta"))
  const entry = NATIVE_LIBRARY_INDEX.find(item => item.instrumentId === "keys.celesta")
  assert.equal(entry?.status, "curated")
  assert.equal(entry?.moduleId, "sampled-celesta-tuned-denoised-mix")
  assert.deepEqual(nativeLibraryIntegrityIssues(), [])
})
