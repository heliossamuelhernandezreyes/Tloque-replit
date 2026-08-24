import test from "node:test"
import assert from "node:assert/strict"
import { preferredNativeModuleForInstrument } from "../client/src/audio/NativeAutoModule"

test("native-auto sólo enruta instrumentos cuyo manifest instalable está registrado", () => {
  assert.equal(preferredNativeModuleForInstrument("guitar.acoustic"), "discord-martin-hd28")
  assert.equal(preferredNativeModuleForInstrument("woodwinds.bass-clarinet"), null)
  assert.equal(preferredNativeModuleForInstrument("brass.bass-trombone"), null)
  assert.equal(preferredNativeModuleForInstrument("keys.celesta"), null)
})
