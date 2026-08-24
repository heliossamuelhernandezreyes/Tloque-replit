export type NativeHybridApproval = "studio" | "master"

export interface NativeHybridSource {
  kind: "hybrid"
  instrumentId: "strings.violin" | "strings.viola" | "strings.cello" | "strings.contrabass" | "strings.violin-section"
  engineVersion: "bowed-string-overlay-v1"
  approval: NativeHybridApproval
  masterApproved: boolean
  baseSource: "sample-pack"
  physicalLayer: "bowed-string-resonator"
  midiMin: number
  midiMax: number
  wet: number
  notes: string
}

export const NATIVE_HYBRID_SOURCES: readonly NativeHybridSource[] = [
  { kind: "hybrid", instrumentId: "strings.violin", engineVersion: "bowed-string-overlay-v1", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "bowed-string-resonator", midiMin: 55, midiMax: 103, wet: 0.14, notes: "Sample real dominante + resonancia/arco físico continuo. Pizzicato queda sólo sampleado." },
  { kind: "hybrid", instrumentId: "strings.violin-section", engineVersion: "bowed-string-overlay-v1", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "bowed-string-resonator", midiMin: 55, midiMax: 103, wet: 0.11, notes: "Capa física ligera para evitar fase artificial en sección." },
  { kind: "hybrid", instrumentId: "strings.viola", engineVersion: "bowed-string-overlay-v1", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "bowed-string-resonator", midiMin: 48, midiMax: 88, wet: 0.14, notes: "Sample real dominante + resonancia/arco físico continuo." },
  { kind: "hybrid", instrumentId: "strings.cello", engineVersion: "bowed-string-overlay-v1", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "bowed-string-resonator", midiMin: 36, midiMax: 76, wet: 0.16, notes: "Refuerzo físico de cuerpo, arco y continuidad bajo el sample." },
  { kind: "hybrid", instrumentId: "strings.contrabass", engineVersion: "bowed-string-overlay-v1", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "bowed-string-resonator", midiMin: 28, midiMax: 67, wet: 0.18, notes: "Refuerzo físico grave y resonancia de cuerpo; sample conserva el ataque real." },
]

export function nativeHybridForInstrument(instrumentId: string | null | undefined): NativeHybridSource | null {
  if (!instrumentId) return null
  return NATIVE_HYBRID_SOURCES.find(source => source.instrumentId === instrumentId) ?? null
}

export function hybridEnabledForArticulation(instrumentId: string, articulation: string) {
  const source = nativeHybridForInstrument(instrumentId)
  if (!source) return false
  return articulation !== "pizzicato" && articulation !== "spiccato" && articulation !== "staccato"
}
