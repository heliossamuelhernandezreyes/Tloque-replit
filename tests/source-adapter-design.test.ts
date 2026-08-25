import test from "node:test"
import assert from "node:assert/strict"
import { preferredNativeModuleForInstrument } from "../client/src/audio/NativeAutoModule"

test("native-auto enruta instrumentos cuyo manifest instalable está registrado", () => {
  assert.equal(preferredNativeModuleForInstrument("guitar.acoustic"), "discord-martin-hd28")
  assert.equal(preferredNativeModuleForInstrument("woodwinds.bass-clarinet"), "iowa-mis-bass-clarinet-ff")
  assert.equal(preferredNativeModuleForInstrument("brass.bass-trombone"), "iowa-mis-bass-trombone-ff")
  assert.equal(preferredNativeModuleForInstrument("keys.celesta"), "sampled-celesta-tuned-denoised-mix")
})
