import test from "node:test"
import assert from "node:assert/strict"
import { validateTloqueSamplePack, type TloqueSamplePack } from "../shared/native-sample-pack"
import { selectNativeSampleZone } from "../client/src/audio/NativeSamplePackEngine"

const PACK: TloqueSamplePack = {
  version: 1,
  id: "test-violin",
  name: "Test violin",
  instrumentManifestId: "vsco2-ce-solo-violin",
  license: "CC0-1.0",
  sourceName: "fixture",
  sourceUrl: "https://example.invalid",
  zones: [
    { id: "spic-p-rr0", articulation: "spiccato", sampleUrl: "/api/audio/sample-packs/a.wav", rootMidi: 60, loMidi: 59, hiMidi: 61, loVelocity: 0, hiVelocity: 62, velocityLayer: 0, roundRobin: 0, gainDb: 0, tuneCents: 0 },
    { id: "spic-p-rr1", articulation: "spiccato", sampleUrl: "/api/audio/sample-packs/b.wav", rootMidi: 60, loMidi: 59, hiMidi: 61, loVelocity: 0, hiVelocity: 62, velocityLayer: 0, roundRobin: 1, gainDb: -6, tuneCents: -20 },
    { id: "sus-f", articulation: "normal", sampleUrl: "/api/audio/sample-packs/c.wav", rootMidi: 60, loMidi: 59, hiMidi: 61, loVelocity: 63, hiVelocity: 127, velocityLayer: 1, roundRobin: 0, gainDb: 0, tuneCents: 0 },
  ],
}

test("el paquete nativo rechaza URLs remotas arbitrarias", () => {
  assert.throws(() => validateTloqueSamplePack({
    ...PACK,
    zones: [{ ...PACK.zones[0], sampleUrl: "https://evil.invalid/sample.wav" }],
  }), /almacenamiento interno/)
})

test("selecciona velocity y round robin exactos", () => {
  const pack = validateTloqueSamplePack(PACK)
  const rr0 = selectNativeSampleZone(pack, "spiccato", 60, 40, 0)
  const rr1 = selectNativeSampleZone(pack, "spiccato", 60, 40, 1)
  assert.equal(rr0?.zone.id, "spic-p-rr0")
  assert.equal(rr1?.zone.id, "spic-p-rr1")
  assert.ok((rr1?.gain ?? 1) < (rr0?.gain ?? 0))
})

test("una articulación ausente cae a sustain sin fingir otra muestra", () => {
  const pack = validateTloqueSamplePack(PACK)
  const selection = selectNativeSampleZone(pack, "legato", 60, 100, 0)
  assert.equal(selection?.zone.id, "sus-f")
})

test("la transposición usa root key y tune cents", () => {
  const pack = validateTloqueSamplePack(PACK)
  const selection = selectNativeSampleZone(pack, "spiccato", 61, 40, 1)
  const expected = 2 ** ((1 - 0.2) / 12)
  assert.ok(Math.abs((selection?.playbackRate ?? 0) - expected) < 1e-12)
})
