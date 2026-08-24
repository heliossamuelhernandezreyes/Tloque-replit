import type { LinearScoreControlV2, LinearScoreTrackV2 } from "./tloque-score-v2"

export type PhysicalPerformanceControlKey =
  | "pedal"
  | "damper"
  | "bowPosition"
  | "pluckPosition"
  | "pressure"
  | "embouchure"
  | "sympatheticCoupling"

export interface PhysicalPerformanceState {
  pedal: number
  damper: number
  bowPosition: number
  pluckPosition: number
  pressure: number
  embouchure: number
  sympatheticCoupling: number
}

export const DEFAULT_PHYSICAL_PERFORMANCE_STATE: PhysicalPerformanceState = {
  pedal: 0,
  damper: 1,
  bowPosition: 0.5,
  pluckPosition: 0.5,
  pressure: 0.5,
  embouchure: 0.5,
  sympatheticCoupling: 0.35,
}

export function clampPhysicalControl(value: number) {
  return Math.max(0, Math.min(1, value))
}

export function physicalControlSupportedByInstrument(instrumentId: string, key: PhysicalPerformanceControlKey) {
  if (["strings.violin", "strings.violin-section", "strings.viola", "strings.cello", "strings.contrabass"].includes(instrumentId)) {
    return key === "bowPosition" || key === "pressure" || key === "sympatheticCoupling"
  }
  if (instrumentId.startsWith("woodwinds.") || instrumentId.startsWith("brass.")) {
    return key === "pressure" || key === "embouchure"
  }
  if (["piano.grand", "keys.celesta"].includes(instrumentId)) {
    return key === "pedal" || key === "damper" || key === "sympatheticCoupling"
  }
  if (["strings.harp", "guitar.acoustic", "guitar.acoustic-nylon", "guitar.electric-clean"].includes(instrumentId)) {
    return key === "pluckPosition" || key === "damper" || key === "sympatheticCoupling"
  }
  return false
}

/**
 * Compatibility bridge for TLOQUE_SCORE 2.1.
 * Until 2.2 exposes dedicated physical-control tokens, the existing expressive
 * controls are translated to a stable physical state. This keeps old scores
 * valid while giving every hybrid engine the same semantic performance model.
 */
export function physicalPerformanceStateAt(
  track: LinearScoreTrackV2,
  controls: readonly LinearScoreControlV2[],
  timeSeconds: number,
): PhysicalPerformanceState {
  let expression = clampPhysicalControl(track.expression)
  let brightness = clampPhysicalControl(track.brightness)
  let pedal = 0

  for (const control of controls) {
    if (control.trackId !== track.id || control.timeSeconds > timeSeconds) continue
    if (control.expression !== null) expression = clampPhysicalControl(control.expression)
    if (control.brightness !== null) brightness = clampPhysicalControl(control.brightness)
    if (control.pedal !== null) pedal = control.pedal ? 1 : 0
  }

  const state: PhysicalPerformanceState = {
    pedal,
    damper: 1 - pedal,
    bowPosition: brightness,
    pluckPosition: brightness,
    pressure: expression,
    embouchure: brightness,
    sympatheticCoupling: clampPhysicalControl(0.22 + expression * 0.28 + pedal * 0.42),
  }

  return state
}
