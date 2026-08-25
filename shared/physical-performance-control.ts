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
 * TLOQUE_SCORE 2.2 physical-performance state.
 *
 * 2.1 scores remain valid: expression/brightness/pedal are translated to the
 * same compatibility state as before. 2.2 controls are sparse overrides: an
 * explicit physical value replaces only that axis and persists until another
 * explicit value for the same axis appears.
 */
export function physicalPerformanceStateAt(
  track: LinearScoreTrackV2,
  controls: readonly LinearScoreControlV2[],
  timeSeconds: number,
): PhysicalPerformanceState {
  let expression = clampPhysicalControl(track.expression)
  let brightness = clampPhysicalControl(track.brightness)
  let pedal = 0
  let pressure: number | null = null
  let embouchure: number | null = null
  let bowPosition: number | null = null
  let pluckPosition: number | null = null
  let damper: number | null = null
  let sympatheticCoupling: number | null = null

  for (const control of controls) {
    if (control.trackId !== track.id || control.timeSeconds > timeSeconds) continue
    if (control.expression !== null) expression = clampPhysicalControl(control.expression)
    if (control.brightness !== null) brightness = clampPhysicalControl(control.brightness)
    if (control.pedal !== null) pedal = control.pedal ? 1 : 0
    if (control.pressure !== null) pressure = clampPhysicalControl(control.pressure)
    if (control.embouchure !== null) embouchure = clampPhysicalControl(control.embouchure)
    if (control.bowPosition !== null) bowPosition = clampPhysicalControl(control.bowPosition)
    if (control.pluckPosition !== null) pluckPosition = clampPhysicalControl(control.pluckPosition)
    if (control.damper !== null) damper = clampPhysicalControl(control.damper)
    if (control.sympatheticCoupling !== null) sympatheticCoupling = clampPhysicalControl(control.sympatheticCoupling)
  }

  return {
    pedal,
    damper: damper ?? 1 - pedal,
    bowPosition: bowPosition ?? brightness,
    pluckPosition: pluckPosition ?? brightness,
    pressure: pressure ?? expression,
    embouchure: embouchure ?? brightness,
    sympatheticCoupling: sympatheticCoupling ?? clampPhysicalControl(0.22 + expression * 0.28 + pedal * 0.42),
  }
}
