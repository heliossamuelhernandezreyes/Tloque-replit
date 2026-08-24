import test from "node:test"
import assert from "node:assert/strict"
import { preferredNativeModuleForInstrument } from "../client/src/audio/NativeAutoModule"

test("native-auto dirige guitar.acoustic al Martin HD28 verificado", () => {
  assert.equal(preferredNativeModuleForInstrument("guitar.acoustic"), "discord-martin-hd28")
})

test("un timbre nylon no se activa antes de tener un pack instalable", () => {
  assert.equal(preferredNativeModuleForInstrument("guitar.acoustic-nylon"), null)
})
