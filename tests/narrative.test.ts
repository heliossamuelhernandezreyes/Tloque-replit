import test from "node:test"
import assert from "node:assert/strict"
import {
  NarrativeCompilationError,
  compileNarrativeProject,
  narrativeProjectSchema,
  narrativeParagraphsFor,
  paragraphCountFor,
  resolveNarrativeRegion,
  type NarrativeProjectV1,
} from "../shared/narrative"

const project: NarrativeProjectV1 = {
  version: 1,
  bookId: 7,
  chapterIndex: 0,
  revision: 3,
  directionStyle: "subtle",
  defaultScoreId: 2,
  regions: [
    {
      id: "calm-start",
      name: "Calma inicial",
      startParagraph: 0,
      preferredParagraph: 1,
      endParagraph: 2,
      mood: "calm",
      targetIntensity: 0.22,
      tension: 0.1,
      warmth: 0.7,
      density: 0.15,
      texture: "open",
      percussion: "none",
      transition: { minimumSeconds: 8, preferredSeconds: 14, maximumSeconds: 24 },
      scoreId: 2,
      layerTags: ["strings.soft"],
      confidence: 0.92,
      source: "manual",
      locked: false,
      note: "",
    },
    {
      id: "rising",
      name: "Tensión gradual",
      startParagraph: 3,
      preferredParagraph: 4,
      endParagraph: 5,
      mood: "rising_tension",
      targetIntensity: 0.48,
      tension: 0.6,
      warmth: 0.3,
      density: 0.4,
      texture: "suspended",
      percussion: "subtle",
      transition: { minimumSeconds: 10, preferredSeconds: 16, maximumSeconds: 28 },
      scoreId: 2,
      layerTags: ["strings.low", "pulse.soft"],
      confidence: 0.86,
      source: "oracle",
      locked: false,
      note: "",
    },
  ],
}

test("compila regiones editoriales a un perfil compacto y normalizado", () => {
  const profile = compileNarrativeProject(project, 6)
  assert.equal(profile.regions.length, 2)
  assert.equal(profile.regions[1].startProgress, 0.6)
  assert.equal(profile.regions[1].endProgress, 1)
  assert.equal("source" in profile.regions[1], false)
  assert.equal("note" in profile.regions[1], false)
})

test("rechaza regiones solapadas o fuera del capítulo", () => {
  const overlapping = structuredClone(project)
  overlapping.regions[1].startParagraph = 2
  assert.throws(() => compileNarrativeProject(overlapping, 6), NarrativeCompilationError)

  const outside = structuredClone(project)
  outside.regions[1].endParagraph = 9
  assert.throws(() => compileNarrativeProject(outside, 6), NarrativeCompilationError)
})

test("rechaza identificadores duplicados y una intensidad protagonista", () => {
  const duplicated = structuredClone(project)
  duplicated.regions[1].id = duplicated.regions[0].id
  assert.throws(() => compileNarrativeProject(duplicated, 6), NarrativeCompilationError)

  const loud = structuredClone(project)
  loud.regions[0].targetIntensity = 0.95
  assert.equal(narrativeProjectSchema.safeParse(loud).success, false)
})

test("ante baja confianza conserva el estado musical actual", () => {
  const profile = compileNarrativeProject(project, 6)
  const decision = resolveNarrativeRegion(profile, 0.7, {
    activeRegionId: "calm-start",
    lastProgress: 0.3,
  }, 0.4)
  assert.equal(decision.region?.id, "calm-start")
  assert.equal(decision.changed, false)
  assert.equal(decision.reason, "low-confidence")
})

test("la partitura solo acepta dirección musical continua, no efectos puntuales", () => {
  const invalid = {
    ...project,
    regions: [{ ...project.regions[0], soundEffect: "sword-impact" }],
  }
  const parsed = narrativeProjectSchema.strict().safeParse(invalid)
  assert.equal(parsed.success, false)
})

test("rechaza etiquetas que intenten disfrazar efectos como capas", () => {
  const invalid = structuredClone(project)
  invalid.regions[0].layerTags = ["dark-harmony", "sword-impact"]
  assert.equal(narrativeProjectSchema.safeParse(invalid).success, false)
})

test("cuenta párrafos estables ignorando separadores vacíos", () => {
  assert.equal(paragraphCountFor("Uno.\n\nDos.\n\n\nTres."), 3)
  assert.equal(paragraphCountFor(""), 1)
  assert.deepEqual(narrativeParagraphsFor("\n\n Uno. \n\n Dos. \n\n"), ["Uno.", "Dos."])
})
