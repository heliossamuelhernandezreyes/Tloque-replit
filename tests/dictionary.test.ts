import test from "node:test"
import assert from "node:assert/strict"
import { cleanDictionaryText, extractWiktionarySenses } from "../server/dictionary"

test("limpia HTML del diccionario sin conservar contenido ejecutable", () => {
  assert.equal(
    cleanDictionaryText('<b>Casa</b> &amp; hogar <script>alert(1)</script>'),
    "Casa & hogar alert(1)",
  )
})

test("extrae varias acepciones, categoría y ejemplo sin duplicarlas", () => {
  const senses = extractWiktionarySenses({
    es: [{
      partOfSpeech: "Sustantivo",
      definitions: [
        { definition: "<b>Edificio</b> para habitar.", parsedExamples: [{ example: "Volvió a casa." }] },
        { definition: "Edificio para habitar." },
        { definition: "Linaje o familia." },
      ],
    }],
  }, "es")
  assert.deepEqual(senses, [
    { partOfSpeech: "Sustantivo", definition: "Edificio para habitar.", example: "Volvió a casa." },
    { partOfSpeech: "Sustantivo", definition: "Linaje o familia.", example: "" },
  ])
})

test("no mezcla homónimos de idiomas distintos", () => {
  const senses = extractWiktionarySenses({
    en: [{ partOfSpeech: "noun", definitions: [{ definition: "An English meaning." }] }],
    la: [{ partOfSpeech: "nomen", definitions: [{ definition: "Sensus Latinus." }] }],
  }, "la")
  assert.deepEqual(senses, [
    { partOfSpeech: "nomen", definition: "Sensus Latinus.", example: "" },
  ])
  assert.deepEqual(extractWiktionarySenses({ en: [] }, "ru"), [])
})
