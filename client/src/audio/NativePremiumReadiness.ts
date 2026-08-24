import { linearScoreRecipeFor } from "@shared/audio"
import { auditNativeSampleCoverage, type NativeCoverageAudit, type NativeCoverageItem } from "./NativeSampleCoverageAudit"
import { auditNativeScoreDemand, type NativeModuleDemandAudit } from "./NativeSampleDemandAudit"

export type NativePremiumBlockReason = "missing" | "invalid" | "coverage-risk" | "score-unplayable" | "pitch-shift-risk" | "model-validation"

export interface NativePremiumBlocker {
  moduleId: string
  instruments: readonly string[]
  reason: NativePremiumBlockReason
  message: string
}

export interface NativePremiumReadiness {
  ready: boolean
  audit: NativeCoverageAudit
  demand: readonly NativeModuleDemandAudit[]
  blockers: readonly NativePremiumBlocker[]
  warnings: readonly NativeCoverageItem[]
}

function blockerFor(item: NativeCoverageItem): NativePremiumBlocker | null {
  if (item.status === "missing") return { moduleId: item.moduleId, instruments: item.instruments, reason: "missing", message: item.message || "Fuente acústica no disponible" }
  if (item.status === "invalid") return { moduleId: item.moduleId, instruments: item.instruments, reason: "invalid", message: item.message || "Fuente acústica inválida" }
  if (item.message) return { moduleId: item.moduleId, instruments: item.instruments, reason: "score-unplayable", message: item.message }
  if (item.sourceKind === "sample-pack" && item.density === "risk") {
    const details = [item.uncoveredMidi.length ? `${item.uncoveredMidi.length} notas sin zona física` : "", item.maxTransposeNeed !== null ? `transposición máx. ${item.maxTransposeNeed} semitonos` : ""].filter(Boolean).join(" · ")
    return { moduleId: item.moduleId, instruments: item.instruments, reason: "coverage-risk", message: details || "Cobertura sampleada insuficiente para Master premium" }
  }
  return null
}

function demandBlocker(item: NativeModuleDemandAudit): NativePremiumBlocker | null {
  if (item.risk !== "high") return null
  return {
    moduleId: item.moduleId,
    instruments: item.instruments,
    reason: "pitch-shift-risk",
    message: `${item.shiftedOverThreeSemitones} voces superan 3 semitonos · máximo ${item.maxShiftSemitones.toFixed(2)} · media ${item.meanShiftSemitones.toFixed(2)}`,
  }
}

export async function assessNativePremiumReadiness(value: unknown, signal?: AbortSignal): Promise<NativePremiumReadiness> {
  const recipe = linearScoreRecipeFor(value)
  const audit = await auditNativeSampleCoverage(recipe, signal)
  if (recipe.version !== 2 || recipe.plan.moduleId === "builtin") return { ready: true, audit, demand: [], blockers: [], warnings: [] }
  const coverageBlockers = audit.items.map(blockerFor).filter((item): item is NativePremiumBlocker => Boolean(item))
  const modelValidationBlockers: NativePremiumBlocker[] = recipe.plan.quality === "master"
    ? audit.items.filter(item => item.sourceKind === "physical-model" && item.status === "ready" && !item.masterApproved).map(item => ({
        moduleId: item.moduleId,
        instruments: item.instruments,
        reason: "model-validation" as const,
        message: "Modelo físico disponible en Studio, pero todavía no ha pasado la calibración A/B exigida para Master.",
      }))
    : []
  const fatalCoverage = coverageBlockers.some(item => item.reason === "missing" || item.reason === "invalid" || item.reason === "score-unplayable")
  const demand = fatalCoverage ? [] : await auditNativeScoreDemand(recipe, signal)
  const blockers = [...coverageBlockers, ...modelValidationBlockers, ...demand.map(demandBlocker).filter((item): item is NativePremiumBlocker => Boolean(item))]
  const warnings = audit.items.filter(item => item.status === "ready" && ((item.sourceKind === "sample-pack" && item.density === "sparse" && !item.message) || (item.sourceKind === "physical-model" && !item.masterApproved)))
  return { ready: blockers.length === 0 && audit.scorePlayable, audit, demand, blockers, warnings }
}

export function premiumReadinessError(readiness: NativePremiumReadiness) {
  const rows = readiness.blockers.map(item => `• ${item.instruments.join(", ") || item.moduleId}: ${item.message}`)
  return [
    "Master premium detenido: una o más fuentes acústicas todavía no alcanzan el umbral de fidelidad de esta obra.",
    ...rows,
    "Tloque acepta samples, modelos físicos y fuentes híbridas, pero Master sólo se habilita cuando la fuente concreta supera su control de calidad; no ocultará huecos con pitch-shift agresivo ni con síntesis base genérica.",
  ].join("\n")
}
