import assert from "node:assert/strict"
import test from "node:test"
import { EXPERIENCE_LANGUAGES, EXPERIENCE_STRINGS } from "../shared/experience-i18n"

test("experience copy is complete in every supported language", () => {
  const expected = Object.keys(EXPERIENCE_STRINGS.es).sort()
  for (const language of EXPERIENCE_LANGUAGES) {
    assert.deepEqual(Object.keys(EXPERIENCE_STRINGS[language]).sort(), expected, language)
    for (const key of expected) assert.ok(EXPERIENCE_STRINGS[language][key as keyof typeof EXPERIENCE_STRINGS.es].trim(), `${language}.${key}`)
  }
})
