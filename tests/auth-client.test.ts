import test from "node:test"
import assert from "node:assert/strict"
import { fetchCurrentUser } from "../client/src/lib/authClient"

test("sesión ausente y sesión válida se distinguen", async () => {
  const noSession = await fetchCurrentUser(100, async () =>
    new Response("null", { status: 200, headers: { "Content-Type": "application/json" } }),
  )
  assert.equal(noSession, null)

  const user = await fetchCurrentUser(100, async () =>
    Response.json({ id: 7, email: "reader@example.test", name: "Lector" }),
  )
  assert.equal(user?.id, 7)
})

test("un fallo del servidor no se convierte en cierre de sesión", async () => {
  await assert.rejects(
    () => fetchCurrentUser(100, async () => new Response("error", { status: 503 })),
    /503/,
  )
})

test("la verificación de sesión tiene tiempo límite", async () => {
  const hangingFetch: typeof fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
    })) as typeof fetch

  await assert.rejects(
    () => fetchCurrentUser(10, hangingFetch),
    /tardó demasiado/,
  )
})
