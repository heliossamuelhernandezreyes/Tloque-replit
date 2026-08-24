import test from "node:test"
import assert from "node:assert/strict"
import { CURATED_SAMPLE_PACKS } from "../shared/curated-sample-packs"
import { instrumentManifestById } from "../shared/instrument-manifest"
import { NATIVE_LIBRARY_INDEX, nativeLibraryIntegrityIssues } from "../shared/native-library-index"
import { compileCuratedSfzZones } from "../server/sfzSamplePackCompiler"

const sustain = `<control> default_path=Woodwinds\\Piccolo\\Sus\\\n<group>\n<region> sample=piccolo_G4_sustain1.wav lokey=67 hikey=69 pitch_keycenter=67 lovel=0 hivel=127`
const staccato = `<control> default_path=Woodwinds\\Piccolo\\Stac\\\n<group> sw_label=Staccato\n<region> sample=piccolo_A#4_staccato1.wav lokey=70 hikey=74 pitch_keycenter=70 lovel=0 hivel=127`

test("el Piccolo VSCO usa únicamente sustain y staccato físicos declarados", () => {
  const pack = CURATED_SAMPLE_PACKS.find(item => item.id === "vsco2-ce-piccolo")
  assert.ok(pack)
  assert.equal(pack.license, "CC0-1.0")
  assert.deepEqual(pack.sfzPaths, ["PiccoloSus.sfz", "PiccoloStac.sfz"])
  assert.equal(pack.pinnedCommit, "6dd651d55dde97fd4028699be9d4481f26917891")
  assert.equal(compileCuratedSfzZones(sustain)[0].articulation, "normal")
  assert.equal(compileCuratedSfzZones(staccato)[0].articulation, "staccato")
})

test("native-auto reconoce woodwinds.piccolo y el índice deja de marcarlo missing", () => {
  assert.ok(instrumentManifestById("vsco2-ce-piccolo")?.instruments.includes("woodwinds.piccolo"))
  assert.equal(NATIVE_LIBRARY_INDEX.find(item => item.instrumentId === "woodwinds.piccolo")?.status, "curated")
  assert.deepEqual(nativeLibraryIntegrityIssues(), [])
})
