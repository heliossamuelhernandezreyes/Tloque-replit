import test from "node:test"
import assert from "node:assert/strict"
import { compileTloqueScore } from "../shared/audio"
import type { TloqueSamplePack } from "../shared/native-sample-pack"
import { buildNativeSampleScorePlan } from "../client/src/audio/NativeSampleScorePlan"

const sample = (letter: string) => `/api/audio/sample-packs/samples/${letter.repeat(64)}.wav`

function zone(params: {
  id: string
  url: string
  articulation?: "normal" | "staccato" | "spiccato"
  loMidi?: number
  hiMidi?: number
  vibratoColour?: "none" | "vibrato" | "expression"
}) {
  return {
    id: params.id,
    articulation: params.articulation ?? "normal",
    sampleUrl: params.url,
    rootMidi: 72,
    loMidi: params.loMidi ?? 60,
    hiMidi: params.hiMidi ?? 96,
    loVelocity: 0,
    hiVelocity: 127,
    velocityLayer: 0,
    roundRobin: 0,
    gainDb: 0,
    tuneCents: 0,
    vibrato: (params.vibratoColour ?? "none") !== "none",
    vibratoColour: params.vibratoColour ?? "none",
    mute: "none" as const,
  }
}

function score(moduleId: string, instrument: string, note: string, articulation = "normal", timbre = "natural") {
  const result = compileTloqueScore(`TLOQUE_SCORE 2\ntitle "Natural fallback"\ntempo 60\nmeter 4/4\nloop false\nseed 44\nhumanize 0\nquality master\nmodule ${moduleId}\ntrack voice synth=pad instrument=${instrument} program=56 role=melody gain=0.3 pan=0 attack=0.01 release=1 expression=1 brightness=0.5 vibrato=0 timbre=${timbre}\nsection phrase form=custom bars=1 repeat=1 fade=0 tempo=60 rubato=0\nuse voice\n1:1 ${note} 1 velocity=0.6 articulation=${articulation}\nend`)
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.diagnostics))
  if (!result.ok) throw new Error("fixture no compiló")
  return result.recipe
}

test("natural usa otra grabación abierta cuando el timbre por defecto no cubre la nota", () => {
  const pack: TloqueSamplePack = {
    version: 1,
    id: "vsco2-ce-trumpet",
    name: "Trumpet fixture",
    instrumentManifestId: "vsco2-ce-trumpet",
    license: "CC0-1.0",
    sourceName: "fixture",
    sourceUrl: "",
    zones: [
      zone({ id: "nv-low", url: sample("a"), hiMidi: 84, vibratoColour: "none" }),
      zone({ id: "vib-high", url: sample("b"), loMidi: 85, vibratoColour: "vibrato" }),
    ],
  }

  const plan = buildNativeSampleScorePlan(score("vsco2-ce-trumpet", "brass.trumpet", "D6"), pack)
  assert.equal(plan.voices[0].timbre, "natural")
  assert.equal(plan.voices[0].resolvedTimbre, "vibrato")
  assert.equal(plan.voices[0].sampleUrl, sample("b"))
})

test("natural no convierte una articulación corta en non-vibrato inexistente", () => {
  const pack: TloqueSamplePack = {
    version: 1,
    id: "vsco2-ce-solo-violin",
    name: "Violin fixture",
    instrumentManifestId: "vsco2-ce-solo-violin",
    license: "CC0-1.0",
    sourceName: "fixture",
    sourceUrl: "",
    zones: [zone({ id: "spic-vib", url: sample("c"), articulation: "spiccato", vibratoColour: "vibrato" })],
  }

  const plan = buildNativeSampleScorePlan(score("vsco2-ce-solo-violin", "strings.violin", "A4", "spiccato"), pack)
  assert.equal(plan.voices[0].resolvedTimbre, "vibrato")
  assert.equal(plan.voices[0].sampleUrl, sample("c"))
})

test("un timbre explícito sigue siendo estricto y nunca cambia silenciosamente", () => {
  const pack: TloqueSamplePack = {
    version: 1,
    id: "vsco2-ce-trumpet",
    name: "Trumpet fixture",
    instrumentManifestId: "vsco2-ce-trumpet",
    license: "CC0-1.0",
    sourceName: "fixture",
    sourceUrl: "",
    zones: [zone({ id: "vib-high", url: sample("d"), loMidi: 85, vibratoColour: "vibrato" })],
  }

  assert.throws(
    () => buildNativeSampleScorePlan(score("vsco2-ce-trumpet", "brass.trumpet", "D6", "normal", "non-vibrato"), pack),
    /no contiene timbre=non-vibrato/,
  )
})
