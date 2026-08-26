import test from "node:test"
import assert from "node:assert/strict"
import { compileCuratedSfzZones, sfzNoteToMidi } from "../server/sfzSamplePackCompiler"

const SFZ = `<control>
default_path=Strings\\Solo Violin\\spic\\
<group>
sw_last=d2
seq_length=2
seq_position=1
ampeg_attack=0.001
ampeg_release=0.8
ampeg_dynamic=1
<region>
sample=C4_p_rr1.wav
lokey=59
hikey=61
pitch_keycenter=60
lovel=0
hivel=62
volume=20
tune=-20
<group>
sw_last=d2
seq_length=2
seq_position=2
ampeg_attack=0.002
ampeg_release=0.6
ampeg_dynamic=1
<region>
sample=C4_p_rr2.wav
lokey=59
hikey=61
pitch_keycenter=60
lovel=0
hivel=62
volume=20
<group>
sw_last=d2
seq_length=2
seq_position=1
ampeg_attack=0.001
ampeg_release=0.8
ampeg_dynamic=1
<region>
sample=C4_f_rr1.wav
lokey=59
hikey=61
pitch_keycenter=60
lovel=63
hivel=127
volume=7
ampeg_release=0.45
`

test("convierte nombres SFZ a MIDI", () => {
  assert.equal(sfzNoteToMidi("c2"), 36)
  assert.equal(sfzNoteToMidi("c#2"), 37)
  assert.equal(sfzNoteToMidi("d2"), 38)
  assert.equal(sfzNoteToMidi("d#2"), 39)
})

test("compila zonas inertizadas con velocity layers y RR", () => {
  const zones = compileCuratedSfzZones(SFZ)
  assert.equal(zones.length, 3)
  assert.deepEqual(zones.map(zone => zone.articulation), ["spiccato", "spiccato", "spiccato"])
  assert.deepEqual(zones.map(zone => zone.roundRobin), [0, 1, 0])
  assert.deepEqual(zones.map(zone => zone.velocityLayer), [0, 0, 1])
  assert.equal(zones[0].samplePath, "Strings/Solo Violin/spic/C4_p_rr1.wav")
  assert.equal(zones[0].tuneCents, -20)
})

test("preserva attack, release y dinámica de amplitud del SFZ", () => {
  const zones = compileCuratedSfzZones(SFZ)
  assert.equal(zones[0].amplitudeAttackSeconds, 0.001)
  assert.equal(zones[0].amplitudeReleaseSeconds, 0.8)
  assert.equal(zones[0].amplitudeDynamic, true)
  assert.equal(zones[1].amplitudeAttackSeconds, 0.002)
  assert.equal(zones[1].amplitudeReleaseSeconds, 0.6)
  assert.equal(zones[2].amplitudeReleaseSeconds, 0.45, "la región debe poder sobreescribir al grupo")
  assert.equal(zones[0].gainDb, 20)
  assert.equal(zones[2].gainDb, 7)
})

test("rechaza envelopes SFZ absurdos además de preprocesador y traversal", () => {
  assert.throws(() => compileCuratedSfzZones('#include "other.sfz"'), /preprocesador/)
  assert.throws(() => compileCuratedSfzZones('<control>\ndefault_path=..\\evil\\\n<group>\nsw_last=c2\n<region>\nsample=x.wav\nlokey=60\nhikey=60\npitch_keycenter=60'), /insegura/)
  assert.throws(() => compileCuratedSfzZones('<control>\ndefault_path=Samples\n<group>\nampeg_release=99\n<region>\nsample=x.wav\nlokey=60\nhikey=60\npitch_keycenter=60'), /ampeg_release/)
})
