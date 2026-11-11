import test from "node:test"
import assert from "node:assert/strict"
import express from "express"
import { registerGutenbergRoutes } from "../server/gutenberg-routes"
import { insertBookSchema } from "../shared/schema"

test("Gutenberg HTTP: catálogo, muestras, importación y conflictos", async t => {
  const rows: any[] = [
    { id: 10, gutenbergId: 100001, status: "published", title: "Public", content: "Manuscrito de Tloque", chapters: [{ title: "Uno", content: "Texto de Tloque" }] },
    { id: 11, gutenbergId: 100002, status: "draft", title: "Private" },
  ]
  let writes = 0, sourceCalls = 0, race = false, sourceDown = false
  let now = Date.now()
  t.mock.method(Date, "now", () => now)
  const tail = "FIN DEL CAPÍTULO COMPLETO"
  const rawText = "PRÓLOGO\nUna página inicial.\n\nCAPÍTULO I\n" + "Un principio. ".repeat(400) + tail + "\n\nCAPÍTULO II\nUn final."
  const sourceAuthor = { name: "Verne, Jules", birth_year: 1828, death_year: 1905 }
  const sourceBook = (id: number) => ({
    id, title: "Edición " + id, languages: ["es"],
    authors: [id === 100005 ? { name: "Autora de nombre compuesto ".repeat(9), birth_year: null, death_year: null } : sourceAuthor],
    formats: { "text/plain": `https://www.gutenberg.org/files/${id}/${id}.txt` }, subjects: [], download_count: 50, copyright: false,
  })
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = { admin: req.get("x-fixture-admin") === "yes" } as any; next() })
  registerGutenbergRoutes(app, {
    isAdmin: (user: any) => !!user?.admin,
    requireAdmin: (req, res, next) => (req.user as any)?.admin ? next() : res.status(403).json({ message: "Forbidden" }),
    rateLimit: () => (_req, _res, next) => next(),
    storage: {
      getGutenbergReferences: async ids => rows.filter(row => ids.includes(row.gutenbergId)),
      findBookByGutenbergId: async id => rows.find(row => row.gutenbergId === id),
      createBook: async input => {
        writes++
        if (race) {
          rows.push({ id: 13, gutenbergId: input.gutenbergId, status: "draft" })
          throw Object.assign(new Error("Query failed"), { cause: { code: "23505", constraint: "books_gutenberg_id_unique_idx" } })
        }
        const book = { ...input, id: 12 }; rows.push(book); return book as any
      },
    },
  })
  const server = app.listen(0, "127.0.0.1")
  await new Promise<void>(resolve => server.once("listening", resolve))
  const address = server.address() as { port: number }
  const base = `http://127.0.0.1:${address.port}`
  const localFetch = globalThis.fetch
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    sourceCalls++
    if (sourceDown) return new Response("Down", { status: 503 })
    const url = new URL(String(input))
    if (url.hostname === "www.gutenberg.org") return new Response(rawText)
    if (url.searchParams.get("search") === "unavailable") return new Response("Down", { status: 503 })
    const id = url.pathname.match(/\/books\/(\d+)/)?.[1]
    if (id) return Response.json(sourceBook(Number(id)))
    return Response.json({ count: 3, next: null, results: [100001, 100002, 100003].map(sourceBook) })
  })
  const request = (path: string, admin = false, body?: unknown) => localFetch(base + path, {
    headers: { ...(admin ? { "x-fixture-admin": "yes" } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
  })
  try {
    let res = await request("/api/gutenberg/catalog")
    assert.equal(res.status, 200)
    const publicPage = await res.json()
    assert.equal(publicPage.results[0].existingBookId, 10)
    assert.equal(publicPage.results[1].existingBookId, null)
    assert.equal(publicPage.results[1].existingStatus, undefined)
    assert.equal(res.headers.get("cache-control"), "private, no-store")
    res = await request("/api/gutenberg/catalog", true)
    assert.equal((await res.json()).results[1].existingStatus, "draft")
    res = await request("/api/gutenberg/catalog?includeUnpublished=false", true)
    assert.equal((await res.json()).results[1].existingBookId, null)
    now += 120_001; sourceDown = true
    rows[0].status = "draft"
    res = await request("/api/gutenberg/catalog")
    const recoveredPage = await res.json()
    assert.equal(res.status, 200)
    assert.equal(recoveredPage.cacheStatus, "stale")
    assert.equal(recoveredPage.results[0].existingBookId, null, "cached catalogue still checks current publication status")
    assert.equal(recoveredPage.results[1].existingStatus, undefined, "admin status never leaks through stale results")
    assert.equal(res.headers.get("cache-control"), "private, no-store")
    rows[0].status = "published"; sourceDown = false
    await t.test("la ficha de una edición publicada remite a Tloque sin devolver su manuscrito", async () => {
      const response = await request("/api/gutenberg/preview/100001")
      const body = await response.json()
      assert.equal(response.status, 200)
      assert.equal(body.existingBookId, 10)
      assert.ok(!JSON.stringify(body).includes("Texto de Tloque"))
      assert.ok(!JSON.stringify(body).includes("Manuscrito de Tloque"))
    })
    await t.test("una edición retenida no se vuelve a servir desde Gutenberg", async () => {
      rows[0].status = "review"; rows[0].rightsHold = true
      const before = sourceCalls
      try {
        assert.equal((await request("/api/gutenberg/preview/100001")).status, 404)
        assert.equal(sourceCalls, before, "no consulta la fuente para eludir la retención")
        const publicCatalogue = await (await request("/api/gutenberg/catalog")).json()
        assert.ok(publicCatalogue.results.every((result: { id: number }) => result.id !== 100001))
        const adminCatalogue = await (await request("/api/gutenberg/catalog", true)).json()
        assert.equal(adminCatalogue.results[0].existingStatus, "review")
      } finally { rows[0].status = "published"; rows[0].rightsHold = false }
    })
    const callsBeforeBad = sourceCalls
    assert.equal((await request("/api/gutenberg/catalog?page=-1")).status, 400)
    assert.equal((await request("/api/gutenberg/catalog?topic=invalid")).status, 400)
    assert.equal((await request("/api/gutenberg/preview/NaN")).status, 400)
    assert.equal(sourceCalls, callsBeforeBad)
    res = await request("/api/gutenberg/catalog?q=unavailable")
    assert.equal(res.status, 503)
    assert.equal((await res.json()).code, "GUTENBERG_UNAVAILABLE")
    assert.equal(res.headers.get("retry-after"), "10")
    res = await request("/api/gutenberg/preview/100003")
    assert.equal(res.status, 200)
    const preview = await res.json()
    assert.equal(preview.chapterCount, 3)
    assert.equal(preview.chapters[2].content, "Un final.")
    await t.test("una muestra extensa queda limitada en la respuesta HTTP", () => {
      assert.equal(preview.chapters[1].content.length, 4_000)
      assert.ok(!JSON.stringify(preview).includes(tail))
    })
    assert.equal((await request("/api/admin/gutenberg/import", false, { gutenbergId: 100003 })).status, 403)
    assert.equal(writes, 0)
    assert.equal((await request("/api/admin/gutenberg/import", true, { gutenbergId: 100003, chapters: [] })).status, 400)
    const beforeRejected = sourceCalls
    assert.equal((await request("/api/admin/gutenberg/import", true, { gutenbergId: 100003, status: "published" })).status, 428)
    assert.equal(sourceCalls, beforeRejected, "no source work or publication before reviewing the edition")
    assert.equal(writes, 0)
    const callsBeforeImport = sourceCalls
    res = await request("/api/admin/gutenberg/import", true, { gutenbergId: 100003, overrideTitle: "Curated" })
    assert.equal(res.status, 201)
    const imported = await res.json()
    assert.equal(imported.book.status, "draft")
    assert.equal(imported.book.title, "Curated")
    assert.equal(imported.book.author, "Jules Verne")
    assert.deepEqual(preview.authors, [sourceAuthor])
    assert.deepEqual(imported.book.sourceMetadata.authors, [sourceAuthor])
    assert.deepEqual(imported.book.chapters.map((chapter: { title: string }) => chapter.title), preview.chapters.map((chapter: { title: string }) => chapter.title))
    assert.ok(imported.book.chapters[1].content.endsWith(tail), "el borrador conserva el capítulo completo")
    assert.equal(sourceCalls, callsBeforeImport, "preview text reused for import")
    assert.equal((await request("/api/admin/gutenberg/import", true, { gutenbergId: 100003 })).status, 409)
    assert.equal((await request("/api/admin/gutenberg/import", true, { gutenbergId: 100002 })).status, 409)
    assert.equal(writes, 1)
    res = await request("/api/gutenberg/preview/100005")
    assert.ok((await res.json()).author.length > 160, "preview preserves source attribution")
    res = await request("/api/admin/gutenberg/import", true, { gutenbergId: 100005, status: "draft" })
    assert.equal(res.status, 201)
    const longAuthor = (await res.json()).book
    assert.equal(longAuthor.author.length, 160)
    assert.equal(insertBookSchema.safeParse(longAuthor).success, true, "import remains editable under the manuscript schema")
    race = true
    res = await request("/api/admin/gutenberg/import", true, { gutenbergId: 100004 })
    assert.equal(res.status, 409)
    assert.deepEqual(await res.json(), { message: "Este libro ya está importado", existingBookId: 13, existingStatus: "draft" })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
