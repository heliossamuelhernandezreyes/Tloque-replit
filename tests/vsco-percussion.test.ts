import test from "node:test"
import assert from "node:assert/strict"
import { compileTloqueScore } from "../shared/audio"
import { CURATED_SAMPLE_PACKS } from "../shared/curated-sample-packs"
import {
  instrumentManifestById,
  VSCO2_CE_GLOCKENSPIEL_MANIFEST,
  VSCO2_CE_MARIMBA_MANIFEST,
  VSCO2_CE_ORCHESTRAL_PERCUSSION_MANIFEST,
  VSCO2_CE_TIMPANI_MANIFEST,
  VSCO2_CE_TUBULAR_BELLS_MANIFEST,
  VSCO2_CE_XYLOPHONE_MANIFEST,
} from "../shared/instrument-manifest"
import { compileCuratedSfzZones, compileSfzBundleToTloqueSamplePack } from "../server/sfzSamplePackCompiler"

const COMMIT = "6dd651d55dde97fd4028699be9d4481f26917891"

test("VSCO percussion registra cinco afinados y un kit orquestal semántico", () => {
  const packs = CURATED_SAMPLE_PACKS.filter(pack => pack.instrumentId.startsWith("percussion."))
  assert.deepEqual(packs.map(pack => pack.displayName), ["Timpani", "Glockenspiel", "Marimba", "Xylophone", "Tubular Bells", "Orchestral Percussion"])
  assert.equal(new Set(packs.map(pack => pack.moduleId)).size, 6)
  for (const pack of packs) {
    assert.equal(pack.pinnedCommit, COMMIT)
    assert.equal(pack.license, "CC0-1.0")
    assert.equal(instrumentManifestById(pack.manifestId)?.instruments[0], pack.instrumentId)
  }
  assert.deepEqual(packs.find(pack => pack.id === "vsco2-ce-timpani")?.sfzPaths, ["Timpani.sfz", "TimpaniRolls.sfz"])
  assert.deepEqual(packs.find(pack => pack.id === "vsco2-ce-orchestral-percussion")?.sfzPaths, ["GM-StylePerc.sfz"])
})

test("manifests de percusión conservan programas GM y no inventan capacidades", () => {
  assert.deepEqual(VSCO2_CE_TIMPANI_MANIFEST.basePrograms, [47])
  assert.deepEqual(VSCO2_CE_GLOCKENSPIEL_MANIFEST.basePrograms, [9])
  assert.deepEqual(VSCO2_CE_MARIMBA_MANIFEST.basePrograms, [12])
  assert.deepEqual(VSCO2_CE_XYLOPHONE_MANIFEST.basePrograms, [13])
  assert.deepEqual(VSCO2_CE_TUBULAR_BELLS_MANIFEST.basePrograms, [14])
  assert.deepEqual(VSCO2_CE_TIMPANI_MANIFEST.articulations.map(item => item.articulation), ["normal", "tremolo"])
  assert.equal(VSCO2_CE_TIMPANI_MANIFEST.articulations[0].velocityLayers, 3)
  assert.equal(VSCO2_CE_TIMPANI_MANIFEST.articulations[0].roundRobins, 2)
  assert.equal(VSCO2_CE_TIMPANI_MANIFEST.articulations[1].velocityLayers, 2)
  for (const manifest of [VSCO2_CE_GLOCKENSPIEL_MANIFEST, VSCO2_CE_MARIMBA_MANIFEST, VSCO2_CE_XYLOPHONE_MANIFEST, VSCO2_CE_TUBULAR_BELLS_MANIFEST]) {
    assert.deepEqual(manifest.capabilities, [])
    assert.deepEqual(manifest.articulations.map(item => item.articulation), ["normal"])
  }
  assert.deepEqual(VSCO2_CE_ORCHESTRAL_PERCUSSION_MANIFEST.basePrograms, [])
  assert.deepEqual(VSCO2_CE_ORCHESTRAL_PERCUSSION_MANIFEST.capabilities, ["velocity-layers", "round-robin"])
})

test("un directorio Rolls se compila como tremolo grabado, no como sustain", () => {
  const roll = String.raw`
<control>
default_path=Percussion\Timpani\Rolls\
<group>
<region>
sample=Timpani1_Roll_v3_rr1_Sum.wav lokey=36 hikey=43 pitch_keycenter=42 lovel=0 hivel=80 volume=14
<region>
sample=Timpani1_Roll_v5_rr1_Sum.wav lokey=36 hikey=43 pitch_keycenter=42 lovel=81 hivel=127 volume=4
`
  const zones = compileCuratedSfzZones(roll)
  assert.deepEqual(zones.map(zone => zone.articulation), ["tremolo", "tremolo"])
  assert.deepEqual(zones.map(zone => zone.velocityLayer), [0, 1])
})

test("timbales conservan velocity layers y round robin físicos al combinar hits y rolls", () => {
  const hits = String.raw`
<control>
default_path=Percussion\Timpani\
<group>
seq_length=2
seq_position=1
<region>
sample=Timpani1_Hit_v1_rr1_Sum.wav lokey=36 hikey=43 pitch_keycenter=42 lovel=0 hivel=80 volume=27
<region>
sample=Timpani1_Hit_v3_rr1_Sum.wav lokey=36 hikey=43 pitch_keycenter=42 lovel=81 hivel=127 volume=17
<group>
seq_length=2
seq_position=2
<region>
sample=Timpani1_Hit_v1_rr2_Sum.wav lokey=36 hikey=43 pitch_keycenter=42 lovel=0 hivel=80 volume=27
<region>
sample=Timpani1_Hit_v3_rr2_Sum.wav lokey=36 hikey=43 pitch_keycenter=42 lovel=81 hivel=127 volume=12
`
  const rolls = String.raw`
<control>
default_path=Percussion\Timpani\Rolls\
<group>
<region>
sample=Timpani1_Roll_v3_rr1_Sum.wav lokey=36 hikey=43 pitch_keycenter=42 lovel=0 hivel=80 volume=14
<region>
sample=Timpani1_Roll_v5_rr1_Sum.wav lokey=36 hikey=43 pitch_keycenter=42 lovel=81 hivel=127 volume=4
`
  const pack = compileSfzBundleToTloqueSamplePack([hits, rolls], {
    id: "vsco2-ce-timpani",
    name: "VSCO 2 CE · Timpani",
    instrumentManifestId: "vsco2-ce-timpani",
    license: "CC0-1.0",
    sourceName: "VSCO 2 Community Edition",
    sourceUrl: "https://github.com/sgossner/VSCO-2-CE",
    sourceCommit: COMMIT,
    sampleUrlForPath: path => `/api/audio/sample-packs/samples/${path.includes("rr2") ? "b".repeat(64) : "a".repeat(64)}.wav`,
  })
  const hitsOnly = pack.zones.filter(zone => zone.articulation === "normal")
  const rollsOnly = pack.zones.filter(zone => zone.articulation === "tremolo")
  assert.deepEqual([...new Set(hitsOnly.map(zone => zone.roundRobin))], [0, 1])
  assert.deepEqual([...new Set(hitsOnly.map(zone => zone.velocityLayer))], [0, 1])
  assert.deepEqual([...new Set(rollsOnly.map(zone => zone.velocityLayer))], [0, 1])
  assert.ok(rollsOnly.every(zone => zone.roundRobin === 0))
})

test("hit compila nombres percusivos a selectores internos sin exponer pitches", () => {
  const source = `TLOQUE_SCORE 2
title "Percussion semantics"
tempo 80
meter 4/4
loop false
seed 9
quality studio
module vsco2-ce-orchestral-percussion
track perc synth=pluck instrument=percussion.orchestral-kit program=0 role=accent gain=0.45 pan=0 attack=0.001 release=2 expression=1 brightness=0.5 vibrato=0
section hits form=custom bars=1 repeat=1 fade=0 tempo=80 rubato=0
use perc
hit 1:1 bass-drum 0.5 velocity=0.8
hit 1:2 snare-hit 0.25 velocity=0.6
hit 1:3 crash-cymbal 1 velocity=0.7
end`
  const result = compileTloqueScore(source)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.recipe.plan.events.map(event => event.notes), [[36], [38], [49]])
  assert.ok(result.recipe.source.includes("hit 1:2 snare-hit"))
})

test("hit rechaza nombres desconocidos y tracks melódicos", () => {
  const unknown = compileTloqueScore(`TLOQUE_SCORE 2
tempo 80
meter 4/4
loop false
seed 1
quality studio
module vsco2-ce-orchestral-percussion
track perc synth=pluck instrument=percussion.orchestral-kit program=0 role=accent gain=0.4 pan=0 attack=0.001 release=1 expression=1 brightness=0.5 vibrato=0
section x form=custom bars=1 repeat=1 fade=0 tempo=80 rubato=0
use perc
hit 1:1 laser-drum 0.25 velocity=0.5
end`)
  assert.equal(unknown.ok, false)
  if (!unknown.ok) assert.ok(unknown.diagnostics.some(item => item.message.includes("Golpe percusivo desconocido")))

  const melodic = compileTloqueScore(`TLOQUE_SCORE 2
tempo 80
meter 4/4
loop false
seed 1
quality studio
module builtin
track violin synth=pad instrument=strings.violin program=40 role=melody gain=0.4 pan=0 attack=0.1 release=1 expression=1 brightness=0.5 vibrato=0
section x form=custom bars=1 repeat=1 fade=0 tempo=80 rubato=0
use violin
hit 1:1 snare-hit 0.25 velocity=0.5
end`)
  assert.equal(melodic.ok, false)
  if (!melodic.ok) assert.ok(melodic.diagnostics.some(item => item.message.includes("percussion.orchestral-kit")))
})
