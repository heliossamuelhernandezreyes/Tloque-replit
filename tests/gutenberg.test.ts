import test from "node:test"
import assert from "node:assert/strict"
import {
  detectChapters,
  detectPublicationYear,
  downloadBookText,
  normalizeGutenbergLanguage,
  searchGutenberg,
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

function searchBook(id: number, language: string, formats: Record<string, string> = {
  "text/plain; charset=utf-8": `https://www.gutenberg.org/files/${id}/${id}-0.txt`,
}): GutenbergBook {
  return {
    ...stubBook(formats["text/plain; charset=utf-8"] || "https://www.gutenberg.org/files/1/1.txt"),
    id,
    title: `Libro ${id}`,
    languages: [language],
    formats,
  }
}

test("Gutenberg conserva solo ediciones del idioma pedido y exige texto plano", async () => {
  const originalFetch = globalThis.fetch
  const requested: URL[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    requested.push(new URL(String(input)))
    return Response.json({ results: [
      searchBook(1, "es"),
      searchBook(2, "en"),
      searchBook(3, "es", { "application/epub+zip": "https://www.gutenberg.org/ebooks/3.epub3.images" }),
      searchBook(4, "xx"),
    ] })
  }) as typeof fetch
  try {
    const books = await searchGutenberg("Quijote", "es-MX")
    assert.deepEqual(books.map(book => book.id), [1])
    assert.equal(books[0].languageMatch, "exact")
    assert.equal(books[0].requestedLanguage, "es")
    assert.equal(requested[0].searchParams.get("languages"), "es")
    assert.equal(requested[0].searchParams.get("mime_type"), "text/")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Gutenberg identifica alternativas sin mezclarlas con coincidencias exactas", async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return Response.json({ results: calls === 1 ? [] : [searchBook(7, "en")] })
  }) as typeof fetch
  try {
    const books = await searchGutenberg("Hamlet", "pt-BR")
    assert.equal(calls, 2)
    assert.equal(books[0].languageMatch, "alternative")
    assert.equal(books[0].requestedLanguage, "pt")
    assert.equal(normalizeGutenbergLanguage("xx"), "es")
  } finally {
    globalThis.fetch = originalFetch
  }
})

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

test("detecta capítulos en escrituras no latinas", () => {
  const body = "نص طويل من الرواية. ".repeat(30)
  const chapters = detectChapters(`الفصل الأول\n${body}\nالفصل الثاني\n${body}`)
  assert.equal(chapters.length, 2)
  assert.deepEqual(chapters.map(chapter => chapter.title), ["الفصل الأول", "الفصل الثاني"])
})

test("no inventa el año de publicación a partir de la vida del autor", () => {
  const book = stubBook("https://www.gutenberg.org/files/1/1.txt")
  book.authors = [{ name: "Autora, Prueba", birth_year: 1800, death_year: 1880 }]
  assert.equal(detectPublicationYear(book), null)
  book.subjects = ["Fiction -- 1872"]
  assert.equal(detectPublicationYear(book), 1872)
})
