import test from "node:test"
import assert from "node:assert/strict"
import { compileTloqueScore } from "../shared/audio"
import type { InstrumentManifest } from "../shared/instrument-manifest"
import { validateTloqueSamplePack, type TloqueSampleZone } from "../shared/native-sample-pack"
import { compileCuratedSfzZones } from "../server/sfzSamplePackCompiler"
import { buildNativeSampleScorePlan } from "../client/src/audio/NativeSampleScorePlan"
import { selectNativeSampleZone } from "../client/src/audio/NativeSamplePackEngine"

const PREMIUM_MANIFEST: InstrumentManifest = {
  version: 1,
  id: "premium-fixture",
  family: "strings",
  name: "Premium fixture",
  instruments: ["strings.violin"],
  basePrograms: [40],
  capabilities: ["dedicated-articulation", "true-legato", "release-samples", "mic-positions"],
  articulations: [
    { articulation: "normal", releaseSamples: true },
    { articulation: "legato", trueLegato: true, releaseSamples: true },
  ],
}

function z(id: string, sample: string, options: Partial<TloqueSampleZone> = {}): TloqueSampleZone {
  return {
    id,
    articulation: "legato",
    sampleUrl: `/api/audio/sample-packs/samples/${sample}.wav`,
    rootMidi: 60,
    loMidi: 48,
    hiMidi: 84,
    loVelocity: 0,
    hiVelocity: 127,
    velocityLayer: 0,
    roundRobin: 0,
    gainDb: 0,
    tuneCents: 0,
    vibrato: false,
    vibratoColour: "none",
    mute: "none",
    trigger: "attack",
    micPosition: "close",
    ...options,
  }
}

const PACK = validateTloqueSamplePack({
  version: 1,
  id: "premium-fixture",
  name: "Premium fixture",
  instrumentManifestId: "premium-fixture",
  license: "fixture",
  sourceName: "fixture",
  sourceUrl: "",
  micPositions: ["close", "main"],
  defaultMicPosition: "main",
  zones: [
    z("close-attack-c", "a", { rootMidi: 60, micPosition: "close" }),
    z("close-attack-d", "b", { rootMidi: 62, micPosition: "close" }),
    z("close-release-c", "c", { rootMidi: 60, trigger: "release", micPosition: "close" }),
    z("close-release-d", "d", { rootMidi: 62, trigger: "release", micPosition: "close" }),
    z("close-leg-c-d", "e", { rootMidi: 62, trigger: "legato-transition", micPosition: "close", transitionFromMidi: 60, transitionToMidi: 62 }),
    z("main-attack-c", "f", { rootMidi: 60, micPosition: "main" }),
    z("main-attack-d", "g", { rootMidi: 62, micPosition: "main" }),
    z("main-release-c", "h", { rootMidi: 60, trigger: "release", micPosition: "main" }),
    z("main-release-d", "i", { rootMidi: 62, trigger: "release", micPosition: "main" }),
    z("main-leg-c-d", "j", { rootMidi: 62, trigger: "legato-transition", micPosition: "main", transitionFromMidi: 60, transitionToMidi: 62 }),
  ],
})

const SCORE = `TLOQUE_SCORE 2
title "Legato fixture"
tempo 60
meter 4/4
loop false
seed 7
humanize 0
quality studio
module premium-fixture
track violin synth=pad instrument=strings.violin program=40 role=melody gain=0.3 pan=0 attack=0.01 release=1 expression=1 brightness=0.5 vibrato=0 timbre=non-vibrato
section phrase form=custom bars=1 repeat=1 fade=0 tempo=60 rubato=0
use violin
1:1 C4 1 velocity=0.5 articulation=legato
1:2 D4 1 velocity=0.5 articulation=legato
end`

function recipe() {
  const compiled = compileTloqueScore(SCORE)
  assert.equal(compiled.ok, true)
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  return compiled.recipe
}

test("un banco premium activa true legato, releases y mic físico en el mismo plan", () => {
  const plan = buildNativeSampleScorePlan(recipe(), PACK, {
    manifests: [PREMIUM_MANIFEST],
    micPositionByTrack: { violin: "close" },
  })
  assert.deepEqual(plan.tracks.map(track => track.micPosition), ["close"])
  assert.equal(plan.voices.length, 2)
  assert.ok(plan.voices.every(voice => voice.micPosition === "close" && voice.sampleUrl.includes("/samples/")))
  const transitions = plan.auxiliaryVoices.filter(voice => voice.kind === "legato-transition")
  const releases = plan.auxiliaryVoices.filter(voice => voice.kind === "release")
  assert.equal(transitions.length, 1)
  assert.equal(transitions[0].transitionFromMidi, 60)
  assert.equal(transitions[0].note, 62)
  assert.equal(transitions[0].zoneId, "close-leg-c-d")
  assert.equal(releases.length, 2)
  assert.deepEqual(releases.map(voice => voice.zoneId), ["close-release-c", "close-release-d"])
})

test("mic position nunca cae silenciosamente a otra perspectiva", () => {
  assert.throws(() => buildNativeSampleScorePlan(recipe(), PACK, {
    manifests: [PREMIUM_MANIFEST],
    micPositionByTrack: { violin: "room" },
  }), /no contiene mic=room/)
})

test("selector exige el par de transición cuando la librería lo declara", () => {
  const exact = selectNativeSampleZone(PACK, "legato", 62, 64, 0, {
    trigger: "legato-transition",
    micPosition: "close",
    transitionFromMidi: 60,
    transitionToMidi: 62,
  })
  assert.equal(exact?.zone.id, "close-leg-c-d")
})

test("SFZ curado conserva trigger release, true-legato y perspectiva física", () => {
  const source = String.raw`
<control>
default_path=Strings\Violin\Close\
<group>
trigger=release
<region>
sample=release_C4.wav lokey=60 hikey=60 pitch_keycenter=60 lovel=0 hivel=127
<group>
trigger=legato
tloque_mic=close
<region>
sample=leg_C4_D4.wav lokey=62 hikey=62 pitch_keycenter=62 lovel=0 hivel=127 tloque_transition_from=60 tloque_transition_to=62
`
  const zones = compileCuratedSfzZones(source)
  assert.equal(zones[0].trigger, "release")
  assert.equal(zones[0].micPosition, "close")
  assert.equal(zones[1].trigger, "legato-transition")
  assert.equal(zones[1].articulation, "legato")
  assert.equal(zones[1].transitionFromMidi, 60)
  assert.equal(zones[1].transitionToMidi, 62)
})

test("VSCO Community Edition no recibe capacidades premium inventadas", async () => {
  const manifests = await import("../shared/instrument-manifest")
  for (const manifest of manifests.INSTRUMENT_MANIFEST_REGISTRY.filter(item => item.id.startsWith("vsco2-ce-"))) {
    assert.equal(manifest.capabilities.includes("true-legato"), false)
    assert.equal(manifest.capabilities.includes("release-samples"), false)
    assert.equal(manifest.capabilities.includes("mic-positions"), false)
  }
})
