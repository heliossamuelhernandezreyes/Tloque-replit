import test from "node:test"
import assert from "node:assert/strict"
import { CURATED_SAMPLE_PACKS } from "../shared/curated-sample-packs"
import {
  instrumentManifestById,
  VSCO2_CE_CELLO_SECTION_MANIFEST,
  VSCO2_CE_SOLO_CONTRABASS_MANIFEST,
  VSCO2_CE_SOLO_VIOLIN_MANIFEST,
  VSCO2_CE_VIOLA_SECTION_MANIFEST,
} from "../shared/instrument-manifest"
import { compileCuratedSfzZones } from "../server/sfzSamplePackCompiler"

const COMMIT = "6dd651d55dde97fd4028699be9d4481f26917891"

test("VSCO strings registra cuatro paquetes independientes con identidad real", () => {
  const packs = CURATED_SAMPLE_PACKS.filter(pack => pack.instrumentId.startsWith("strings."))
  assert.equal(packs.length, 4)
  assert.equal(new Set(packs.map(pack => pack.moduleId)).size, 4)
  assert.deepEqual(packs.map(pack => pack.displayName), [
    "Solo Violin", "Viola Section", "Cello Section", "Solo Contrabass",
  ])
  for (const pack of packs) {
    assert.equal(pack.pinnedCommit, COMMIT)
    assert.equal(pack.license, "CC0-1.0")
    assert.ok(pack.sfzPath.endsWith("-KS.sfz"))
    assert.deepEqual(pack.sfzPaths, [pack.sfzPath])
    assert.equal(instrumentManifestById(pack.manifestId)?.instruments[0], pack.instrumentId)
  }
})

test("los manifests conservan keyswitches propios de cada instrumento", () => {
  assert.equal(VSCO2_CE_SOLO_VIOLIN_MANIFEST.articulations.find(a => a.articulation === "tremolo")?.keyswitch, 37)
  assert.equal(VSCO2_CE_VIOLA_SECTION_MANIFEST.articulations.find(a => a.articulation === "tremolo")?.keyswitch, 37)
  assert.equal(VSCO2_CE_CELLO_SECTION_MANIFEST.articulations.find(a => a.articulation === "tremolo")?.keyswitch, 85)
  assert.equal(VSCO2_CE_SOLO_CONTRABASS_MANIFEST.articulations.find(a => a.articulation === "pizzicato")?.keyswitch, 88)
})

test("el compilador deriva articulación del sw_label, no del número MIDI", () => {
  const source = String.raw`
<control>
default_path=Strings\Cello Section\trem\
<group>
sw_last=c#6
sw_label=C#6 Tremolo
group_label=gr_1
<region>
sample=trem_C3_v1_rr1.wav lokey=60 hikey=61 pitch_keycenter=60 lovel=0 hivel=62 volume=4
<control>
default_path=Strings\Cello Section\spic\
<group>
sw_last=d6
sw_label=D6 Spiccato
group_label=gr_2
<region>
sample=spic_C3_v2_rr2.wav lokey=60 hikey=61 pitch_keycenter=60 lovel=63 hivel=127 volume=2
`
  const zones = compileCuratedSfzZones(source)
  assert.equal(zones[0].articulation, "tremolo")
  assert.equal(zones[1].articulation, "spiccato")
  assert.equal(zones[1].roundRobin, 1)
  assert.equal(zones[1].velocityLayer, 0)
  assert.equal(zones[0].samplePath, "Strings/Cello Section/trem/trem_C3_v1_rr1.wav")
})

test("contrabajo conserva dos round robins declarados por nombre de muestra", () => {
  const source = String.raw`
<control>
default_path=Strings\Solo Contrabass\Spic\
<group>
sw_last=d#6
sw_label=D#6 Spiccato
group_label=gr_1
<region>
sample=Bass_E1_v1_rr1.wav lokey=40 hikey=40 pitch_keycenter=40 lovel=0 hivel=127
<group>
sw_last=d#6
sw_label=D#6 Spiccato
group_label=gr_2
<region>
sample=Bass_E1_v1_rr2.wav lokey=40 hikey=40 pitch_keycenter=40 lovel=0 hivel=127
`
  const zones = compileCuratedSfzZones(source)
  assert.deepEqual(zones.map(zone => zone.roundRobin), [0, 1])
  assert.ok(zones.every(zone => zone.articulation === "spiccato"))
})
