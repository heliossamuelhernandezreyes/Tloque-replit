import test from "node:test"
import assert from "node:assert/strict"
import { compileCuratedSfzZones, sfzNoteToMidi } from "../server/sfzSamplePackCompiler"

const SFZ = `<control>
default_path=Strings\\Solo Violin\\spic\\
<group>
sw_last=d2
seq_length=2
seq_position=1
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
<region>
sample=C4_f_rr1.wav
lokey=59
hikey=61
pitch_keycenter=60
lovel=63
hivel=127
volume=7
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

test("rechaza preprocesador y traversal", () => {
  assert.throws(() => compileCuratedSfzZones('#include "other.sfz"'), /preprocesador/)
  assert.throws(() => compileCuratedSfzZones('<control>\ndefault_path=..\\evil\\\n<group>\nsw_last=c2\n<region>\nsample=x.wav\nlokey=60\nhikey=60\npitch_keycenter=60'), /insegura/)
})
