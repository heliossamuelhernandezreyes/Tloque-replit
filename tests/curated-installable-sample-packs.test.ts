import test from "node:test"
import assert from "node:assert/strict"
import { CURATED_INSTALLABLE_SAMPLE_PACKS } from "../shared/curated-installable-sample-packs"
import { CURATED_SAMPLE_PACKS } from "../shared/curated-sample-packs"
import { CURATED_RAW_WAV_PACKS } from "../shared/curated-raw-wav-packs"
import { CURATED_EXTERNAL_PCM_PACKS } from "../shared/curated-external-pcm-packs"

test("el catálogo instalable unifica SFZ, raw WAV y PCM institucional", () => {
  assert.equal(
    CURATED_INSTALLABLE_SAMPLE_PACKS.length,
    CURATED_SAMPLE_PACKS.length + CURATED_RAW_WAV_PACKS.length + CURATED_EXTERNAL_PCM_PACKS.length,
  )
  assert.ok(CURATED_INSTALLABLE_SAMPLE_PACKS.some(pack => pack.id === "discord-martin-hd28"))
  assert.ok(CURATED_INSTALLABLE_SAMPLE_PACKS.some(pack => pack.id === "iowa-mis-bass-clarinet-ff"))
  assert.ok(CURATED_INSTALLABLE_SAMPLE_PACKS.some(pack => pack.id === "iowa-mis-bass-trombone-ff"))
})

test("el catálogo instalable no contiene ids ni moduleIds duplicados", () => {
  const ids = CURATED_INSTALLABLE_SAMPLE_PACKS.map(pack => pack.id)
  const modules = CURATED_INSTALLABLE_SAMPLE_PACKS.map(pack => pack.moduleId)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(new Set(modules).size, modules.length)
})

test("todo pack instalable conserva contrato de publicación", () => {
  for (const pack of CURATED_INSTALLABLE_SAMPLE_PACKS) {
    assert.ok(pack.samplePackInstall, `${pack.id} no declara samplePackInstall`)
    assert.equal(pack.samplePackInstall?.moduleId, pack.moduleId)
    assert.equal(pack.samplePackInstall?.manifestId, pack.manifestId)
    assert.ok(pack.acknowledgement.trim().length > 20)
    assert.ok(pack.repositoryUrl.startsWith("https://"))
  }
})
