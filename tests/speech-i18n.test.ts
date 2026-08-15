import test from "node:test"
import assert from "node:assert/strict"
import { SPEECH_UI_LANGUAGES, SPEECH_UI_STRINGS, speechUi } from "../shared/speech-i18n"

test("la dirección de voz y el audiolibro tienen textos completos en los nueve idiomas", () => {
  const expected = Object.keys(SPEECH_UI_STRINGS.es).sort()
  assert.equal(SPEECH_UI_LANGUAGES.length, 9)
  for (const language of SPEECH_UI_LANGUAGES) {
    const copy = SPEECH_UI_STRINGS[language]
    assert.deepEqual(Object.keys(copy).sort(), expected)
    for (const value of Object.values(copy)) assert.ok(value.trim().length > 0)
  }
  assert.equal(speechUi("desconocido").title, SPEECH_UI_STRINGS.es.title)
})
