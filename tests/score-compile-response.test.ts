import assert from "node:assert/strict"
import test from "node:test"
import { readTloqueScoreCompileResponse } from "../client/src/lib/tloqueScoreApi"

test("returns the compiled recipe from a successful response", async () => {
  const recipe = { version: 2, language: "tloque-score" }
  const response = new Response(JSON.stringify({ ok: true, diagnostics: [], recipe }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })

  assert.deepEqual(await readTloqueScoreCompileResponse(response), recipe)
})

test("shows the server message and HTTP status instead of masking it", async () => {
  const response = new Response(JSON.stringify({ message: "API route not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  })

  await assert.rejects(readTloqueScoreCompileResponse(response), {
    message: "HTTP 404 · API route not found",
  })
})

test("formats compiler diagnostics only when the array exists", async () => {
  const response = new Response(JSON.stringify({
    ok: false,
    diagnostics: [{ line: 13, message: "Comando desconocido" }, { message: "Falta end" }],
  }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  })

  await assert.rejects(readTloqueScoreCompileResponse(response), {
    message: "HTTP 400\nL13: Comando desconocido\nFalta end",
  })
})

test("preserves a short non-JSON server response", async () => {
  const response = new Response("Bad gateway", { status: 502 })

  await assert.rejects(readTloqueScoreCompileResponse(response), {
    message: "HTTP 502 · Bad gateway",
  })
})

test("reports an empty response without throwing a secondary TypeError", async () => {
  const response = new Response(null, { status: 401 })

  await assert.rejects(readTloqueScoreCompileResponse(response), {
    message: "HTTP 401 · El servidor no devolvió detalles del error",
  })
})
