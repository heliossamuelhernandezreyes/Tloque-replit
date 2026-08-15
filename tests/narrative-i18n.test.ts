import test from "node:test"
import assert from "node:assert/strict"
import {
  NARRATIVE_UI_LANGUAGES,
  NARRATIVE_UI_STRINGS,
  narrativeUi,
} from "../shared/narrative-i18n"

test("la dirección musical tiene el mismo contrato de textos en los nueve idiomas", () => {
  const expected = Object.keys(NARRATIVE_UI_STRINGS.es).sort()
  assert.equal(NARRATIVE_UI_LANGUAGES.length, 9)
  for (const language of NARRATIVE_UI_LANGUAGES) {
    const strings = NARRATIVE_UI_STRINGS[language]
    assert.deepEqual(Object.keys(strings).sort(), expected)
    assert.equal(Object.values(strings).every(value => value.trim().length > 0), true)
  }
})

test("un idioma desconocido cae a español de forma segura", () => {
  assert.equal(narrativeUi("xx").title, NARRATIVE_UI_STRINGS.es.title)
})
