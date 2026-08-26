import test from "node:test"
import assert from "node:assert/strict"
import { validateTloqueSamplePack, type TloqueSamplePack } from "../shared/native-sample-pack"
import { selectNativeSampleVelocityBlend } from "../client/src/audio/NativeSampleVelocityBlend"

const PACK: TloqueSamplePack = {
  version: 1,
  id: "dynamic-violin",
  name: "Dynamic violin fixture",
  instrumentManifestId: "vsco2-ce-solo-violin",
  license: "CC0-1.0",
  sourceName: "fixture",
  sourceUrl: "https://example.invalid",
  zones: [
    { id: "p", articulation: "normal", sampleUrl: "/api/audio/sample-packs/p.wav", rootMidi: 60, loMidi: 58, hiMidi: 62, loVelocity: 0, hiVelocity: 63, velocityLayer: 0, roundRobin: 0, gainDb: 0, tuneCents: 0 },
    { id: "f", articulation: "normal", sampleUrl: "/api/audio/sample-packs/f.wav", rootMidi: 60, loMidi: 58, hiMidi: 62, loVelocity: 64, hiVelocity: 127, velocityLayer: 1, roundRobin: 0, gainDb: 0, tuneCents: 0 },
  ],
}

const GENERIC_PACK = { ...PACK, instrumentManifestId: "fixture-multisample" }

test("mezcla dos capas físicas entre sus centros dinámicos", () => {
  const pack = validateTloqueSamplePack(PACK)
  const blend = selectNativeSampleVelocityBlend(pack, "normal", 60, 64, 0)
  assert.equal(blend.length, 2)
  assert.deepEqual(blend.map(item => item.zone.id), ["p", "f"])
  assert.ok(blend[0].weight > 0 && blend[0].weight < 1)
  assert.ok(blend[1].weight > 0 && blend[1].weight < 1)
  const energy = blend[0].weight ** 2 + blend[1].weight ** 2
  assert.ok(Math.abs(energy - 1) < 1e-12)
})

test("en extremos dinámicos usa una sola capa sin duplicar voces", () => {
  const pack = validateTloqueSamplePack(PACK)
  assert.deepEqual(selectNativeSampleVelocityBlend(pack, "normal", 60, 8, 0).map(item => item.zone.id), ["p"])
  assert.deepEqual(selectNativeSampleVelocityBlend(pack, "normal", 60, 120, 0).map(item => item.zone.id), ["f"])
})

test("instrumentos genéricos pueden interpolar raíces grabadas vecinas", () => {
  const pack = validateTloqueSamplePack({
    ...GENERIC_PACK,
    zones: [
      { ...PACK.zones[0], id: "root60", rootMidi: 60, loMidi: 58, hiMidi: 63, loVelocity: 0, hiVelocity: 127 },
      { ...PACK.zones[0], id: "root64", rootMidi: 64, loMidi: 61, hiMidi: 66, loVelocity: 0, hiVelocity: 127 },
    ],
  })
  const blend = selectNativeSampleVelocityBlend(pack, "normal", 62, 80, 0)
  assert.equal(blend.length, 2)
  assert.deepEqual(blend.map(item => item.zone.id), ["root60", "root64"])
  assert.ok(Math.abs(blend[0].weight - Math.SQRT1_2) < 1e-12)
  assert.ok(Math.abs(blend[1].weight - Math.SQRT1_2) < 1e-12)
  assert.ok(blend[0].playbackRate > 1)
  assert.ok(blend[1].playbackRate < 1)
})

test("VSCO Solo Violin usa una sola raíz de pitch para evitar phasing", () => {
  const pack = validateTloqueSamplePack({
    ...PACK,
    zones: [
      { ...PACK.zones[0], id: "root60", rootMidi: 60, loMidi: 58, hiMidi: 63, loVelocity: 0, hiVelocity: 127 },
      { ...PACK.zones[0], id: "root64", rootMidi: 64, loMidi: 61, hiMidi: 66, loVelocity: 0, hiVelocity: 127 },
    ],
  })
  const blend = selectNativeSampleVelocityBlend(pack, "normal", 62, 80, 0)
  assert.equal(blend.length, 1)
  assert.equal(blend[0].zone.id, "root60", "en empate conserva de forma determinista la raíz inferior")
  assert.equal(blend[0].weight, 1)
})

test("no mezcla raíces excesivamente separadas", () => {
  const pack = validateTloqueSamplePack({
    ...GENERIC_PACK,
    zones: [
      { ...PACK.zones[0], id: "root58", rootMidi: 58, loMidi: 56, hiMidi: 62, loVelocity: 0, hiVelocity: 127 },
      { ...PACK.zones[0], id: "root66", rootMidi: 66, loMidi: 62, hiMidi: 69, loVelocity: 0, hiVelocity: 127 },
    ],
  })
  const blend = selectNativeSampleVelocityBlend(pack, "normal", 62, 80, 0)
  assert.equal(blend.length, 1)
  assert.equal(blend[0].zone.id, "root58")
})

test("ampeg_dynamic=0 conserva la ganancia física de la muestra", () => {
  const pack = validateTloqueSamplePack({
    ...PACK,
    zones: [{ ...PACK.zones[0], amplitudeDynamic: false, loVelocity: 0, hiVelocity: 127 }],
  })
  const quiet = selectNativeSampleVelocityBlend(pack, "normal", 60, 10, 0)[0]
  const loud = selectNativeSampleVelocityBlend(pack, "normal", 60, 120, 0)[0]
  assert.equal(quiet.gain, loud.gain)
})

test("release y true-legato conservan selección física estricta", () => {
  const pack = validateTloqueSamplePack({
    ...PACK,
    zones: [{
      ...PACK.zones[0],
      id: "release",
      trigger: "release",
      loVelocity: 0,
      hiVelocity: 127,
    }],
  })
  const release = selectNativeSampleVelocityBlend(pack, "normal", 60, 80, 0, { trigger: "release" })
  assert.equal(release.length, 1)
  assert.equal(release[0].zone.id, "release")
  assert.equal(release[0].weight, 1)
})
