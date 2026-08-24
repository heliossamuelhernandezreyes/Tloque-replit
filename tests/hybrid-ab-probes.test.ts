import { describe, expect, it } from "vitest"
import { compileTloqueScore } from "../shared/audio"
import { NATIVE_HYBRID_SOURCES } from "../shared/native-hybrid-source"

function midiNote(midi: number) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}

function scoreFor(source: (typeof NATIVE_HYBRID_SOURCES)[number]) {
  const center = Math.round((source.midiMin + source.midiMax) / 2), upper = Math.min(source.midiMax, center + 2)
  const controls = source.physicalLayer === "sympathetic-resonance"
    ? "control 3:1 pedal=down expression=0.70 brightness=0.58 ramp=0.15\ncontrol 4:3 pedal=up expression=0.48 brightness=0.46 ramp=0.18"
    : "control 3:1 expression=0.78 brightness=0.68 vibrato=0.10 ramp=0.35\ncontrol 4:2 expression=0.42 brightness=0.38 vibrato=0.04 ramp=0.35"
  return `TLOQUE_SCORE 2
title "AB ${source.instrumentId}"
tempo 120
meter 4/4
loop false
seed 20260824
humanize 0
quality studio
module native-auto
track probe synth=pad instrument=${source.instrumentId} program=0 role=melody gain=0.32 pan=0 attack=0.025 release=1 expression=0.55 brightness=0.52 vibrato=0.06
section probe form=development bars=4 repeat=1 fade=0 tempo=120 rubato=0
use probe
1:1 ${midiNote(center)} 2 velocity=0.32 articulation=normal
2:1 ${midiNote(center)} 2 velocity=0.84 articulation=normal
${controls}
3:1 ${midiNote(center)} 3 velocity=0.62 articulation=normal
4:1 ${midiNote(upper)} 2 velocity=0.58 articulation=legato
end`
}

describe("hybrid A/B probes", () => {
  for (const source of NATIVE_HYBRID_SOURCES) {
    it(`compiles ${source.instrumentId}`, () => {
      const result = compileTloqueScore(scoreFor(source))
      expect(result.ok, result.ok ? undefined : JSON.stringify(result.diagnostics)).toBe(true)
      if (result.ok) expect(result.recipe.plan.events).toHaveLength(4)
    })
  }
})
