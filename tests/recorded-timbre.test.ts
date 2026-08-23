import test from "node:test"
import assert from "node:assert/strict"
import { compileTloqueScore } from "../shared/audio"
import type { TloqueSamplePack } from "../shared/native-sample-pack"
import { physicalRecordedTimbre, resolveRecordedTimbre } from "../shared/recorded-timbre"
import { buildNativeSampleScorePlan } from "../client/src/audio/NativeSampleScorePlan"

const sample = (letter: string) => `/api/audio/sample-packs/samples/${letter.repeat(64)}.wav`

function zone(id: string, url: string, vibratoColour: "none" | "vibrato" | "expression" = "none", mute: "none" | "straight" | "harmon" | "mute" = "none") {
  return { id, articulation: "normal" as const, sampleUrl: url, rootMidi: 60, loMidi: 48, hiMidi: 84, loVelocity: 0, hiVelocity: 127, velocityLayer: 0, roundRobin: 0, gainDb: 0, tuneCents: 0, vibrato: vibratoColour !== "none", vibratoColour, mute }
}

function score(moduleId: string, instrument: string, timbre: string) {
  const result = compileTloqueScore(`TLOQUE_SCORE 2
title "Timbre fixture"
tempo 60
meter 4/4
loop false
seed 31
humanize 0
quality studio
module ${moduleId}
track voice synth=pad instrument=${instrument} program=40 role=melody gain=0.3 pan=0 attack=0.01 release=1 expression=1 brightness=0.5 vibrato=0 timbre=${timbre}
section phrase form=custom bars=1 repeat=1 fade=0 tempo=60 rubato=0
use voice
1:1 C4 1 velocity=0.5
end`)
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.diagnostics))
  if (!result.ok) throw new Error("fixture no compiló")
  return result.recipe
}

test("natural preserva el color histórico por módulo en vez de significar siempre non-vibrato", () => {
  assert.equal(resolveRecordedTimbre("vsco2-ce-solo-violin", "natural"), "vibrato")
  assert.equal(resolveRecordedTimbre("vsco2-ce-solo-contrabass", "natural"), "vibrato")
  assert.equal(resolveRecordedTimbre("vsco2-ce-flute", "natural"), "non-vibrato")
  assert.equal(resolveRecordedTimbre("vsco2-ce-trumpet", "natural"), "non-vibrato")
  assert.deepEqual(physicalRecordedTimbre("harmon-mute"), { vibratoColour: "none", mute: "harmon" })
})

test("natural de violín selecciona sustain vibrato grabado y conserva la semántica del autor", () => {
  const pack: TloqueSamplePack = {
    version: 1, id: "vsco2-ce-solo-violin", name: "violin", instrumentManifestId: "vsco2-ce-solo-violin",
    license: "CC0-1.0", sourceName: "fixture", sourceUrl: "",
    zones: [zone("vib", sample("a"), "vibrato")],
  }
  const plan = buildNativeSampleScorePlan(score("vsco2-ce-solo-violin", "strings.violin", "natural"), pack)
  assert.equal(plan.voices[0].timbre, "natural")
  assert.equal(plan.voices[0].resolvedTimbre, "vibrato")
  assert.equal(plan.voices[0].vibratoColour, "vibrato")
  assert.equal(plan.voices[0].sampleUrl, sample("a"))
})

test("natural de flauta conserva non-vibrato mientras vibrato explícito selecciona otra grabación", () => {
  const pack: TloqueSamplePack = {
    version: 1, id: "vsco2-ce-flute", name: "flute", instrumentManifestId: "vsco2-ce-flute",
    license: "CC0-1.0", sourceName: "fixture", sourceUrl: "",
    zones: [zone("nv", sample("a")), zone("vib", sample("b"), "vibrato"), zone("exp", sample("c"), "expression")],
  }
  const natural = buildNativeSampleScorePlan(score("vsco2-ce-flute", "woodwinds.flute", "natural"), pack)
  const vibrato = buildNativeSampleScorePlan(score("vsco2-ce-flute", "woodwinds.flute", "vibrato"), pack)
  const expression = buildNativeSampleScorePlan(score("vsco2-ce-flute", "woodwinds.flute", "expression-vibrato"), pack)
  assert.equal(natural.voices[0].sampleUrl, sample("a"))
  assert.equal(vibrato.voices[0].sampleUrl, sample("b"))
  assert.equal(expression.voices[0].sampleUrl, sample("c"))
})

test("un timbre no grabado falla en vez de degradarse silenciosamente", () => {
  const pack: TloqueSamplePack = {
    version: 1, id: "vsco2-ce-f-horn", name: "horn", instrumentManifestId: "vsco2-ce-f-horn",
    license: "CC0-1.0", sourceName: "fixture", sourceUrl: "", zones: [zone("open", sample("a")), zone("mute", sample("b"), "none", "mute")],
  }
  assert.throws(
    () => buildNativeSampleScorePlan(score("vsco2-ce-f-horn", "brass.horn", "harmon-mute"), pack),
    /no contiene timbre=harmon-mute/,
  )
})
