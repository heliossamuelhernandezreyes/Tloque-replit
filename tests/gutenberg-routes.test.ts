import test from "node:test"
import assert from "node:assert/strict"
import express from "express"
import { registerGutenbergRoutes } from "../server/gutenberg-routes"

test("Gutenberg HTTP: filtros, estados privados, preview completo, importación y conflictos", async t => {
  const rows: any[] = [
    { id: 10, gutenbergId: 100001, status: "published", title: "Public" },
    { id: 11, gutenbergId: 100002, status: "draft", title: "Private" },
  ]
  let writes = 0, sourceCalls = 0, race = false
  const rawText = "PRÓLOGO\nUna página inicial.\n\nCAPÍTULO I\nUn principio.\n\nCAPÍTULO II\nUn final."
  const sourceBook = (id: number) => ({
    id, title: "Edición " + id, languages: ["es"], authors: [{ name: "Autor", birth_year: null, death_year: null }],
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
      getGutenbergReferences: async (ids, admin) => rows.filter(row => ids.includes(row.gutenbergId) && (admin || row.status === "published")),
      getBook: async id => rows.find(row => row.id === id),
      findBookByGutenbergId: async id => rows.find(row => row.gutenbergId === id),
      createBook: async input => {
        writes++
        if (race) throw Object.assign(new Error("Query failed"), { cause: { code: "23505", constraint: "books_gutenberg_id_unique_idx" } })
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
    assert.equal((await request("/api/admin/gutenberg/import", false, { gutenbergId: 100003 })).status, 403)
    assert.equal(writes, 0)
    assert.equal((await request("/api/admin/gutenberg/import", true, { gutenbergId: 100003, chapters: [] })).status, 400)
    const callsBeforeImport = sourceCalls
    res = await request("/api/admin/gutenberg/import", true, { gutenbergId: 100003, status: "draft", overrideTitle: "Curated" })
    assert.equal(res.status, 201)
    const imported = await res.json()
    assert.equal(imported.book.status, "draft")
    assert.equal(imported.book.title, "Curated")
    assert.deepEqual(imported.book.chapters, preview.chapters)
    assert.equal(sourceCalls, callsBeforeImport, "preview text reused for import")
    assert.equal((await request("/api/admin/gutenberg/import", true, { gutenbergId: 100003 })).status, 409)
    assert.equal((await request("/api/admin/gutenberg/import", true, { gutenbergId: 100002 })).status, 409)
    assert.equal(writes, 1)
    race = true
    assert.equal((await request("/api/admin/gutenberg/import", true, { gutenbergId: 100004 })).status, 409)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
