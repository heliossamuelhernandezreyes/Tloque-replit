import assert from "node:assert/strict"
import test from "node:test"
import type { Client } from "@replit/object-storage"
import { createLazyAudioStorage } from "../server/audioStorage"

test("Object Storage no se inicializa durante el arranque de Tloque", () => {
  let initializations = 0
  const fakeClient = {} as Client
  const storage = createLazyAudioStorage(() => {
    initializations++
    return fakeClient
  })

  assert.equal(initializations, 0)
  assert.equal(storage.get(), fakeClient)
  assert.equal(storage.get(), fakeClient)
  assert.equal(initializations, 1)
})

test("un cliente fallido se descarta para permitir conectar un bucket después", () => {
  const clients = [{ id: 1 }, { id: 2 }] as unknown as Client[]
  let next = 0
  const storage = createLazyAudioStorage(() => clients[next++])

  const failed = storage.get()
  storage.reset(failed)
  assert.equal(storage.get(), clients[1])
  assert.equal(next, 2)
})
