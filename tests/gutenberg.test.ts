import test from "node:test"
import assert from "node:assert/strict"
import {
  detectChapters,
  detectPublicationYear,
  downloadBookText,
  type GutenbergBook,
} from "../server/gutenberg"

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

test("decodifica Gutenberg antiguo como Windows-1252 cuando UTF-8 es inválido", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(
    new Uint8Array([0x93, 0x48, 0x69, 0x94]),
    { status: 200 },
  )) as typeof fetch
  try {
    assert.equal(
      await downloadBookText(stubBook("https://www.gutenberg.org/files/1/legacy.txt")),
      "“Hi”",
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("conserva encabezados repetidos que pertenecen a actos distintos", () => {
  const body = "Una escena extensa. ".repeat(20)
  const chapters = detectChapters(`ACT I\n${body}\nACT I\n${body}\nACT I\n${body}`)
  assert.equal(chapters.length, 3)
  assert.deepEqual(chapters.map(chapter => chapter.title), ["ACT I", "ACT I", "ACT I"])
})

test("no inventa el año de publicación a partir de la vida del autor", () => {
  const book = stubBook("https://www.gutenberg.org/files/1/1.txt")
  book.authors = [{ name: "Autora, Prueba", birth_year: 1800, death_year: 1880 }]
  assert.equal(detectPublicationYear(book), null)
  book.subjects = ["Fiction -- 1872"]
  assert.equal(detectPublicationYear(book), 1872)
})
