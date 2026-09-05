export type NativeHybridApproval = "studio" | "master"
export type NativeHybridPhysicalLayer = "bowed-string-resonator" | "air-column-resonator" | "sympathetic-resonance"

export interface NativeHybridSource {
  kind: "hybrid"
  instrumentId: string
  engineVersion: "bowed-string-overlay-v2-continuous-waveguide" | "air-column-overlay-v1.1" | "sympathetic-resonance-v1.1"
  approval: NativeHybridApproval
  masterApproved: boolean
  baseSource: "sample-pack"
  physicalLayer: NativeHybridPhysicalLayer
  midiMin: number
  midiMax: number
  wet: number
  notes: string
}

export const NATIVE_HYBRID_SOURCES: readonly NativeHybridSource[] = [
  { kind: "hybrid", instrumentId: "strings.violin", engineVersion: "bowed-string-overlay-v2-continuous-waveguide", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "bowed-string-resonator", midiMin: 55, midiMax: 103, wet: 0.14, notes: "El sample conserva ataque/transición/release; una sola cuerda waveguide mantiene arco, altura y cuerpo entre legatos. Pizzicato queda sólo sampleado." },
  { kind: "hybrid", instrumentId: "strings.violin-section", engineVersion: "bowed-string-overlay-v2-continuous-waveguide", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "bowed-string-resonator", midiMin: 55, midiMax: 103, wet: 0.11, notes: "Sample de sección dominante + intérpretes físicos decorrelacionados que conservan una frase continua." },
  { kind: "hybrid", instrumentId: "strings.viola", engineVersion: "bowed-string-overlay-v2-continuous-waveguide", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "bowed-string-resonator", midiMin: 48, midiMax: 88, wet: 0.14, notes: "Sample dominante + una sola cuerda física continua para cada línea monofónica enlazada." },
  { kind: "hybrid", instrumentId: "strings.cello", engineVersion: "bowed-string-overlay-v2-continuous-waveguide", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "bowed-string-resonator", midiMin: 36, midiMax: 76, wet: 0.16, notes: "Ataque sampleado y cuerpo waveguide continuo sin reiniciar el arco en cada legato." },
  { kind: "hybrid", instrumentId: "strings.contrabass", engineVersion: "bowed-string-overlay-v2-continuous-waveguide", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "bowed-string-resonator", midiMin: 28, midiMax: 67, wet: 0.18, notes: "Sample grave dominante + cuerda física continua y resonancia de cuerpo; sin duplicar el ataque." },

  { kind: "hybrid", instrumentId: "woodwinds.flute", engineVersion: "air-column-overlay-v1.1", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "air-column-resonator", midiMin: 60, midiMax: 96, wet: 0.085, notes: "Sample dominante; aire/columna física aporta breath y continuidad dinámica." },
  { kind: "hybrid", instrumentId: "woodwinds.piccolo", engineVersion: "air-column-overlay-v1.1", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "air-column-resonator", midiMin: 67, midiMax: 108, wet: 0.065, notes: "Sustain sampleado dominante; overlay de aire muy ligero. Staccato permanece sample-only." },
  { kind: "hybrid", instrumentId: "woodwinds.clarinet", engineVersion: "air-column-overlay-v1.1", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "air-column-resonator", midiMin: 50, midiMax: 94, wet: 0.09, notes: "Refuerzo de columna y reed suave bajo el sample." },
  { kind: "hybrid", instrumentId: "woodwinds.bass-clarinet", engineVersion: "air-column-overlay-v1.1", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "air-column-resonator", midiMin: 37, midiMax: 70, wet: 0.1, notes: "Iowa real dominante; resonancia continua y presión física ligera." },
  { kind: "hybrid", instrumentId: "woodwinds.oboe", engineVersion: "air-column-overlay-v1.1", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "air-column-resonator", midiMin: 58, midiMax: 91, wet: 0.085, notes: "Sample domina la doble lengüeta; overlay sólo estabiliza continuidad." },
  { kind: "hybrid", instrumentId: "woodwinds.bassoon", engineVersion: "air-column-overlay-v1.1", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "air-column-resonator", midiMin: 34, midiMax: 75, wet: 0.1, notes: "Sample dominante + bore continuo ligero." },

  { kind: "hybrid", instrumentId: "brass.trumpet", engineVersion: "air-column-overlay-v1.1", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "air-column-resonator", midiMin: 54, midiMax: 82, wet: 0.075, notes: "Sample conserva labios/ataque; columna añade continuidad de presión." },
  { kind: "hybrid", instrumentId: "brass.horn", engineVersion: "air-column-overlay-v1.1", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "air-column-resonator", midiMin: 41, midiMax: 77, wet: 0.09, notes: "Overlay cálido y poco brillante para sostén de columna." },
  { kind: "hybrid", instrumentId: "brass.trombone", engineVersion: "air-column-overlay-v1.1", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "air-column-resonator", midiMin: 40, midiMax: 72, wet: 0.085, notes: "Sample real dominante + continuidad de bore." },
  { kind: "hybrid", instrumentId: "brass.bass-trombone", engineVersion: "air-column-overlay-v1.1", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "air-column-resonator", midiMin: 25, midiMax: 51, wet: 0.1, notes: "Iowa real domina; overlay refuerza presión y resonancia grave." },
  { kind: "hybrid", instrumentId: "brass.tuba", engineVersion: "air-column-overlay-v1.1", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "air-column-resonator", midiMin: 28, midiMax: 58, wet: 0.105, notes: "Capa física grave y contenida bajo el sample." },

  { kind: "hybrid", instrumentId: "piano.grand", engineVersion: "sympathetic-resonance-v1.1", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "sympathetic-resonance", midiMin: 21, midiMax: 108, wet: 0.08, notes: "Ataque y dinámica quedan sampleados; overlay añade tabla armónica, resonancia simpática y cola física. Pedal, damper y coupling explícitos de TloqueScore 2.2 automatizan el cuerpo resonante." },
  { kind: "hybrid", instrumentId: "keys.celesta", engineVersion: "sympathetic-resonance-v1.1", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "sympathetic-resonance", midiMin: 48, midiMax: 96, wet: 0.055, notes: "La Mustel real conserva el golpe; resonancia metálica/caja se añade a nivel muy bajo." },
  { kind: "hybrid", instrumentId: "strings.harp", engineVersion: "sympathetic-resonance-v1.1", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "sympathetic-resonance", midiMin: 24, midiMax: 103, wet: 0.075, notes: "Pluck sampleado dominante; cuerdas simpáticas y caja prolongan la respuesta sin duplicar el ataque." },
  { kind: "hybrid", instrumentId: "guitar.acoustic", engineVersion: "sympathetic-resonance-v1.1", approval: "studio", masterApproved: false, baseSource: "sample-pack", physicalLayer: "sympathetic-resonance", midiMin: 40, midiMax: 83, wet: 0.065, notes: "Martin HD28 sampleada conserva púa/dedo; overlay modela cuerpo y resonancias simpáticas." },
]

export function nativeHybridForInstrument(instrumentId: string | null | undefined): NativeHybridSource | null {
  if (!instrumentId) return null
  return NATIVE_HYBRID_SOURCES.find(source => source.instrumentId === instrumentId) ?? null
}

export function hybridEnabledForArticulation(instrumentId: string, articulation: string) {
  const source = nativeHybridForInstrument(instrumentId)
  if (!source) return false
  if (source.physicalLayer === "bowed-string-resonator") return articulation !== "pizzicato" && articulation !== "spiccato" && articulation !== "staccato"
  if (source.physicalLayer === "air-column-resonator") return articulation !== "staccato" && articulation !== "spiccato" && articulation !== "pizzicato"
  return articulation === "normal" || articulation === "legato" || articulation === "tenuto" || articulation === "accent"
}
