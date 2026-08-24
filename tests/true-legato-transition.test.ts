import test from "node:test"
import assert from "node:assert/strict"
import { selectNativeSampleZone } from "../client/src/audio/NativeSamplePackEngine"
import { validateTloqueSamplePack, type TloqueSamplePack } from "../shared/native-sample-pack"

function zone(id: string, from: number | undefined, to: number | undefined) {
  return {
    id,
    articulation: "legato" as const,
    sampleUrl: `/api/audio/sample-packs/test/${id}.wav`,
    rootMidi: to ?? 60,
    loMidi: to ?? 60,
    hiMidi: to ?? 60,
    loVelocity: 0,
    hiVelocity: 127,
    velocityLayer: 0,
    roundRobin: 0,
    gainDb: 0,
    tuneCents: 0,
    trigger: "legato-transition" as const,
    transitionFromMidi: from,
    transitionToMidi: to,
  }
}

const PACK: TloqueSamplePack = {
  version: 1,
  id: "true-legato-test",
  name: "True legato test",
  instrumentManifestId: "sfzinstruments-legato-vocal-a",
  license: "CC0-1.0",
  sourceName: "test",
  sourceUrl: "https://example.invalid",
  zones: [zone("c4-d4", 60, 62), zone("e4-d4", 64, 62)],
}

test("true legato selecciona exactamente el par físico anterior->destino", () => {
  const selected = selectNativeSampleZone(PACK, "legato", 62, 96, 0, {
    trigger: "legato-transition",
    transitionFromMidi: 64,
    transitionToMidi: 62,
  })
  assert.equal(selected?.zone.id, "e4-d4")
})

test("true legato nunca degrada una transición ausente a un WAV genérico o de otro intervalo", () => {
  const selected = selectNativeSampleZone(PACK, "legato", 62, 96, 0, {
    trigger: "legato-transition",
    transitionFromMidi: 61,
    transitionToMidi: 62,
  })
  assert.equal(selected, null)
})

test("el contrato rechaza zonas de true legato sin ambos extremos MIDI", () => {
  const invalid = { ...PACK, zones: [zone("generic", undefined, 62)] }
  assert.throws(() => validateTloqueSamplePack(invalid), /transitionFromMidi y transitionToMidi exactos/)
})
