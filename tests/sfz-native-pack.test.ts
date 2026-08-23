import test from "node:test"
import assert from "node:assert/strict"
import { compileCuratedSfzZones, compileSfzToTloqueSamplePack, samplePathsFromSfz } from "../server/sfzSamplePackCompiler"
import { selectNativeSampleZone } from "../client/src/audio/NativeSamplePackEngine"

const SFZ = `<control>
default_path=Strings\\Solo Violin\\spic\\
<group>
sw_last=d2
seq_length=2
seq_position=1
<region>
sample=Violin C4 rr1.wav lokey=59 hikey=61 pitch_keycenter=60 lovel=0 hivel=62 volume=6 tune=-20
<group>
sw_last=d2
seq_length=2
seq_position=2
<region>
sample=Violin C4 rr2.wav lokey=59 hikey=61 pitch_keycenter=60 lovel=0 hivel=62 volume=6
<group>
sw_last=d2
seq_length=2
seq_position=1
<region>
sample=Violin C4 f rr1.wav lokey=59 hikey=61 pitch_keycenter=60 lovel=63 hivel=127 volume=0
<group>
sw_last=d2
seq_length=2
seq_position=2
<region>
sample=Violin C4 f rr2.wav lokey=59 hikey=61 pitch_keycenter=60 lovel=63 hivel=127 volume=0
`

test("el parser conserva default_path y sample con espacios", () => {
  const zones = compileCuratedSfzZones(SFZ)
  assert.equal(zones.length, 4)
  assert.equal(zones[0].samplePath, "Strings/Solo Violin/spic/Violin C4 rr1.wav")
  assert.equal(zones[0].articulation, "spiccato")
  assert.equal(zones[0].roundRobin, 0)
  assert.equal(zones[1].roundRobin, 1)
  assert.equal(zones[2].velocityLayer, 1)
  assert.equal(zones[0].tuneCents, -20)
})

test("la enumeración de muestras es única y usa rutas normalizadas", () => {
  const paths = samplePathsFromSfz(SFZ)
  assert.equal(paths.length, 4)
  assert.ok(paths.every(path => path.startsWith("Strings/Solo Violin/spic/")))
})

test("el pack nativo selecciona velocity y round robin físicos", () => {
  const pack = compileSfzToTloqueSamplePack(SFZ, {
    id: "vsco2-ce-solo-violin",
    name: "VSCO violin",
    instrumentManifestId: "vsco2-ce-solo-violin",
    license: "CC0-1.0",
    sourceName: "VSCO 2 CE",
    sourceUrl: "https://github.com/sgossner/VSCO-2-CE",
    sourceCommit: "6dd651d55dde97fd4028699be9d4481f26917891",
    sampleUrlForPath: path => `/api/audio/sample-packs/samples/${Buffer.from(path).toString("hex").padEnd(64, "0").slice(0, 64)}.wav`,
  })
  const softRr2 = selectNativeSampleZone(pack, "spiccato", 60, 50, 1)
  const loudRr1 = selectNativeSampleZone(pack, "spiccato", 60, 100, 0)
  assert.ok(softRr2)
  assert.ok(loudRr1)
  assert.match(softRr2.zone.id, /rr2/)
  assert.match(loudRr1.zone.id, /f rr1/)
  assert.equal(softRr2.zone.velocityLayer, 0)
  assert.equal(loudRr1.zone.velocityLayer, 1)
})

test("rechaza preprocesador y traversal", () => {
  assert.throws(() => compileCuratedSfzZones(`#include "evil.sfz"\n${SFZ}`), /preprocesador/)
  assert.throws(() => compileCuratedSfzZones(`<control>\ndefault_path=..\\secret\\\n${SFZ}`), /fuera del paquete|insegura/)
})
