import type { NativeAcousticValidationReport } from "./native-acoustic-validation"

export interface NativeMasterApprovalEvidence {
  version: 1
  moduleId: string
  engineVersion: string
  report: NativeAcousticValidationReport
  humanABApproved: boolean
  reviewer: string
  reviewedAt: string
  notes: string
}

/**
 * Master approvals are intentionally code-reviewed evidence, not mutable flags.
 * A model enters this registry only after its objective calibration report passes
 * and a human A/B review against legal references has been recorded.
 */
export const NATIVE_MASTER_APPROVALS: readonly NativeMasterApprovalEvidence[] = []

export function masterApprovalForModule(moduleId: string | null | undefined, engineVersion?: string | null): NativeMasterApprovalEvidence | null {
  if (!moduleId) return null
  return NATIVE_MASTER_APPROVALS.find(item => item.moduleId === moduleId && (!engineVersion || item.engineVersion === engineVersion)) ?? null
}

export function masterApprovalEvidenceValid(evidence: NativeMasterApprovalEvidence | null | undefined): boolean {
  if (!evidence) return false
  return Boolean(
    evidence.humanABApproved
    && evidence.reviewer.trim()
    && evidence.notes.trim().length >= 12
    && evidence.report.pass
    && evidence.report.masterEligible
    && evidence.report.metrics.length >= 5
    && evidence.report.metrics.every(metric => metric.status === "pass"),
  )
}
