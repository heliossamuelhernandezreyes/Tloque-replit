import test from "node:test"
import assert from "node:assert/strict"
import {
  cleanDictionaryText,
  extractWiktionarySenses,
  lookupDictionary,
  localizeDictionarySenses,
  normalizeDictionaryLanguage,
} from "../server/dictionary"

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

test("normaliza variantes regionales sin convertir un idioma desconocido en otro", () => {
  assert.equal(normalizeDictionaryLanguage("pt-BR"), "pt")
  assert.equal(normalizeDictionaryLanguage("ar_SA"), "ar")
  assert.equal(normalizeDictionaryLanguage("xx", "fr"), "fr")
})

test("una traducción fallida no filtra definiciones inglesas a un lector árabe", async () => {
  const senses = [{
    partOfSpeech: "noun",
    definition: "A building where somebody lives.",
    example: "She returned home.",
  }]
  const localized = await localizeDictionarySenses(
    senses,
    "en",
    "ar",
    async text => text,
  )
  assert.deepEqual(localized, [])
})

test("rechaza como árabe una respuesta modificada que sigue escrita en latín", async () => {
  const localized = await localizeDictionarySenses([{
    partOfSpeech: "noun",
    definition: "A place used as a home.",
    example: "",
  }], "en", "ar", async text => `${text} translated`)
  assert.deepEqual(localized, [])
})

test("localiza por completo las acepciones de respaldo y no mezcla el ejemplo", async () => {
  const dictionary = new Map([
    ["A building where somebody lives.", "Edifício onde alguém mora."],
    ["noun", "substantivo"],
  ])
  const localized = await localizeDictionarySenses([{
    partOfSpeech: "noun",
    definition: "A building where somebody lives.",
    example: "She returned home.",
  }], "en", "pt", async text => dictionary.get(text) || text)
  assert.deepEqual(localized, [{
    partOfSpeech: "substantivo",
    definition: "Edifício onde alguém mora.",
    example: "",
  }])
})

test("prefiere una edición Wiktionary en la lengua del lector", async () => {
  const originalFetch = globalThis.fetch
  const translations: string[] = []
  globalThis.fetch = async input => {
    assert.match(String(input), /^https:\/\/ar\.wiktionary\.org\//)
    return new Response(JSON.stringify({
      en: [{
        partOfSpeech: "اسم",
        definitions: [{ definition: "مبنى يعيش فيه شخص." }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } })
  }

  try {
    const result = await lookupDictionary(
      "home-target-edition-test",
      "en",
      "ar",
      async text => {
        translations.push(text)
        return "منزل"
      },
    )
    assert.equal(result.definitionLanguage, "ar")
    assert.equal(result.source, "wiktionary-ar")
    assert.equal(result.senses[0]?.definition, "مبنى يعيش فيه شخص.")
    assert.deepEqual(translations, ["home-target-edition-test"])
  } finally {
    globalThis.fetch = originalFetch
  }
})
