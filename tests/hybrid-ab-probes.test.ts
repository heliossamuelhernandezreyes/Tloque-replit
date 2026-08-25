import { describe, expect, it } from "./test-compat"
import { compileTloqueScore } from "../shared/audio"
import { NATIVE_HYBRID_SOURCES } from "../shared/native-hybrid-source"

const REGISTERS = ["low", "mid", "high"] as const
const GESTURES = ["soft", "neutral", "strong"] as const

function midiNote(midi: number) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}
function registerMidi(source: (typeof NATIVE_HYBRID_SOURCES)[number], register: (typeof REGISTERS)[number]) {
  const fraction = register === "low" ? 0.22 : register === "mid" ? 0.5 : 0.78
  return Math.round(source.midiMin + (source.midiMax - source.midiMin) * fraction)
}
function controlsFor(source: (typeof NATIVE_HYBRID_SOURCES)[number], gesture: (typeof GESTURES)[number]) {
  const level = gesture === "soft" ? 0.3 : gesture === "neutral" ? 0.58 : 0.86
  if (source.physicalLayer === "bowed-string-resonator") return `control 3:1 pressure=${level} bow=${gesture === "soft" ? 0.8 : gesture === "neutral" ? 0.5 : 0.2} coupling=${gesture === "soft" ? 0.24 : gesture === "neutral" ? 0.46 : 0.7} ramp=0.30\ncontrol 4:2 pressure=${Math.max(0.2, level - 0.16)} bow=${gesture === "soft" ? 0.84 : gesture === "neutral" ? 0.57 : 0.28} coupling=${gesture === "soft" ? 0.18 : gesture === "neutral" ? 0.36 : 0.56} ramp=0.25`
  if (source.physicalLayer === "air-column-resonator") return `control 3:1 pressure=${level} embouchure=${gesture === "soft" ? 0.34 : gesture === "neutral" ? 0.52 : 0.74} ramp=0.30\ncontrol 4:2 pressure=${Math.max(0.2, level - 0.16)} embouchure=${gesture === "soft" ? 0.3 : gesture === "neutral" ? 0.46 : 0.66} ramp=0.25`
  if (source.instrumentId === "piano.grand" || source.instrumentId === "keys.celesta") return gesture === "strong"
    ? "control 3:1 pedal=down damper=0.08 coupling=0.86 ramp=0.18\ncontrol 4:2 pedal=down damper=0.14 coupling=0.74 ramp=0.18"
    : gesture === "soft"
      ? "control 3:1 pedal=up damper=0.82 coupling=0.18 ramp=0.18\ncontrol 4:2 pedal=up damper=0.88 coupling=0.12 ramp=0.18"
      : "control 3:1 pedal=down damper=0.44 coupling=0.50 ramp=0.18\ncontrol 4:2 pedal=up damper=0.56 coupling=0.38 ramp=0.18"
  return `control 3:1 pluck=${gesture === "soft" ? 0.72 : gesture === "neutral" ? 0.5 : 0.24} damper=${gesture === "soft" ? 0.74 : gesture === "neutral" ? 0.42 : 0.14} coupling=${gesture === "soft" ? 0.18 : gesture === "neutral" ? 0.48 : 0.8} ramp=0.18\ncontrol 4:2 pluck=${gesture === "soft" ? 0.76 : gesture === "neutral" ? 0.56 : 0.3} damper=${gesture === "soft" ? 0.82 : gesture === "neutral" ? 0.52 : 0.2} coupling=${gesture === "soft" ? 0.12 : gesture === "neutral" ? 0.36 : 0.68} ramp=0.18`
}
function cell(source: (typeof NATIVE_HYBRID_SOURCES)[number], register: (typeof REGISTERS)[number], gesture: (typeof GESTURES)[number]) {
  const midi = registerMidi(source, register), upper = Math.min(source.midiMax, midi + 2)
  return `section ${register}_${gesture} form=development bars=4 repeat=1 fade=0 tempo=120 rubato=0
use probe
1:1 ${midiNote(midi)} 1.5 velocity=0.30 articulation=normal
2:1 ${midiNote(midi)} 1.5 velocity=0.82 articulation=normal
${controlsFor(source, gesture)}
3:1 ${midiNote(midi)} 4 velocity=0.60 articulation=normal
4:1 ${midiNote(upper)} 2 velocity=0.56 articulation=legato
end`
}
function scoreFor(source: (typeof NATIVE_HYBRID_SOURCES)[number]) {
  const matrix = REGISTERS.flatMap(register => GESTURES.map(gesture => cell(source, register, gesture))).join("\n")
  return `TLOQUE_SCORE 2
title "AB matrix ${source.instrumentId}"
tempo 120
meter 4/4
loop false
seed 20260825
humanize 0
quality studio
module native-auto
track probe synth=pad instrument=${source.instrumentId} program=0 role=melody gain=0.32 pan=0 attack=0.025 release=1 expression=0.55 brightness=0.52 vibrato=0.06
${matrix}`
}

describe("hybrid A/B probes", () => {
  for (const source of NATIVE_HYBRID_SOURCES) {
    it(`compiles 3x3 v2.2 physical matrix for ${source.instrumentId}`, () => {
      const result = compileTloqueScore(scoreFor(source))
      expect(result.ok, result.ok ? undefined : JSON.stringify(result.diagnostics)).toBe(true)
      if (!result.ok || result.recipe.version !== 2) return
      expect(result.recipe.plan.events).toHaveLength(36)
      expect(result.recipe.plan.controls).toHaveLength(18)
      expect(result.recipe.plan.compilerVersion).toBe("tloque-score-compiler-v2.2")
      const controls = result.recipe.plan.controls
      if (source.physicalLayer === "bowed-string-resonator") {
        expect(controls.some(control => control.bowPosition === 0.8)).toBe(true)
        expect(controls.some(control => control.bowPosition === 0.2)).toBe(true)
      } else if (source.physicalLayer === "air-column-resonator") {
        expect(controls.some(control => control.embouchure === 0.34)).toBe(true)
        expect(controls.some(control => control.embouchure === 0.74)).toBe(true)
      } else if (source.instrumentId === "piano.grand" || source.instrumentId === "keys.celesta") {
        expect(controls.some(control => control.pedal === false && control.damper === 0.82)).toBe(true)
        expect(controls.some(control => control.pedal === true && control.damper === 0.08)).toBe(true)
      } else {
        expect(controls.some(control => control.pluckPosition === 0.72)).toBe(true)
        expect(controls.some(control => control.pluckPosition === 0.24)).toBe(true)
      }
    })
  }
})
