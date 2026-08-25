import { describe, expect, it } from "vitest"
import { compileTloqueScoreV2, linearScoreRecipeV2Schema, TLOQUE_SCORE_COMPILER_V2, TLOQUE_SCORE_COMPILER_V2_1 } from "../shared/tloque-score-v2"

const base = `TLOQUE_SCORE 2
title "Physical control probe"
tempo 96
meter 4/4
loop false
seed 22
humanize 0
quality studio
module native-auto
track violin synth=pad instrument=strings.violin program=40 role=melody gain=0.3 pan=0 attack=0.02 release=1 expression=0.5 brightness=0.5 vibrato=0
section probe form=custom bars=2 repeat=1 fade=0 tempo=96 rubato=0
use violin`

describe("TloqueScore compiler v2.2 physical controls", () => {
  it("compiles dedicated physical controls without altering the TLOQUE_SCORE 2 header", () => {
    const result = compileTloqueScoreV2(`${base}
control 1:1 pressure=0.82 bow=0.18 coupling=0.64 ramp=0.5
1:1 A4 2 velocity=0.6 articulation=legato
control 2:1 embouchure=0.33 pluck=0.71 damper=0.2
2:1 B4 2 velocity=0.58
end`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.recipe.plan.compilerVersion).toBe(TLOQUE_SCORE_COMPILER_V2)
    expect(result.recipe.plan.controls[0]).toMatchObject({ pressure: 0.82, bowPosition: 0.18, sympatheticCoupling: 0.64 })
    expect(result.recipe.plan.controls[1]).toMatchObject({ embouchure: 0.33, pluckPosition: 0.71, damper: 0.2 })
  })

  it("rejects physical axes outside 0..1", () => {
    const result = compileTloqueScoreV2(`${base}
control 1:1 pressure=1.2
1:1 A4 2 velocity=0.6
end`)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics.some(item => item.message.includes("pressure"))).toBe(true)
  })

  it("keeps parsing stored v2.1 recipes by defaulting new axes to null", () => {
    const current = compileTloqueScoreV2(`${base}
control 1:1 expression=0.7 pedal=down
1:1 A4 2 velocity=0.6
end`)
    expect(current.ok).toBe(true)
    if (!current.ok) return
    const stored21 = JSON.parse(JSON.stringify(current.recipe))
    stored21.plan.compilerVersion = TLOQUE_SCORE_COMPILER_V2_1
    for (const control of stored21.plan.controls) {
      delete control.pressure
      delete control.embouchure
      delete control.bowPosition
      delete control.pluckPosition
      delete control.damper
      delete control.sympatheticCoupling
    }
    const parsed = linearScoreRecipeV2Schema.parse(stored21)
    expect(parsed.plan.compilerVersion).toBe(TLOQUE_SCORE_COMPILER_V2_1)
    expect(parsed.plan.controls[0].pressure).toBeNull()
    expect(parsed.plan.controls[0].damper).toBeNull()
  })
})
