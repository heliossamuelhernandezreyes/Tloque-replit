import test from "node:test"
import assert from "node:assert/strict"
import { CURATED_SAMPLE_PACKS } from "../shared/curated-sample-packs"
import {
  instrumentManifestById,
  VSCO2_CE_BASSOON_MANIFEST,
  VSCO2_CE_CLARINET_MANIFEST,
  VSCO2_CE_FLUTE_MANIFEST,
  VSCO2_CE_OBOE_MANIFEST,
} from "../shared/instrument-manifest"
import { compileCuratedSfzZones, compileSfzBundleToTloqueSamplePack } from "../server/sfzSamplePackCompiler"

const COMMIT = "6dd651d55dde97fd4028699be9d4481f26917891"

test("VSCO woodwinds registra flauta, clarinete, oboe y fagot con colores grabados verificados", () => {
  const packs = CURATED_SAMPLE_PACKS.filter(pack => pack.instrumentId.startsWith("woodwinds.") && pack.id.startsWith("vsco2-ce-"))
  assert.deepEqual(packs.map(pack => pack.displayName), ["Flute", "Clarinet", "Oboe", "Bassoon"])
  assert.equal(new Set(packs.map(pack => pack.moduleId)).size, 4)
  for (const pack of packs) {
    assert.equal(pack.pinnedCommit, COMMIT)
    assert.equal(pack.license, "CC0-1.0")
    assert.equal(instrumentManifestById(pack.manifestId)?.instruments[0], pack.instrumentId)
  }
  const oboe = packs.find(pack => pack.id === "vsco2-ce-oboe")
  const bassoon = packs.find(pack => pack.id === "vsco2-ce-bassoon")
  assert.deepEqual(oboe?.sfzPaths, ["OboeSusNV.sfz", "OboeSusVib.sfz", "OboeStac.sfz"])
  assert.deepEqual(bassoon?.sfzPaths, ["BassoonSus.sfz", "BassoonVib.sfz", "BassoonStac.sfz"])
  assert.ok(oboe?.tags.includes("recorded-vibrato"))
  assert.ok(bassoon?.tags.includes("recorded-vibrato"))
})

test("manifests de maderas conservan GM base y sólo articulaciones modeladas", () => {
  assert.deepEqual(VSCO2_CE_FLUTE_MANIFEST.basePrograms, [73])
  assert.deepEqual(VSCO2_CE_CLARINET_MANIFEST.basePrograms, [71])
  assert.deepEqual(VSCO2_CE_OBOE_MANIFEST.basePrograms, [68])
  assert.deepEqual(VSCO2_CE_BASSOON_MANIFEST.basePrograms, [70])

  assert.equal(VSCO2_CE_FLUTE_MANIFEST.articulations.find(a => a.articulation === "normal")?.keyswitch, 36)
  assert.equal(VSCO2_CE_FLUTE_MANIFEST.articulations.find(a => a.articulation === "staccato")?.keyswitch, 39)
  assert.equal(VSCO2_CE_CLARINET_MANIFEST.articulations.find(a => a.articulation === "staccato")?.keyswitch, 37)
  assert.deepEqual(VSCO2_CE_FLUTE_MANIFEST.articulations.map(a => a.articulation), ["normal", "staccato"])
})

test("un bundle de sustain y staccato se convierte en un solo instrumento nativo", () => {
  const sustain = String.raw`
<control>
default_path=Woodwinds\Oboe\Sus\
<group>
<region>
sample=Oboe_Sus_D4_v1.wav lokey=72 hikey=75 pitch_keycenter=74 lovel=0 hivel=62 volume=12
<region>
sample=Oboe_Sus_D4_v2.wav lokey=72 hikey=75 pitch_keycenter=74 lovel=63 hivel=127 volume=4
`
  const staccato = String.raw`
<control>
default_path=Woodwinds\Oboe\Stacc\
<group>
group_label=gr_1
<region>
sample=Oboe_Stacc_D4_v1_rr1.wav lokey=72 hikey=75 pitch_keycenter=74 lovel=0 hivel=127 volume=10
<group>
group_label=gr_2
<region>
sample=Oboe_Stacc_D4_v1_rr2.wav lokey=72 hikey=75 pitch_keycenter=74 lovel=0 hivel=127 volume=10
`

  const pack = compileSfzBundleToTloqueSamplePack([sustain, staccato], {
    id: "vsco2-ce-oboe",
    name: "VSCO 2 CE · Oboe",
    instrumentManifestId: "vsco2-ce-oboe",
    license: "CC0-1.0",
    sourceName: "VSCO 2 Community Edition",
    sourceUrl: "https://github.com/sgossner/VSCO-2-CE",
    sourceCommit: COMMIT,
    sampleUrlForPath: path => `/api/audio/sample-packs/samples/${path.includes("rr2") ? "b".repeat(64) : "a".repeat(64)}.wav`,
  })

  assert.equal(pack.instrumentManifestId, "vsco2-ce-oboe")
  assert.deepEqual([...new Set(pack.zones.map(zone => zone.articulation))], ["normal", "staccato"])
  assert.deepEqual(pack.zones.filter(zone => zone.articulation === "staccato").map(zone => zone.roundRobin), [0, 1])
  assert.equal(pack.zones.filter(zone => zone.articulation === "normal").length, 2)
})

test("un patch KS de flauta conserva vibrato como timbre y no como técnica inexistente", () => {
  const source = String.raw`
<control>
default_path=Woodwinds\Flute\susNV\
<group>
sw_last=c2
sw_label=C2 Sustain Non-Vibrato
<region>
sample=flute_nv.wav lokey=60 hikey=72 pitch_keycenter=60 lovel=0 hivel=127
<control>
default_path=Woodwinds\Flute\susvib\
<group>
sw_last=c#2
sw_label=C#2 Sustain Vibrato
<region>
sample=flute_vib.wav lokey=60 hikey=72 pitch_keycenter=60 lovel=0 hivel=127
<control>
default_path=Woodwinds\Flute\stac\
<group>
sw_last=d#2
sw_label=D#2 Staccato
group_label=stac_gr_1
<region>
sample=flute_stac_rr1.wav lokey=60 hikey=72 pitch_keycenter=60 lovel=0 hivel=127
`
  const zones = compileCuratedSfzZones(source)
  assert.deepEqual(zones.map(zone => zone.articulation), ["normal", "normal", "staccato"])
  assert.deepEqual(zones.map(zone => zone.vibratoColour), ["none", "vibrato", "none"])
})
