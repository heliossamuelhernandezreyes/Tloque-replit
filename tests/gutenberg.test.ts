import test from "node:test"
import assert from "node:assert/strict"
import {
  detectChapters,
  detectPublicationYear,
  downloadBookText,
  normalizeGutenbergLanguage,
  searchGutenberg,
  browseGutenberg,
  cleanGutenbergText,
  countGutenbergWords,
  fetchGutenbergBookById,
  processGutenbergBook,
  isGutenbergAssetUrl,
  fitGutenbergChapters,
  type GutenbergBook,
} from "../server/gutenberg"
import { GutenbergCache } from "../server/gutenberg-cache"
import { gutenbergIdFromQuery } from "../shared/gutenberg"

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
    return Response.json({ count: 4, next: null, results: [
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
    assert.equal(requested[0].searchParams.get("mime_type"), "text/plain")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Gutenberg identifica alternativas sin mezclarlas con coincidencias exactas", async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return Response.json({ count: calls === 1 ? 0 : 1, next: null, results: calls === 1 ? [] : [searchBook(7, "en")] })
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
  assert.equal(detectPublicationYear(book), null, "subject years are not publication dates")
})

test("catálogo paginado: conserva idioma, tema y orden sin seguir enlaces externos", async t => {
  const requested: URL[] = []
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input); requested.push(url)
    return Response.json({ count: 65, next: "https://127.0.0.1/private?page=3", results: [searchBook(201, "es")] })
  })
  const page = await browseGutenberg({ query: "Verne paginado", lang: "es-MX", topic: "adventure", sort: "descending", page: 2 })
  assert.equal(page.count, 65)
  assert.equal(page.previousPage, 1)
  assert.equal(page.nextPage, null)
  assert.equal(page.results.length, 1)
  assert.equal(requested.length, 1)
  assert.deepEqual(Object.fromEntries(requested[0].searchParams), {
    search: "Verne paginado", languages: "es", topic: "adventure", mime_type: "text/plain", copyright: "false", sort: "descending", page: "2",
  })
})

test("catálogo explorable muestra las 32 ediciones y conserva la continuación", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ count: 70, next: "https://gutendex.com/books/?page=2", results: Array.from({ length: 32 }, (_, i) => searchBook(300 + i, "fr")) }))
  const page = await browseGutenberg({ lang: "fr" })
  assert.equal(page.results.length, 32)
  assert.equal(page.nextPage, 2)
  assert.equal(page.query, "")
})

test("idioma sin resultados no dispara búsquedas en otro idioma", async t => {
  let calls = 0
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ count: 0, next: null, results: [] }) })
  const page = await browseGutenberg({ query: "edición inexistente", lang: "nl" })
  assert.equal(page.results.length, 0)
  assert.equal(calls, 1)
})

test("una falla de la fuente es recuperable y nunca se guarda como resultado vacío", async t => {
  let calls = 0
  t.mock.method(globalThis, "fetch", async () => {
    calls++
    return calls === 1 ? new Response("unavailable", { status: 503 }) : Response.json({ count: 1, next: null, results: [searchBook(401, "de")] })
  })
  await assert.rejects(browseGutenberg({ query: "retry", lang: "de" }), /503/)
  assert.equal((await browseGutenberg({ query: "retry", lang: "de" })).results[0].id, 401)
  assert.equal(calls, 2)
})

test("metadatos anidados inválidos se rechazan antes de llegar al lector", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ count: 1, next: null, results: [{ ...searchBook(501, "es"), authors: [null] }] }))
  await assert.rejects(browseGutenberg({ query: "malformed" }), /metadatos inválidos/)
})

test("buscar por ID o enlace oficial conserva el idioma y la identidad de la edición", async t => {
  let calls = 0
  t.mock.method(globalThis, "fetch", async (input: string) => {
    calls++; assert.equal(String(input), "https://gutendex.com/books/601/")
    return Response.json(searchBook(601, "en"))
  })
  assert.equal((await browseGutenberg({ query: "https://www.gutenberg.org/ebooks/601", lang: "es" })).results.length, 0)
  assert.equal((await browseGutenberg({ query: "#601", lang: "all" })).results[0].id, 601)
  assert.equal(calls, 1)
  assert.equal(gutenbergIdFromQuery("https://gutenberg.org.evil.test/ebooks/601"), null)
  assert.equal(gutenbergIdFromQuery("https://user@gutenberg.org/ebooks/601"), null)
  assert.equal(gutenbergIdFromQuery("#0"), null)
})

test("solo ediciones con estado de copyright falso y archivo permitido entran al catálogo", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ count: 4, next: null, results: [
    searchBook(701, "es"), { ...searchBook(702, "es"), copyright: true }, { ...searchBook(703, "es"), copyright: null },
    searchBook(704, "es", { "text/plain": "https://127.0.0.1/secret" }),
  ] }))
  assert.deepEqual((await browseGutenberg({ query: "availability" })).results.map(book => book.id), [701])
})

test("no acepta puertos, credenciales, subdominios ni rutas de proxy como fuentes de texto", () => {
  for (const url of ["http://www.gutenberg.org/files/1/1.txt", "https://x:www@gutenberg.org/files/1/1.txt",
    "https://www.gutenberg.org:3000/files/1/1.txt", "https://proxy.gutenberg.org/files/1/1.txt", "https://www.gutenberg.org/redirect?url=internal"]) {
    assert.equal(isGutenbergAssetUrl(url), false, url)
  }
})

test("limpia los marcadores después del preámbulo sin perder prólogo, notas o ilustraciones", () => {
  const body = "PRÓLOGO\nA la memoria del lector.\n\n[Ilustración: El puerto]\n\n[Nota del transcriptor: Una nota.]\n"
  const clean = cleanGutenbergText("\uFEFFThe Project Gutenberg eBook\r\nTitle: Prueba\r\n\r\n*** START OF THE PROJECT GUTENBERG EBOOK PRUEBA ***\r\n" + body + "\n*** END OF THE PROJECT GUTENBERG EBOOK PRUEBA ***\nLicence footer")
  assert.equal(clean, body.trim())
  assert.equal(cleanGutenbergText("Una novela\ncon una línea\ny otra\n"), "Una novela\ncon una línea\ny otra")
})

test("la división conserva páginas iniciales y capítulos de una sola frase", () => {
  const chapters = detectChapters("DEDICATORIA\nPara quien lee.\n\nCAPÍTULO I\nUna frase.\n\nCAPÍTULO II\nOtra frase.\n\nCAPÍTULO III\nFin.")
  assert.equal(chapters.length, 4)
  assert.match(chapters[0].content, /Para quien lee/)
  assert.deepEqual(chapters.slice(1).map(chapter => chapter.content), ["Una frase.", "Otra frase.", "Fin."])
})

test("los encabezados vacíos consecutivos no eliminan texto ni títulos", () => {
  const chapters = detectChapters("PART I\n\nCHAPTER I\nBreve.\n\nCHAPTER II\nFin.", "en")
  assert.match(chapters[0].title, /PART I.*CHAPTER I/)
  assert.equal(chapters[0].content, "Breve.")
  assert.equal(chapters[1].content, "Fin.")
})

test("el tiempo estimado no trata un párrafo chino como una única palabra", () => {
  assert.equal(countGutenbergWords("Hello world"), 2)
  assert.ok(countGutenbergWords("这是一本书") >= 5)
})

test("reconoce números escritos y conserva secciones grandes dentro del contrato del editor", () => {
  assert.equal(detectChapters("CAPITULO PRIMERO\nInicio.\n\nCAPITULO SEGUNDO\nFin.").length, 2)
  const original = "A".repeat(1_899_999) + "😀" + "B".repeat(110_000)
  const fitted = fitGutenbergChapters([{ title: "Libro", content: original }])
  assert.equal(fitted.length, 2)
  assert.equal(fitted.map(chapter => chapter.content).join(""), original)
  assert.ok(fitted.every(chapter => chapter.title.length <= 200 && chapter.content.length <= 2_000_000))
  assert.ok(!/[\uD800-\uDBFF]$/.test(fitted[0].content))
  const longTitle = "CAPÍTULO I · ".repeat(30)
  assert.ok(fitGutenbergChapters([{ title: longTitle, content: "Último texto." }])[0].content.startsWith(longTitle))
  const validTitle = "X".repeat(199)
  assert.equal(fitGutenbergChapters([{ title: validTitle, content: "Breve." }])[0].title, validTitle)
  assert.ok(fitGutenbergChapters([{ title: validTitle, content: original }])[0].content.startsWith(validTitle))
})

test("preview e importación comparten la descarga y la portada de la edición exacta", async t => {
  let calls = 0
  t.mock.method(globalThis, "fetch", async (input: string) => {
    calls++; assert.equal(String(input), "https://www.gutenberg.org/files/801/801-0.txt")
    return new Response("*** START OF THE PROJECT GUTENBERG EBOOK TEST ***\n\nPRÓLOGO\nUn comienzo.\n\nCAPÍTULO I\nTexto breve.\n\nCAPÍTULO II\nTexto final.\n\n*** END OF THE PROJECT GUTENBERG EBOOK TEST ***")
  })
  const book = { ...searchBook(801, "es"), summaries: ["Resumen original de esta edición."], formats: {
    "text/plain": "https://www.gutenberg.org/files/801/801-0.txt", "image/jpeg": "https://www.gutenberg.org/cache/epub/801/pg801.cover.medium.jpg",
  } }
  const [first, second] = await Promise.all([processGutenbergBook(book, "es"), processGutenbergBook(book, "en")])
  assert.deepEqual(first, second)
  assert.equal(calls, 1)
  assert.equal(first.synopsis, book.summaries[0])
  assert.equal(first.synopsisSource, "gutendex")
  assert.equal(first.coverUrl, book.formats["image/jpeg"])
  assert.equal(first.chapters.length, 3)
})

test("descarta respuestas HTML y cancela archivos cuyo tamaño supera el límite", async t => {
  let cancelled = false
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { "content-length": "12000001" } }))
  await assert.rejects(downloadBookText(searchBook(901, "en")), /tamaño permitido/)
  assert.equal(cancelled, true)
  t.mock.method(globalThis, "fetch", async () => new Response("<!doctype html><html>Error</html>"))
  await assert.rejects(processGutenbergBook(searchBook(902, "en")), /página web/)
})

test("el plazo de descarga también cancela un cuerpo que nunca termina", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let cancelled = false
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ cancel() { cancelled = true } })))
  const download = downloadBookText(searchBook(903, "en"))
  await Promise.resolve(); await Promise.resolve()
  t.mock.timers.tick(20_000)
  await assert.rejects(download, /tardó demasiado/)
  assert.equal(cancelled, true)
})

test("metadatos por ID verifican la identidad devuelta por el servidor", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json(searchBook(905, "es")))
  await assert.rejects(fetchGutenbergBookById(904), /metadatos inválidos/)
})

test("la caché limita concurrencia, comparte trabajos y elimina las entradas menos usadas", async () => {
  const cache = new GutenbergCache<number>({ entries: 2, bytes: 100, pending: 1, ttl: 10_000 })
  let finish!: (value: number) => void
  let loads = 0
  const load = () => { loads++; return new Promise<number>(resolve => { finish = resolve }) }
  const first = cache.get("a", load), second = cache.get("a", load)
  await Promise.resolve()
  await assert.rejects(cache.get("busy", async () => 9), /ocupado/)
  finish(1)
  assert.deepEqual(await Promise.all([first, second]), [1, 1]); assert.equal(loads, 1)
  await cache.get("b", async () => 2)
  assert.equal(await cache.get("a", async () => 9), 1)
  await cache.get("c", async () => 3)
  assert.equal(await cache.get("b", async () => 4), 4)
})

test("la caché expira y nunca retiene errores ni valores que exceden su presupuesto", async t => {
  let time = 0
  t.mock.method(Date, "now", () => time)
  const cache = new GutenbergCache<string>({ entries: 2, bytes: 20, pending: 1, ttl: 10 })
  await cache.get("a", async () => "old")
  time = 11
  assert.equal(await cache.get("a", async () => "new"), "new")
  await assert.rejects(cache.get("bad", async () => { throw Error("failure") }))
  assert.equal(await cache.get("bad", async () => "good"), "good")
  await cache.get("big", async () => "x".repeat(50))
  assert.equal(await cache.get("big", async () => "small"), "small")
})

test("los enlaces oficiales de descarga resuelven la misma edición, sin admitir proxies", () => {
  for (const link of [
    "https://www.gutenberg.org/ebooks/2000.txt.utf-8",
    "https://www.gutenberg.org/ebooks/2000.txt.utf-8?download=1#top",
    "https://www.gutenberg.org/cache/epub/2000/pg2000.txt",
    "https://www.gutenberg.org/files/2000/2000-8.txt",
  ]) assert.equal(gutenbergIdFromQuery(link), 2000, link)
  for (const link of [
    "https://www.gutenberg.org/ebooks/2000.txt.evil",
    "https://www.gutenberg.org/cache/epub/2000/pg2001.txt",
    "https://www.gutenberg.org/files/2000/2001.txt",
    "https://user@gutenberg.org/ebooks/2000.txt.utf-8",
  ]) assert.equal(gutenbergIdFromQuery(link), null, link)
})

test("el catálogo admite enlaces modernos de texto y descarga su archivo canónico sin redirecciones", async t => {
  const book = searchBook(8101, "es", { "text/plain; charset=utf-8": "https://www.gutenberg.org/ebooks/8101.txt.utf-8" })
  const calls: string[] = []
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    calls.push(String(input))
    if (String(input).includes("gutendex.com")) return Response.json({ count: 1, next: null, results: [book] })
    assert.equal(String(input), "https://www.gutenberg.org/cache/epub/8101/pg8101.txt")
    assert.equal(init?.redirect, "error")
    return new Response("Una edición íntegra.")
  })
  const page = await browseGutenberg({ query: "modern text links" })
  assert.equal(page.results.length, 1)
  assert.equal(await downloadBookText(page.results[0]), "Una edición íntegra.")
  assert.equal(calls.length, 2)
})

test("si un archivo desaparece, prueba otra fuente de texto permitida de la misma ficha", async t => {
  const calls: string[] = []
  t.mock.method(globalThis, "fetch", async (input: string) => {
    calls.push(String(input))
    return calls.length === 1 ? new Response(null, { status: 404 }) : new Response("Texto recuperado.")
  })
  const book = searchBook(8102, "es", {
    "text/plain; charset=utf-8": "https://www.gutenberg.org/files/8102/8102-0.txt",
    "text/plain": "https://www.gutenberg.org/cache/epub/8102/pg8102.txt",
    "text/plain; charset=ascii": "https://127.0.0.1/secret",
  })
  assert.equal(await downloadBookText(book), "Texto recuperado.")
  assert.deepEqual(calls, [book.formats["text/plain; charset=utf-8"], book.formats["text/plain"]])
})

test("un byte dañado no convierte todo un texto UTF-8 en caracteres corruptos", async t => {
  const bytes = new Uint8Array([...new TextEncoder().encode("Capítulo: corazón, 日本語. "), 0xff, ...new TextEncoder().encode(" Más texto.")])
  t.mock.method(globalThis, "fetch", async () => new Response(bytes))
  assert.equal(await downloadBookText(searchBook(8103, "es")), "Capítulo: corazón, 日本語. � Más texto.")
  assert.equal(await downloadBookText(stubBook("https://www.gutenberg.org/files/8103/8103.txt")), "Capítulo: corazón, 日本語. � Más texto.")
})

test("respeta una codificación Windows-1252 declarada y rechaza MIME de texto falsos", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([0x93, 0xe1, 0x94])))
  assert.equal(await downloadBookText(searchBook(8104, "es", { "text/plain; charset=windows-1252": "https://www.gutenberg.org/files/8104/8104.txt" })), "“á”")
  await assert.rejects(downloadBookText(searchBook(8105, "es", { "text/plain-malicious": "https://www.gutenberg.org/files/8105/8105.txt" })))
})

test("detecta capítulos CJK tradicionales con dígitos de ancho completo sin cambiar el texto", () => {
  const chapters = detectChapters("第１章\n日本語の本文。\n\n第２節\n最後の本文。", "ja")
  assert.deepEqual(chapters.map(chapter => chapter.title), ["第１章", "第２節"])
  assert.deepEqual(chapters.map(chapter => chapter.content), ["日本語の本文。", "最後の本文。"])
})

test("el catálogo recupera solo la misma consulta guardada e informa su antigüedad", async t => {
  let now = 1_000_000, failing = false, calls = 0
  t.mock.method(Date, "now", () => now)
  t.mock.method(globalThis, "fetch", async () => {
    calls++
    return failing ? new Response(null, { status: 503 }) : Response.json({ count: 1, next: null, results: [searchBook(8110, "es")] })
  })
  const options = { query: "cached outage", lang: "es" }
  const fresh = await browseGutenberg(options)
  assert.equal(fresh.cacheStatus, "fresh")
  assert.equal(fresh.fetchedAt, now)
  now += 120_001; failing = true
  const stale = await browseGutenberg(options)
  assert.equal(stale.cacheStatus, "stale")
  assert.equal(stale.fetchedAt, fresh.fetchedAt)
  assert.equal(stale.results[0].id, 8110)
  await assert.rejects(browseGutenberg({ ...options, lang: "fr" }), /503/)
  failing = false
  const refreshed = await browseGutenberg(options)
  assert.equal(refreshed.cacheStatus, "fresh")
  assert.equal(refreshed.fetchedAt, now)
  now += 1_920_001; failing = true
  await assert.rejects(browseGutenberg(options), /503/)
  assert.equal(calls, 5)
})

test("la recuperación no amplía la caducidad ni el presupuesto de la caché", async t => {
  let now = 0
  t.mock.method(Date, "now", () => now)
  const cache = new GutenbergCache<string>({ entries: 2, bytes: 20, pending: 1, ttl: 10, staleTtl: 20 })
  const unavailable = async (): Promise<string> => { throw Error("offline") }
  await cache.get("a", async () => "12345") // 14 bytes, including JSON quotes.
  now = 11
  assert.equal((await cache.getWithStatus("a", unavailable, () => true)).stale, true)
  now = 29
  assert.equal((await cache.getWithStatus("a", unavailable, () => true)).fetchedAt, 0)
  now = 30
  await assert.rejects(cache.getWithStatus("a", unavailable, () => true), /offline/)
  await cache.get("a", async () => "12345")
  now = 41
  await cache.get("b", async () => "67890") // The stale entry must also count toward 20 bytes.
  await assert.rejects(cache.getWithStatus("a", unavailable, () => true), /offline/)
})

test("compartir una descarga no impone la recuperación a quien requiere datos frescos", async t => {
  let now = 0
  t.mock.method(Date, "now", () => now)
  const cache = new GutenbergCache<string>({ entries: 2, bytes: 100, pending: 1, ttl: 10, staleTtl: 20 })
  await cache.get("a", async () => "saved")
  now = 11
  let reject!: (error: Error) => void
  const recoverable = cache.getWithStatus("a", () => new Promise<string>((_resolve, fail) => { reject = fail }), () => true)
  const strict = assert.rejects(cache.get("a", async () => "unused"), /offline/)
  await Promise.resolve()
  reject(new Error("offline"))
  assert.equal((await recoverable).stale, true)
  await strict
})
