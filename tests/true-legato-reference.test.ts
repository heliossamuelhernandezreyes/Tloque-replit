import test from "node:test"
import assert from "node:assert/strict"
import { curatedSamplePackById } from "../shared/curated-sample-packs"
import { instrumentManifestById } from "../shared/instrument-manifest"
import { canonicalizeCuratedSfzPaths } from "../server/audioModuleInstaller"
import { compileCuratedSfzZones } from "../server/sfzSamplePackCompiler"

const UPSTREAM_FRAGMENT = `<region>
sample=../Samples/vowel_transition/a/vowel_a_e3_fromd3.wav
sw_previous=50 key=52

<region>
sample=../Samples/vowel_transition/a/vowel_a_f3_fromd3.wav
sw_previous=50 key=53
`

test("el catálogo fija el tutorial CC0 de true legato a un commit exacto", () => {
  const pack = curatedSamplePackById("sfzinstruments-legato-vocal-a")
  assert.ok(pack)
  assert.equal(pack.license, "CC0-1.0")
  assert.equal(pack.pinnedCommit, "fac6461ee4c7f498b23246eced644616fa58d2ec")
  assert.deepEqual(pack.sfzPaths, [
    "Programs/modules/vowel_sustain_a.sfz",
    "Programs/modules/vowel_transition_a.sfz",
  ])
  assert.equal(pack.sfzSampleBasePath, "Programs")
  assert.ok(pack.tags.includes("true-legato"))
})

test("el manifest de referencia activa true-legato sin atribuírselo a VSCO", () => {
  const manifest = instrumentManifestById("sfzinstruments-legato-vocal-a")
  assert.ok(manifest)
  assert.ok(manifest.capabilities.includes("true-legato"))
  assert.equal(manifest.articulations.find(item => item.articulation === "legato")?.trueLegato, true)
})

test("rutas parent del repositorio curado se vuelven repository-relative antes del parser", () => {
  const canonical = canonicalizeCuratedSfzPaths(UPSTREAM_FRAGMENT, "Programs")
  assert.match(canonical, /sample=Samples\/vowel_transition\/a\/vowel_a_e3_fromd3\.wav/)
  assert.doesNotMatch(canonical, /\.\.\//)
})

test("sw_previous + key se convierte en transición true-legato física", () => {
  const canonical = canonicalizeCuratedSfzPaths(UPSTREAM_FRAGMENT, "Programs")
  const zones = compileCuratedSfzZones(canonical)
  assert.equal(zones.length, 2)
  assert.ok(zones.every(zone => zone.trigger === "legato-transition" && zone.articulation === "legato"))
  assert.deepEqual(zones.map(zone => [zone.transitionFromMidi, zone.transitionToMidi]), [[50, 52], [50, 53]])
  assert.deepEqual(zones.map(zone => zone.rootMidi), [52, 53])
})

test("la normalización curada nunca permite escapar de la raíz del repositorio", () => {
  assert.throws(() => canonicalizeCuratedSfzPaths("<region> sample=../../../secret.wav key=60", "Programs"), /fuera del repositorio/)
})
