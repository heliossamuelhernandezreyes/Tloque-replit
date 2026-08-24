import test from "node:test"
import assert from "node:assert/strict"
import { NATIVE_PHYSICAL_MODEL_SOURCES } from "../shared/native-acoustic-source"
import {
  acousticMetricStatus,
  validationProfileForInstrument,
  validationReportMasterEligible,
  type NativeAcousticValidationReport,
} from "../shared/native-acoustic-validation"
import { masterApprovalEvidenceValid, masterApprovalForModule } from "../shared/native-acoustic-approval-registry"

test("physical models are versioned against explicit acoustic validation profiles", () => {
  assert.equal(NATIVE_PHYSICAL_MODEL_SOURCES.length, 2)
  for (const source of NATIVE_PHYSICAL_MODEL_SOURCES) {
    assert.equal(source.engineVersion, "reed-resonator-v2")
    assert.equal(source.validationProfileId, "tloque-double-reed-reference-v1")
    assert.ok(validationProfileForInstrument(source.instrumentId))
  }
})

test("metric gate distinguishes pass warn and fail", () => {
  assert.equal(acousticMetricStatus(10, 0, 20), "pass")
  assert.equal(acousticMetricStatus(21, 0, 20), "warn")
  assert.equal(acousticMetricStatus(30, 0, 20), "fail")
})

test("objective pass alone cannot self-approve Master", () => {
  const report: NativeAcousticValidationReport = {
    version: 1,
    modelId: "double-reed-english-horn-v1",
    instrumentId: "woodwinds.english-horn",
    generatedAt: new Date(0).toISOString(),
    referenceSet: "tloque-double-reed-reference-v1",
    metrics: [
      { id: "pitch-stability", label: "pitch", value: 2, unit: "cents", targetMin: 0, targetMax: 18, status: "pass", note: "ok" },
      { id: "dynamic-response", label: "dynamic", value: 12, unit: "db", targetMin: 7, targetMax: 24, status: "pass", note: "ok" },
      { id: "spectral-balance", label: "spectral", value: 0.4, unit: "ratio", targetMin: 0.18, targetMax: 0.72, status: "pass", note: "ok" },
      { id: "attack-envelope", label: "attack", value: 65, unit: "ms", targetMin: 18, targetMax: 145, status: "pass", note: "ok" },
      { id: "legato-continuity", label: "legato", value: 2.4, unit: "db", targetMin: 0, targetMax: 5.5, status: "pass", note: "ok" },
    ],
    pass: true,
    masterEligible: false,
  }
  assert.equal(validationReportMasterEligible(report), false)
  assert.equal(masterApprovalEvidenceValid({
    version: 1,
    moduleId: "tloque-model-english-horn-v1",
    engineVersion: "reed-resonator-v2",
    report,
    humanABApproved: true,
    reviewer: "reviewer",
    reviewedAt: new Date(0).toISOString(),
    notes: "A/B reviewed against legal acoustic references",
  }), false)
})

test("no physical model is accidentally Master-approved without evidence", () => {
  for (const source of NATIVE_PHYSICAL_MODEL_SOURCES) {
    assert.equal(masterApprovalForModule(source.moduleId, source.engineVersion), null)
  }
})
