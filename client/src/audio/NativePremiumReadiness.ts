import { linearScoreRecipeFor } from "@shared/audio"
import { auditNativeSampleCoverage, type NativeCoverageAudit, type NativeCoverageItem } from "./NativeSampleCoverageAudit"
import { auditNativeScoreDemand, type NativeModuleDemandAudit } from "./NativeSampleDemandAudit"

export type NativePremiumBlockReason = "missing" | "invalid" | "coverage-risk" | "score-unplayable" | "pitch-shift-risk"

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
  if (item.status === "missing") return { moduleId: item.moduleId, instruments: item.instruments, reason: "missing", message: item.message || "Banco acústico no instalado" }
  if (item.status === "invalid") return { moduleId: item.moduleId, instruments: item.instruments, reason: "invalid", message: item.message || "Manifest acústico inválido" }
  if (item.message) return { moduleId: item.moduleId, instruments: item.instruments, reason: "score-unplayable", message: item.message }
  if (item.density === "risk") {
    const details = [item.uncoveredMidi.length ? `${item.uncoveredMidi.length} notas sin zona física` : "", item.maxTransposeNeed !== null ? `transposición máx. ${item.maxTransposeNeed} semitonos` : ""].filter(Boolean).join(" · ")
    return { moduleId: item.moduleId, instruments: item.instruments, reason: "coverage-risk", message: details || "Cobertura física insuficiente para Master premium" }
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
  const demand = coverageBlockers.some(item => item.reason === "missing" || item.reason === "invalid" || item.reason === "score-unplayable") ? [] : await auditNativeScoreDemand(recipe, signal)
  const blockers = [...coverageBlockers, ...demand.map(demandBlocker).filter((item): item is NativePremiumBlocker => Boolean(item))]
  const warnings = audit.items.filter(item => item.status === "ready" && item.density === "sparse" && !item.message)
  return { ready: blockers.length === 0 && audit.scorePlayable, audit, demand, blockers, warnings }
}

export function premiumReadinessError(readiness: NativePremiumReadiness) {
  const rows = readiness.blockers.map(item => `• ${item.instruments.join(", ") || item.moduleId}: ${item.message}`)
  return ["Master premium detenido: la biblioteca física todavía no alcanza el umbral de fidelidad de esta obra.", ...rows, "Instala o densifica los bancos señalados. Tloque no ocultará huecos físicos mediante pitch-shift agresivo ni síntesis base."].join("\n")
}
