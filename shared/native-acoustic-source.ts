export type NativeAcousticSourceKind = "sample-pack" | "physical-model" | "hybrid"
export type NativeAcousticApproval = "studio" | "master"

export interface NativePhysicalModelSource {
  kind: "physical-model"
  moduleId: string
  instrumentId: string
  modelId: "double-reed-english-horn-v1" | "double-reed-contrabassoon-v1"
  modelFamily: "double-reed-resonator"
  engineVersion: "reed-resonator-v2"
  validationProfileId: "tloque-double-reed-reference-v1"
  midiMin: number
  midiMax: number
  approval: NativeAcousticApproval
  masterApproved: boolean
  provenance: "tloque-original-model"
  notes: string
}

export const NATIVE_PHYSICAL_MODEL_SOURCES: readonly NativePhysicalModelSource[] = [
  {
    kind: "physical-model",
    moduleId: "tloque-model-english-horn-v1",
    instrumentId: "woodwinds.english-horn",
    modelId: "double-reed-english-horn-v1",
    modelFamily: "double-reed-resonator",
    engineVersion: "reed-resonator-v2",
    validationProfileId: "tloque-double-reed-reference-v1",
    midiMin: 52,
    midiMax: 80,
    approval: "studio",
    masterApproved: false,
    provenance: "tloque-original-model",
    notes: "Modelo original de doble lengüeta v2: excitación, bore resonante y automatización continua. Studio aprobado; Master sólo se habilita con reporte acústico completo y revisión A/B.",
  },
  {
    kind: "physical-model",
    moduleId: "tloque-model-contrabassoon-v1",
    instrumentId: "woodwinds.contrabassoon",
    modelId: "double-reed-contrabassoon-v1",
    modelFamily: "double-reed-resonator",
    engineVersion: "reed-resonator-v2",
    validationProfileId: "tloque-double-reed-reference-v1",
    midiMin: 34,
    midiMax: 53,
    approval: "studio",
    masterApproved: false,
    provenance: "tloque-original-model",
    notes: "Modelo original de doble lengüeta grave v2: excitación, bore largo resonante y automatización continua. Studio aprobado; Master sólo se habilita con reporte acústico completo y revisión A/B.",
  },
]

export function nativePhysicalModelByModuleId(moduleId: string | null | undefined): NativePhysicalModelSource | null {
  if (!moduleId) return null
  return NATIVE_PHYSICAL_MODEL_SOURCES.find(source => source.moduleId === moduleId) ?? null
}

export function nativePhysicalModelForInstrument(instrumentId: string | null | undefined): NativePhysicalModelSource | null {
  if (!instrumentId) return null
  return NATIVE_PHYSICAL_MODEL_SOURCES.find(source => source.instrumentId === instrumentId) ?? null
}

export function isNativePhysicalModelModule(moduleId: string | null | undefined): boolean {
  return Boolean(nativePhysicalModelByModuleId(moduleId))
}
