import test from "node:test"
import assert from "node:assert/strict"
import { CURATED_SAMPLE_PACKS } from "../shared/curated-sample-packs"
import {
  instrumentManifestById,
  VSCO2_CE_F_HORN_MANIFEST,
  VSCO2_CE_TENOR_TROMBONE_MANIFEST,
  VSCO2_CE_TRUMPET_MANIFEST,
  VSCO2_CE_TUBA_MANIFEST,
} from "../shared/instrument-manifest"
import { compileCuratedSfzZones, compileSfzBundleToTloqueSamplePack } from "../server/sfzSamplePackCompiler"

const COMMIT = "6dd651d55dde97fd4028699be9d4481f26917891"

test("VSCO brass registra trompeta, trombón tenor, corno en Fa y tuba como módulos independientes", () => {
  const packs = CURATED_SAMPLE_PACKS.filter(pack => pack.instrumentId.startsWith("brass."))
  assert.deepEqual(packs.map(pack => pack.displayName), ["Trumpet", "Tenor Trombone", "F Horn", "Tuba"])
  assert.equal(new Set(packs.map(pack => pack.moduleId)).size, 4)
  for (const pack of packs) {
    assert.equal(pack.pinnedCommit, COMMIT)
    assert.equal(pack.license, "CC0-1.0")
    assert.equal(instrumentManifestById(pack.manifestId)?.instruments[0], pack.instrumentId)
  }
  assert.deepEqual(packs.find(pack => pack.id === "vsco2-ce-trumpet")?.sfzPaths, ["TrumpetSus.sfz", "TrumpetStac.sfz"])
  assert.deepEqual(packs.find(pack => pack.id === "vsco2-ce-tenor-trombone")?.sfzPaths, ["TromboneSus.sfz", "TromboneStac.sfz"])
  assert.deepEqual(packs.find(pack => pack.id === "vsco2-ce-f-horn")?.sfzPaths, ["FHornSus.sfz", "FHornStac.sfz"])
  assert.deepEqual(packs.find(pack => pack.id === "vsco2-ce-tuba")?.sfzPaths, ["Tuba-KS.sfz"])
})

test("manifests de metales conservan sus programas GM y sólo técnicas abiertas modeladas", () => {
  assert.deepEqual(VSCO2_CE_TRUMPET_MANIFEST.basePrograms, [56])
  assert.deepEqual(VSCO2_CE_TENOR_TROMBONE_MANIFEST.basePrograms, [57])
  assert.deepEqual(VSCO2_CE_TUBA_MANIFEST.basePrograms, [58])
  assert.deepEqual(VSCO2_CE_F_HORN_MANIFEST.basePrograms, [60])

  assert.deepEqual(VSCO2_CE_TRUMPET_MANIFEST.articulations.map(a => a.articulation), ["normal", "staccato"])
  assert.deepEqual(VSCO2_CE_TENOR_TROMBONE_MANIFEST.articulations.map(a => a.articulation), ["normal", "staccato"])
  assert.deepEqual(VSCO2_CE_F_HORN_MANIFEST.articulations.map(a => a.articulation), ["normal", "staccato"])
  assert.equal(VSCO2_CE_TRUMPET_MANIFEST.articulations.find(a => a.articulation === "staccato")?.roundRobins, 2)
  assert.equal(VSCO2_CE_TENOR_TROMBONE_MANIFEST.articulations.find(a => a.articulation === "staccato")?.roundRobins, 2)
  assert.equal(VSCO2_CE_F_HORN_MANIFEST.articulations.find(a => a.articulation === "staccato")?.roundRobins, 2)
})

test("tuba conserva keyswitches y cuatro round robins reales", () => {
  assert.equal(VSCO2_CE_TUBA_MANIFEST.articulations.find(a => a.articulation === "normal")?.keyswitch, 84)
  const staccato = VSCO2_CE_TUBA_MANIFEST.articulations.find(a => a.articulation === "staccato")
  assert.equal(staccato?.keyswitch, 85)
  assert.equal(staccato?.roundRobins, 4)

  const source = String.raw`
<control>
default_path=Brass\Tuba\sus\
<group>
sw_last=c6
sw_label=C6 Sustain
<region>
sample=tuba_sus.wav lokey=36 hikey=48 pitch_keycenter=41 lovel=0 hivel=127
<control>
default_path=Brass\Tuba\stac\
<group>
sw_last=c#6
sw_label=C#6 Staccato
seq_length=4
seq_position=1
<region>
sample=tuba_stac_rr1.wav lokey=36 hikey=48 pitch_keycenter=41 lovel=0 hivel=127
<group>
sw_last=c#6
sw_label=C#6 Staccato
seq_length=4
seq_position=4
<region>
sample=tuba_stac_rr4.wav lokey=36 hikey=48 pitch_keycenter=41 lovel=0 hivel=127
`
  const zones = compileCuratedSfzZones(source)
  assert.deepEqual(zones.map(zone => zone.articulation), ["normal", "staccato", "staccato"])
  assert.deepEqual(zones.filter(zone => zone.articulation === "staccato").map(zone => zone.roundRobin), [0, 3])
})

test("bundle de trompeta publica sustain y staccato sin mezclar sordinas ni vibrato", () => {
  const sustain = String.raw`
<control>
default_path=Brass\Trumpet\sus\
<group>
<region>
sample=trumpet_sus_v1.wav lokey=55 hikey=58 pitch_keycenter=57 lovel=0 hivel=62
<region>
sample=trumpet_sus_v3.wav lokey=55 hikey=58 pitch_keycenter=57 lovel=63 hivel=127
`
  const staccato = String.raw`
<control>
default_path=Brass\Trumpet\stac\
<group>
group_label=gr_1
<region>
sample=trumpet_stac_v1_rr1.wav lokey=55 hikey=58 pitch_keycenter=57 lovel=0 hivel=127
<group>
group_label=gr_2
<region>
sample=trumpet_stac_v1_rr2.wav lokey=55 hikey=58 pitch_keycenter=57 lovel=0 hivel=127
`
  const pack = compileSfzBundleToTloqueSamplePack([sustain, staccato], {
    id: "vsco2-ce-trumpet",
    name: "VSCO 2 CE · Trumpet",
    instrumentManifestId: "vsco2-ce-trumpet",
    license: "CC0-1.0",
    sourceName: "VSCO 2 Community Edition",
    sourceUrl: "https://github.com/sgossner/VSCO-2-CE",
    sourceCommit: COMMIT,
    sampleUrlForPath: path => `/api/audio/sample-packs/samples/${path.includes("rr2") ? "b".repeat(64) : "a".repeat(64)}.wav`,
  })

  assert.deepEqual([...new Set(pack.zones.map(zone => zone.articulation))], ["normal", "staccato"])
  assert.deepEqual(pack.zones.filter(zone => zone.articulation === "staccato").map(zone => zone.roundRobin), [0, 1])
  assert.ok(pack.zones.every(zone => !/mute|vib/i.test(zone.sampleUrl)))
})

test("catálogo principal no instala silenciosamente patches mute o vibrato de brass", () => {
  const brassPaths = CURATED_SAMPLE_PACKS
    .filter(pack => pack.instrumentId.startsWith("brass."))
    .flatMap(pack => pack.sfzPaths)
  assert.ok(!brassPaths.includes("TrumpetHarmonMuteSus.sfz"))
  assert.ok(!brassPaths.includes("TrumpetStraightMuteSus.sfz"))
  assert.ok(!brassPaths.includes("TrumpetSusVib.sfz"))
  assert.ok(!brassPaths.includes("FHornMute.sfz"))
  assert.ok(!brassPaths.includes("TromboneVib.sfz"))
})
