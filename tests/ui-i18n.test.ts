import test from "node:test"
import assert from "node:assert/strict"
import {
  SUPPORTED_UI_LANGUAGES,
  UI_STRINGS,
} from "../client/src/context/SettingsContext"

test("la interfaz tiene exactamente las mismas claves en sus nueve idiomas", () => {
  assert.equal(SUPPORTED_UI_LANGUAGES.length, 9)
  const reference = Object.keys(UI_STRINGS.es).sort()
  assert.ok(reference.length >= 400)
  for (const language of SUPPORTED_UI_LANGUAGES) {
    const entries = UI_STRINGS[language]
    assert.deepEqual(Object.keys(entries).sort(), reference, language)
    for (const key of reference) {
      assert.ok(entries[key]?.trim(), `${language}.${key}`)
    }
  }
})
