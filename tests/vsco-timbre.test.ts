import test from "node:test"
import assert from "node:assert/strict"
import { compileTloqueScore } from "../shared/audio"
import { CURATED_SAMPLE_PACKS } from "../shared/curated-sample-packs"
import type { TloqueSamplePack } from "../shared/native-sample-pack"
import { compileCuratedSfzZones } from "../server/sfzSamplePackCompiler"
import { selectNativeSampleZone } from "../client/src/audio/NativeSamplePackEngine"
import { buildNativeSampleScorePlan } from "../client/src/audio/NativeSampleScorePlan"

const url = (letter: string) => `/api/audio/sample-packs/samples/${letter.repeat(64)}.wav`

function zone(id: string, sampleUrl: string, options: { articulation?: "normal" | "staccato"; vibrato?: boolean; vibratoColour?: "none" | "vibrato" | "expression"; mute?: "none" | "straight" | "harmon" | "mute" } = {}) {
  const vibratoColour = options.vibratoColour ?? (options.vibrato ? "vibrato" : "none")
  return {
    id,
    articulation: options.articulation ?? "normal",
    vibrato: vibratoColour !== "none",
    vibratoColour,
    mute: options.mute ?? "none",
    sampleUrl,
    rootMidi: 60,
    loMidi: 48,
    hiMidi: 84,
    loVelocity: 0,
    hiVelocity: 127,
    velocityLayer: 0,
    roundRobin: 0,
    gainDb: 0,
    tuneCents: 0,
  } as const
}

test("SFZ mantiene vibrato y sordinas como dimensiones independientes de articulación", () => {
  const sources = [
    String.raw`<control> default_path=Brass\Trumpet\susvib\ <group> <region> sample=vib.wav lokey=48 hikey=72 pitch_keycenter=60 lovel=0 hivel=127`,
    String.raw`<control> default_path=Brass\Trumpet\straightM-sus\ <group> <region> sample=straight.wav lokey=48 hikey=72 pitch_keycenter=60 lovel=0 hivel=127`,
    String.raw`<control> default_path=Brass\Trumpet\harmonM-sus\ <group> <region> sample=harmon.wav lokey=48 hikey=72 pitch_keycenter=60 lovel=0 hivel=127`,
    String.raw`<control> default_path=Brass\F Horn\mute\ <group> <region> sample=horn.wav lokey=48 hikey=72 pitch_keycenter=60 lovel=0 hivel=127`,
  ]
  const [vib, straight, harmon, horn] = sources.map(source => compileCuratedSfzZones(source)[0])
  assert.equal(vib.articulation, "normal")
  assert.equal(vib.vibratoColour, "vibrato")
  assert.equal(vib.mute, "none")
  assert.equal(straight.articulation, "normal")
  assert.equal(straight.mute, "straight")
  assert.equal(harmon.articulation, "normal")
  assert.equal(harmon.mute, "harmon")
  assert.notEqual(harmon.articulation, "harmonic")
  assert.equal(horn.mute, "mute")
})

test("selector prioriza el color físico solicitado antes que una articulación abierta", () => {
  const pack: TloqueSamplePack = {
    version: 1,
    id: "fixture",
    name: "Fixture trumpet",
    instrumentManifestId: "vsco2-ce-trumpet",
    license: "CC0-1.0",
    sourceName: "fixture",
    sourceUrl: "",
    zones: [
      zone("open", url("a")),
      zone("vib", url("b"), { vibratoColour: "vibrato" }),
      zone("straight", url("c"), { mute: "straight" }),
      zone("open-staccato", url("d"), { articulation: "staccato" }),
    ],
  }
  assert.equal(selectNativeSampleZone(pack, "normal", 60, 64, 0, { vibratoColour: "vibrato" })?.zone.id, "vib")
  assert.equal(selectNativeSampleZone(pack, "normal", 60, 64, 0, { mute: "straight" })?.zone.id, "straight")
  assert.equal(selectNativeSampleZone(pack, "staccato", 60, 64, 0, { mute: "straight" })?.zone.id, "straight")
  assert.equal(selectNativeSampleZone(pack, "staccato", 60, 64, 0)?.zone.id, "open-staccato")
})

test("catálogo instala sólo variantes tímbricas verificadas dentro del instrumento correspondiente", () => {
  const oboe = CURATED_SAMPLE_PACKS.find(pack => pack.id === "vsco2-ce-oboe")
  const bassoon = CURATED_SAMPLE_PACKS.find(pack => pack.id === "vsco2-ce-bassoon")
  const trumpet = CURATED_SAMPLE_PACKS.find(pack => pack.id === "vsco2-ce-trumpet")
  const trombone = CURATED_SAMPLE_PACKS.find(pack => pack.id === "vsco2-ce-tenor-trombone")
  const horn = CURATED_SAMPLE_PACKS.find(pack => pack.id === "vsco2-ce-f-horn")
  assert.deepEqual(oboe?.sfzPaths, ["OboeSusNV.sfz", "OboeSusVib.sfz", "OboeStac.sfz"])
  assert.deepEqual(bassoon?.sfzPaths, ["BassoonSus.sfz", "BassoonVib.sfz", "BassoonStac.sfz"])
  assert.deepEqual(trumpet?.sfzPaths, ["TrumpetSus.sfz", "TrumpetSusVib.sfz", "TrumpetStac.sfz", "TrumpetStraightMuteSus.sfz", "TrumpetHarmonMuteSus.sfz"])
  assert.deepEqual(trombone?.sfzPaths, ["TromboneSus.sfz", "TromboneVib.sfz", "TromboneStac.sfz"])
  assert.deepEqual(horn?.sfzPaths, ["FHornSus.sfz", "FHornStac.sfz", "FHornMute.sfz"])
})

test("TloqueScore selecciona vibrato y expression-vibrato como colores físicos explícitos", () => {
  const source = `TLOQUE_SCORE 2
title "Recorded vibrato"
tempo 60
meter 4/4
loop false
seed 12
humanize 0
quality studio
module vsco2-ce-trumpet
track trumpet synth=pad instrument=brass.trumpet program=56 role=melody gain=0.3 pan=0 attack=0.01 release=1 expression=1 brightness=0.5 vibrato=0 timbre=natural
section phrase form=custom bars=1 repeat=1 fade=0 tempo=60 rubato=0
use trumpet
1:1 C4 1 velocity=0.5 timbre=natural
1:2 C4 1 velocity=0.5 timbre=vibrato
end`
  const compiled = compileTloqueScore(source)
  assert.equal(compiled.ok, true)
  if (!compiled.ok) return
  const pack: TloqueSamplePack = {
    version: 1,
    id: "vsco2-ce-trumpet",
    name: "Fixture trumpet",
    instrumentManifestId: "vsco2-ce-trumpet",
    license: "CC0-1.0",
    sourceName: "fixture",
    sourceUrl: "",
    zones: [zone("open", url("a")), zone("vib", url("b"), { vibratoColour: "vibrato" })],
  }
  const plan = buildNativeSampleScorePlan(compiled.recipe, pack)
  assert.deepEqual(plan.voices.map(voice => voice.timbre), ["natural", "vibrato"])
  assert.deepEqual(plan.voices.map(voice => voice.vibratoColour), ["none", "vibrato"])
  assert.deepEqual(plan.voices.map(voice => voice.sampleUrl), [url("a"), url("b")])
})

test("timbre=straight-mute solicita la grabación real sin cambiar articulación", () => {
  const source = `TLOQUE_SCORE 2
title "Straight mute"
tempo 60
meter 4/4
loop false
seed 13
humanize 0
quality studio
module vsco2-ce-trumpet
track trumpet synth=pad instrument=brass.trumpet program=56 role=melody gain=0.3 pan=0 attack=0.01 release=1 expression=1 brightness=0.5 vibrato=0 timbre=straight-mute
section phrase form=custom bars=1 repeat=1 fade=0 tempo=60 rubato=0
use trumpet
1:1 C4 1 velocity=0.5 articulation=normal
end`
  const compiled = compileTloqueScore(source)
  assert.equal(compiled.ok, true)
  if (!compiled.ok) return
  const pack: TloqueSamplePack = {
    version: 1,
    id: "vsco2-ce-trumpet",
    name: "Fixture trumpet",
    instrumentManifestId: "vsco2-ce-trumpet",
    license: "CC0-1.0",
    sourceName: "fixture",
    sourceUrl: "",
    zones: [zone("open", url("a")), zone("straight", url("c"), { mute: "straight" })],
  }
  const plan = buildNativeSampleScorePlan(compiled.recipe, pack)
  assert.equal(plan.voices[0].timbre, "straight-mute")
  assert.equal(plan.voices[0].mute, "straight")
  assert.equal(plan.voices[0].articulation, "normal")
  assert.equal(plan.voices[0].sampleUrl, url("c"))
})
