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
  if (instrumentId.startsWith("strings.") && ["strings.violin", "strings.violin-section", "strings.viola", "strings.cello", "strings.contrabass"].includes(instrumentId)) {
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
