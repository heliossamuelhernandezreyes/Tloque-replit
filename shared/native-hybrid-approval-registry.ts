import type { NativeHybridSource } from "./native-hybrid-source"
import { NATIVE_HYBRID_PERFORMANCE_VERSION } from "./native-hybrid-performance"
import type { HybridAbValidationReport } from "./native-hybrid-validation"
import { hybridMasterEvidenceValid } from "./native-hybrid-validation"

export interface NativeHybridApprovalEvidence {
  instrumentId: string
  engineVersion: NativeHybridSource["engineVersion"]
  performanceVersion: typeof NATIVE_HYBRID_PERFORMANCE_VERSION
  report: HybridAbValidationReport
  approvedAt: string
}

/**
 * Deliberately empty until a sampled-vs-hybrid blind A/B run is completed.
 * Evidence must target the exact engine version; changing a hybrid engine
 * invalidates prior approval automatically.
 */
export const NATIVE_HYBRID_APPROVALS: readonly NativeHybridApprovalEvidence[] = []

export function hybridApprovalForSource(source: NativeHybridSource): NativeHybridApprovalEvidence | null {
  return NATIVE_HYBRID_APPROVALS.find(item =>
    item.instrumentId === source.instrumentId &&
    item.engineVersion === source.engineVersion &&
    item.performanceVersion === NATIVE_HYBRID_PERFORMANCE_VERSION,
  ) ?? null
}

export function hybridSourceMasterApproved(source: NativeHybridSource) {
  const evidence = hybridApprovalForSource(source)
  return Boolean(evidence && hybridMasterEvidenceValid(source, evidence.report))
}
