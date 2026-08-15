import test from "node:test"
import assert from "node:assert/strict"
import { downloadBookText, type GutenbergBook } from "../server/gutenberg"

function stubBook(textUrl: string): GutenbergBook {
  return {
    id: 1,
    title: "Prueba",
    authors: [],
    languages: ["es"],
    formats: { "text/plain": textUrl },
    subjects: [],
    bookshelves: [],
    download_count: 0,
    copyright: false,
  }
}

test("el importador rechaza fuentes ajenas a Project Gutenberg antes de pedirlas", async () => {
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = (async () => {
    called = true
    throw new Error("no debe ejecutarse")
  }) as typeof fetch
  try {
    await assert.rejects(
      downloadBookText(stubBook("https://127.0.0.1/private.txt")),
      /no pertenece a Project Gutenberg/,
    )
    assert.equal(called, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("el importador no sigue redirecciones de una fuente permitida", async () => {
  const originalFetch = globalThis.fetch
  let redirect: RequestRedirect | undefined
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    redirect = init?.redirect
    return new Response("contenido", { status: 200 })
  }) as typeof fetch
  try {
    assert.equal(await downloadBookText(stubBook("https://www.gutenberg.org/files/1/1.txt")), "contenido")
    assert.equal(redirect, "error")
  } finally {
    globalThis.fetch = originalFetch
  }
})
