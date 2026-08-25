import { describe, expect, it } from "vitest"
import { compileTloqueScore } from "../shared/audio"
import { NATIVE_HYBRID_SOURCES } from "../shared/native-hybrid-source"

function midiNote(midi: number) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}

function controlsFor(source: (typeof NATIVE_HYBRID_SOURCES)[number]) {
  if (source.physicalLayer === "bowed-string-resonator") return "control 3:1 pressure=0.78 bow=0.25 coupling=0.55 ramp=0.35\ncontrol 4:2 pressure=0.42 bow=0.72 coupling=0.30 ramp=0.35"
  if (source.physicalLayer === "air-column-resonator") return "control 3:1 pressure=0.78 embouchure=0.68 ramp=0.35\ncontrol 4:2 pressure=0.42 embouchure=0.34 ramp=0.35"
  if (source.instrumentId === "piano.grand" || source.instrumentId === "keys.celesta") return "control 3:1 pedal=down damper=0.08 coupling=0.82 ramp=0.15\ncontrol 4:3 pedal=up damper=0.78 coupling=0.32 ramp=0.18"
  return "control 3:1 pluck=0.28 damper=0.12 coupling=0.72 ramp=0.15\ncontrol 4:3 pluck=0.68 damper=0.58 coupling=0.35 ramp=0.18"
}

function scoreFor(source: (typeof NATIVE_HYBRID_SOURCES)[number]) {
  const center = Math.round((source.midiMin + source.midiMax) / 2), upper = Math.min(source.midiMax, center + 2)
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
${controlsFor(source)}
3:1 ${midiNote(center)} 3 velocity=0.62 articulation=normal
4:1 ${midiNote(upper)} 2 velocity=0.58 articulation=legato
end`
}

describe("hybrid A/B probes", () => {
  for (const source of NATIVE_HYBRID_SOURCES) {
    it(`compiles v2.2 physical probe for ${source.instrumentId}`, () => {
      const result = compileTloqueScore(scoreFor(source))
      expect(result.ok, result.ok ? undefined : JSON.stringify(result.diagnostics)).toBe(true)
      if (!result.ok || result.recipe.version !== 2) return
      expect(result.recipe.plan.events).toHaveLength(4)
      expect(result.recipe.plan.compilerVersion).toBe("tloque-score-compiler-v2.2")
      const controls = result.recipe.plan.controls
      expect(controls.length).toBe(2)
      if (source.physicalLayer === "bowed-string-resonator") expect(controls[0]).toMatchObject({ pressure: 0.78, bowPosition: 0.25, sympatheticCoupling: 0.55 })
      else if (source.physicalLayer === "air-column-resonator") expect(controls[0]).toMatchObject({ pressure: 0.78, embouchure: 0.68 })
      else if (source.instrumentId === "piano.grand" || source.instrumentId === "keys.celesta") expect(controls[0]).toMatchObject({ pedal: true, damper: 0.08, sympatheticCoupling: 0.82 })
      else expect(controls[0]).toMatchObject({ pluckPosition: 0.28, damper: 0.12, sympatheticCoupling: 0.72 })
    })
  }
})
