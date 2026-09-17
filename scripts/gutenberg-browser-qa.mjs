import { createRequire } from "node:module"
import { mkdir } from "node:fs/promises"
import assert from "node:assert/strict"
import { resolve } from "node:path"
import { createServer } from "vite"

// Run the real app against isolated fixtures; never contacts Replit, Gutenberg or a database.
const { chromium } = createRequire(import.meta.url)("playwright")
const output = resolve(".tloque_cache/gutenberg-qa")
await mkdir(output, { recursive: true })
const vite = await createServer({ server: { host: "127.0.0.1", port: 4183, strictPort: true }, logLevel: "error" })
await vite.listen()
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  ...(process.env.TLOQUE_QA_CHROME ? { executablePath: process.env.TLOQUE_QA_CHROME } : {}) })
const errors = [], requests = [], imports = []
const screenshot = (page, name) => page.screenshot({ path: output + "/" + name + ".png", animations: "disabled", timeout: 45_000 })
let failNext = false
const titles = { 2000: "Don Quijote de la Mancha", 2001: "Rimas y leyendas", 2002: "La vida es sueño", 2003: "Viaje al centro de la Tierra" }
const book = (id, language = "es") => ({ id, title: titles[id], authors: [{ name: id === 2000 ? "Cervantes Saavedra, Miguel de" : "Autor de prueba" }], languages: [language], formats: {}, subjects: ["Fiction"], download_count: 25000, copyright: false, coverUrl: "", alreadyImported: false, existingBookId: null })
const preview = id => ({ gutenbergId: id, title: titles[id], author: "Miguel de Cervantes Saavedra", synopsis: "Una edición para recorrer sus capítulos, descubrir sus primeras páginas y conservar una copia completa en la biblioteca.", synopsisSource: "gutendex", synopsisLanguage: null,
  coverUrl: "", originalLanguage: "es", languages: ["es"], translators: [], publicationYear: null,
  detectedGenre: "fantasia", wordCount: 380000, readingMinutes: 1653, chapterStrategy: "headings", type: "book", sourceUrl: "https://www.gutenberg.org/ebooks/" + id,
  chapterCount: 3, previewText: "Al lector.", chapters: [{ title: "Páginas iniciales", content: "Al lector. Una dedicatoria que debemos conservar." }, { title: "CAPÍTULO I", content: "En un lugar de la Mancha, de cuyo nombre no quiero acordarme." }, { title: "CAPÍTULO II", content: "Sancho escuchaba mientras se abría el camino ante ellos." }] })

async function setup({ mobile = false } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 })
  context.setDefaultTimeout(20_000)
  await context.addInitScript(() => {
    localStorage.setItem("novareads_onboarding_done", "1")
    sessionStorage.setItem("tloque_boot_seen_v1", "1")
    localStorage.setItem("tloque_settings_v2", JSON.stringify({ visualQuality: "essential", reduceMotion: true, orbSounds: false, musicEnabled: false, language: "es" }))
  })
  await context.route("**/*", async route => {
    const url = new URL(route.request().url())
    if (url.hostname !== "127.0.0.1") return route.abort()
    if (!url.pathname.startsWith("/api/")) return route.continue()
    let data = {}
    if (url.pathname === "/api/auth/me") data = { id: 99, email: "fixture@example.test", name: "Gutenberg QA", avatar: "", isAdmin: true, capabilities: { manageCatalog: true, manageFrames: true, manageAudioCatalog: true, manageFinance: true, manageAdmins: true, runDiagnostics: true }, persona: "admin" }
    else if (url.pathname === "/api/books") data = []
    else if (url.pathname === "/api/gutenberg/catalog") {
      requests.push(Object.fromEntries(url.searchParams))
      if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { message: "Gutenberg unavailable" } }) }
      const query = url.searchParams.get("q"), language = url.searchParams.get("lang"), page = Number(url.searchParams.get("page"))
      if (language === "fr") await new Promise(resolve => setTimeout(resolve, 350))
      const results = query === "vacío" && language !== "all" ? [] : page === 2 ? [book(2003, language)] : [book(2000, language), book(2001, language), book(2002, language)]
      data = { query, language, page, sort: url.searchParams.get("sort"), topic: url.searchParams.get("topic"), count: results.length ? 35 : 0,
        nextPage: page === 1 && results.length ? 2 : null, previousPage: page === 2 ? 1 : null, results }
    } else if (url.pathname.startsWith("/api/gutenberg/preview/")) {
      data = preview(Number(url.pathname.split("/").pop()))
    } else if (url.pathname === "/api/admin/gutenberg/import") {
      const input = route.request().postDataJSON(); imports.push(input)
      data = { book: { ...preview(input.gutenbergId), id: 50, status: input.status, title: input.overrideTitle } }
    } else if (url.pathname === "/api/books/50") data = { ...preview(2000), id: 50, status: "draft", revision: 1, isClassic: true }
    else if (url.pathname.includes("notifications")) data = { notifications: [], unread: 0 }
    else if (url.pathname === "/api/frames") data = { frames: [] }
    else if (url.pathname === "/api/sync/state") data = { library: [], progress: [], streak: null }
    return route.fulfill({ json: data })
  })
  const page = await context.newPage()
  page.on("pageerror", error => errors.push(error.message))
  return { context, page }
}
const open = async page => {
  await page.goto("http://127.0.0.1:4183/admin")
  await page.getByRole("button", { name: "Catálogo y Gutenberg" }).click()
  await page.getByRole("dialog", { name: "Explorar los clásicos" }).waitFor()
  await page.getByRole("button", { name: titles[2000], exact: true }).waitFor()
}

try {
  console.log("Gutenberg QA: desktop catalogue, filters and errors")
  const { context, page } = await setup()
  await open(page)
  assert.equal(requests[0].q, ""); assert.equal(requests[0].lang, "es")
  await screenshot(page, "catalog-desktop")
  await page.getByRole("button", { name: "Siguiente", exact: true }).click()
  await page.getByRole("button", { name: titles[2003], exact: true }).waitFor()
  assert.equal(requests.at(-1).page, "2")
  await page.getByLabel("Tema", { exact: true }).selectOption("adventure")
  await page.getByRole("button", { name: titles[2000], exact: true }).waitFor()
  assert.equal(requests.at(-1).page, "1"); assert.equal(requests.at(-1).topic, "adventure")
  await page.getByLabel("Idioma de la edición").selectOption("fr")
  await page.getByLabel("Idioma de la edición").selectOption("en")
  await page.getByRole("button", { name: titles[2000], exact: true }).waitFor()
  await page.waitForTimeout(400)
  assert.match(await page.getByRole("button", { name: titles[2000], exact: true }).innerText(), /English/i)
  const search = page.getByPlaceholder("Título, autor, número o enlace de Gutenberg")
  await search.fill("vacío"); await search.press("Enter")
  await page.getByText("No hay ediciones con estos filtros.", { exact: true }).waitFor()
  await page.getByRole("button", { name: "Buscar en todos los idiomas", exact: true }).click()
  await page.getByRole("button", { name: titles[2000], exact: true }).waitFor()
  assert.equal(requests.at(-1).lang, "all")
  failNext = true
  await search.fill("fallo"); await search.press("Enter")
  await page.getByRole("alert").getByText(/No pudimos conectar/).waitFor()
  assert.equal(await page.getByText("No hay ediciones con estos filtros.", { exact: true }).count(), 0)
  await page.getByRole("button", { name: "Reintentar", exact: true }).click()
  await page.getByRole("button", { name: titles[2000], exact: true }).click()
  await page.getByTestId("gutenberg-sample").waitFor()
  assert.match(await page.getByTestId("gutenberg-sample").innerText(), /dedicatoria/)
  await page.getByLabel("capítulos", { exact: true }).selectOption("2")
  assert.match(await page.getByTestId("gutenberg-sample").innerText(), /Sancho/)
  console.log("Gutenberg QA: chapter preview and editorial import")
  await screenshot(page, "edition-desktop")
  await page.getByText("Edición lista para revisar", { exact: true }).click()
  await page.getByLabel("Título", { exact: true }).fill("Quijote · edición revisada")
  assert.equal(await page.getByLabel("Destino de la importación").inputValue(), "draft")
  await page.getByRole("button", { name: "Guardar borrador", exact: true }).click()
  await page.waitForURL("**/editor?id=50&status=draft")
  assert.equal(imports[0].status, "draft"); assert.equal(imports[0].overrideTitle, "Quijote · edición revisada")
  await context.close()

  console.log("Gutenberg QA: mobile detail, back navigation and full offline copy")
  const mobile = await setup({ mobile: true })
  await open(mobile.page)
  await screenshot(mobile.page, "catalog-mobile")
  await mobile.page.getByRole("button", { name: titles[2000], exact: true }).click()
  await mobile.page.getByTestId("gutenberg-sample").waitFor()
  assert.equal(await mobile.page.getByPlaceholder("Título, autor, número o enlace de Gutenberg").isVisible(), false)
  assert.ok(await mobile.page.getByRole("button", { name: "Volver a resultados", exact: true }).isVisible())
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await screenshot(mobile.page, "edition-mobile")
  await mobile.page.getByRole("button", { name: "Volver a resultados", exact: true }).click()
  await mobile.page.getByRole("button", { name: titles[2001], exact: true }).click()
  await mobile.page.getByTestId("gutenberg-sample").waitFor()
  await mobile.page.getByRole("button", { name: "Guardar en biblioteca", exact: true }).click()
  await mobile.page.waitForURL("**/book/gutenberg-2001")
  const saved = await mobile.page.evaluate(async () => {
    const shelf = JSON.parse(localStorage.getItem("tloque.account.v1:99:local:novareads_saved"))
    const db = await new Promise((resolve, reject) => { const req = indexedDB.open("tloque_account_99"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
    const content = await new Promise((resolve, reject) => { const req = db.transaction("offline_content").objectStore("offline_content").get("content_gutenberg-2001"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
    db.close(); return { shelf, content }
  })
  assert.equal(saved.shelf[0].id, "gutenberg-2001")
  assert.equal(saved.shelf[0].chapters, undefined)
  assert.equal(saved.content.chapters.length, 3)
  assert.match(saved.content.chapters[2].content, /Sancho/)
  await mobile.context.close()
  assert.deepEqual(errors, [])
  console.log("Gutenberg browser QA passed")
} finally { await browser.close(); await vite.close() }
