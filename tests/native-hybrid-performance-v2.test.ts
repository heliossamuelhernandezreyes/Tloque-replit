import { readFileSync } from "node:fs"
import { describe, expect, it } from "./test-compat"
import { compileTloqueScore } from "../shared/audio"
import {
  boundedHybridOverlayGain,
  buildNativeHybridPerformancePlan,
  NATIVE_HYBRID_PERFORMANCE_VERSION,
} from "../shared/native-hybrid-performance"
import { nativeHybridForInstrument } from "../shared/native-hybrid-source"

function compile(source: string) {
  const result = compileTloqueScore(source)
  if (!result.ok || result.recipe.version !== 2) throw new Error(result.ok ? "wrong recipe version" : result.diagnostics.map(item => item.message).join(" · "))
  return result.recipe
}

const header = (tracks: string) => `TLOQUE_SCORE 2
title "Hybrid performance v2"
tempo 120
meter 4/4
loop false
seed 20260902
humanize 0
quality studio
module native-auto
${tracks}`

describe("Native Hybrid Performance v2", () => {
  it("keeps complete sampled piano chords while thinning and normalizing only the subordinate resonator", () => {
    const recipe = compile(`${header("track piano synth=warm instrument=piano.grand program=0 role=harmony gain=0.3 pan=0 attack=0.02 release=2")}
section chord form=development bars=2 repeat=1 fade=0 tempo=120 rubato=0
use piano
1:1 C1,E1,G1,C2,E2,G2,C3,E3,G3,C4,E4,G4 4 velocity=0.70
1:2 D1,F1,A1,D2,F2,A2,D3,F3,A3,D4,F4,A4 4 velocity=0.72
end`)
    const first = buildNativeHybridPerformancePlan(recipe)
    const second = buildNativeHybridPerformancePlan(recipe)
    expect(first.version).toBe(NATIVE_HYBRID_PERFORMANCE_VERSION)
    expect(first).toEqual(second)
    expect(recipe.plan.events[0].notes).toHaveLength(12)
    expect(first.decisions).toHaveLength(2)
    expect(first.decisions[0].midis).toHaveLength(6)
    expect(first.decisions[1].midis).toHaveLength(6)
    expect(first.scheduledVoiceCount).toBe(12)
    expect(first.suppressedVoiceCount).toBe(12)
    expect(first.decisions[0].midis[0]).toBe(recipe.plan.events[0].notes[0])
    expect(first.decisions[0].midis.at(-1)).toBe(recipe.plan.events[0].notes.at(-1))
    expect(first.decisions[1].soundingHybridVoices).toBe(12)
    expect(first.decisions[1].mixScale).toBeLessThan(first.decisions[0].mixScale)
  })

  it("connects only plausible monophonic legato and treats an authored rest as a hard phrase boundary", () => {
    const recipe = compile(`${header("track violin synth=pad instrument=strings.violin program=40 role=melody gain=0.3 pan=0 attack=0.08 release=1 expression=0.8 brightness=0.5 vibrato=0.1")}
section line form=development bars=2 repeat=1 fade=0 tempo=120 rubato=0
use violin
1:1 C4 1 velocity=0.50 articulation=legato
1:2 D4 1 velocity=0.52 articulation=legato
1:3 E4 0.9 velocity=0.54 articulation=normal
rest 1:3.9 0.1
1:4 F4 1 velocity=0.56 articulation=legato
2:1 F5 0.9 velocity=0.58 articulation=normal
2:1.9 F7 1 velocity=0.60 articulation=legato
end`)
    const decisions = buildNativeHybridPerformancePlan(recipe).decisions
    expect(decisions.map(decision => decision.transition)).toEqual([
      "fresh-attack",
      "connected-legato",
      "fresh-attack",
      "fresh-attack",
      "fresh-attack",
      "fresh-attack",
    ])
    expect(decisions[1].transitionFromMidi).toBe(60)
    expect(decisions[1].phraseId).toBe(decisions[0].phraseId)
    expect(decisions[3].phraseId).not.toBe(decisions[2].phraseId)
    expect(decisions[5].transitionFromMidi).toBeNull()
  })

  it("never invents connected legato for chords, repeated pitches or sympathetic instruments", () => {
    const recipe = compile(`${header(`track violin synth=pad instrument=strings.violin program=40 role=melody gain=0.3 pan=0 attack=0.08 release=1
track piano synth=warm instrument=piano.grand program=0 role=harmony gain=0.3 pan=0 attack=0.02 release=2`)}
section guards form=development bars=2 repeat=1 fade=0 tempo=120 rubato=0
use violin
1:1 C4,E4 1 velocity=0.5 articulation=normal
1:2 D4,F4 1 velocity=0.5 articulation=legato
1:3 G4 1 velocity=0.5 articulation=normal
1:4 G4 1 velocity=0.5 articulation=legato
use piano
2:1 C3 1 velocity=0.5 articulation=normal
2:2 D3 1 velocity=0.5 articulation=legato
end`)
    const decisions = buildNativeHybridPerformancePlan(recipe).decisions
    expect(decisions.every(decision => decision.transition === "fresh-attack")).toBe(true)
  })

  it("caps calibrated DSP gain below the per-event sample-dominance ceiling", () => {
    const source = nativeHybridForInstrument("strings.contrabass")!
    const performance = {
      contractVersion: NATIVE_HYBRID_PERFORMANCE_VERSION,
      transition: "connected-legato" as const,
      mixScale: 0.5,
      wetCeiling: source.wet * 0.5,
      excitationScale: 0.7,
    }
    expect(boundedHybridOverlayGain(source, 10, performance)).toBe(source.wet * 0.5)
    expect(boundedHybridOverlayGain(source, source.wet, performance)).toBeLessThan(source.wet * 0.5)
    expect(boundedHybridOverlayGain(source, 10)).toBe(source.wet)
  })

  it("routes realtime and WAV through the exact same compiled performance decisions", () => {
    for (const file of ["client/src/audio/NativeSampleScoreEngine.ts", "client/src/audio/NativeSampleScoreExporter.ts"]) {
      const source = readFileSync(file, "utf8")
      expect(source).toMatch(/buildNativeHybridPerformancePlan\(recipe\)/)
      expect(source).toMatch(/hybridPerformance\.decisions/)
      expect(source).toMatch(/performance: decision/)
      expect(source).toMatch(/decision\.midis/)
    }
  })

  it("injects lab tuning into the measured render while Master rejects ephemeral calibration", () => {
    const calibrationRunner = readFileSync("client/src/audio/HybridAbCalibrationRunner.ts", "utf8")
    const candidateRunner = readFileSync("client/src/audio/HybridCalibrationCandidateRunner.ts", "utf8")
    const exporter = readFileSync("client/src/audio/NativeSampleScoreExporter.ts", "utf8")
    expect(candidateRunner).toMatch(/runHybridAbCalibration\(tunedSource, signal\)/)
    expect(calibrationRunner).toMatch(/hybridCalibrationSource: source/)
    expect(exporter).toMatch(/profile\.quality === "master"/)
    expect(exporter).toMatch(/Master no admite ajustes híbridos efímeros/)
    expect(exporter).toMatch(/calibratedHybridSource\(decision\.source, options\.hybridCalibrationSource\)/)
  })
})
