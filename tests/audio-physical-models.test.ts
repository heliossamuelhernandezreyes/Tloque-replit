import test from "node:test"
import assert from "node:assert/strict"
import { compileTloqueScoreV2 } from "../shared/tloque-score-v2"
import { NATIVE_PHYSICAL_MODEL_SOURCES, nativePhysicalModelForInstrument } from "../shared/native-acoustic-source"
import { NATIVE_LIBRARY_INDEX, NATIVE_LIBRARY_MODELED_STUDIO } from "../shared/native-library-index"
import { preferredNativeModuleForInstrument, nativeModuleGroupsForRecipe } from "../client/src/audio/NativeAutoModule"
import { auditNativeSampleCoverage } from "../client/src/audio/NativeSampleCoverageAudit"
import { assessNativePremiumReadiness } from "../client/src/audio/NativePremiumReadiness"

function physicalScore(quality: "studio" | "master") {
  const compiled = compileTloqueScoreV2(`TLOQUE_SCORE 2
title "Physical reeds"
tempo 72
meter 4/4
loop false
seed 42
humanize 0
quality ${quality}
module native-auto

track cor synth=warm instrument=woodwinds.english-horn program=69 role=melody gain=0.35 pan=0.12 attack=0.06 release=0.5 expression=0.72 brightness=0.58 vibrato=0.16
track contra synth=bass instrument=woodwinds.contrabassoon program=70 role=bass gain=0.34 pan=-0.15 attack=0.04 release=0.55 expression=0.76 brightness=0.32 vibrato=0.05

section a form=exposition bars=1 repeat=1 fade=0 tempo=72 rubato=0
use cor
1:1 E3 2 velocity=0.55 articulation=legato
use contra
1:1 C2 4 velocity=0.48 articulation=tenuto
end`)
  assert.equal(compiled.ok, true)
  if (!compiled.ok) throw new Error(compiled.diagnostics.map(item => item.message).join("; "))
  return compiled.recipe
}

test("Tloque registra modelos físicos originales para los dos huecos orquestales", () => {
  assert.equal(NATIVE_PHYSICAL_MODEL_SOURCES.length, 2)
  const english = nativePhysicalModelForInstrument("woodwinds.english-horn")
  const contra = nativePhysicalModelForInstrument("woodwinds.contrabassoon")
  assert.ok(english)
  assert.ok(contra)
  assert.equal(english.masterApproved, false)
  assert.equal(contra.masterApproved, false)
  assert.equal(english.provenance, "tloque-original-model")
  assert.equal(contra.provenance, "tloque-original-model")
  assert.ok(english.midiMin <= 52 && english.midiMax >= 80)
  assert.ok(contra.midiMin <= 34 && contra.midiMax >= 53)
})

test("native-auto enruta English Horn y Contrabassoon a modelos físicos", () => {
  assert.equal(preferredNativeModuleForInstrument("woodwinds.english-horn"), "tloque-model-english-horn-v1")
  assert.equal(preferredNativeModuleForInstrument("woodwinds.contrabassoon"), "tloque-model-contrabassoon-v1")
  const groups = nativeModuleGroupsForRecipe(physicalScore("studio"))
  assert.deepEqual(groups.map(group => group.moduleId).sort(), ["tloque-model-contrabassoon-v1", "tloque-model-english-horn-v1"])
})

test("el índice distingue fuente modelada Studio de un hueco sin resolver", () => {
  const english = NATIVE_LIBRARY_INDEX.find(item => item.instrumentId === "woodwinds.english-horn")
  const contra = NATIVE_LIBRARY_INDEX.find(item => item.instrumentId === "woodwinds.contrabassoon")
  assert.equal(english?.status, "modeled-studio")
  assert.equal(contra?.status, "modeled-studio")
  assert.equal(english?.sourceKind, "physical-model")
  assert.equal(contra?.sourceKind, "physical-model")
  assert.ok(NATIVE_LIBRARY_MODELED_STUDIO.some(item => item.instrumentId === "woodwinds.english-horn"))
})

test("la auditoría trata el registro modelado como pitch continuo sin pedir sample packs", async () => {
  const audit = await auditNativeSampleCoverage(physicalScore("studio"))
  assert.equal(audit.scorePlayable, true)
  assert.equal(audit.items.length, 2)
  assert.ok(audit.items.every(item => item.sourceKind === "physical-model"))
  assert.ok(audit.items.every(item => item.maxTransposeNeed === 0))
  assert.ok(audit.items.every(item => item.density === "dense"))
})

test("Studio acepta modelos físicos y Master exige calibración explícita", async () => {
  const studio = await assessNativePremiumReadiness(physicalScore("studio"))
  assert.equal(studio.ready, true)
  assert.equal(studio.blockers.length, 0)

  const master = await assessNativePremiumReadiness(physicalScore("master"))
  assert.equal(master.ready, false)
  assert.equal(master.blockers.length, 2)
  assert.ok(master.blockers.every(item => item.reason === "model-validation"))
})
