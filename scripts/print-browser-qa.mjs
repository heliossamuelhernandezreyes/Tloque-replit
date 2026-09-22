import { createRequire } from "node:module"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { resolve } from "node:path"
import { preview } from "vite"
import { composeEdition } from "../client/src/print/compose.ts"
import { editionSettings, imposeBooklet, printLabels } from "../client/src/print/model.ts"
import { fontMetrics, pdfDocument } from "../client/src/print/pdfRuntime.ts"

// Exercise the built application, including the production module worker.
// Every API response is a fixture. No database, account, purchase or remote service.
const { chromium } = createRequire(import.meta.url)("playwright")
const output = resolve(".tloque_cache/print-qa")
await mkdir(output, { recursive: true })
const vite = await preview({ preview: { host: "127.0.0.1", port: 4184, strictPort: true }, logLevel: "error" })
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"],
  ...(process.env.TLOQUE_QA_CHROME ? { executablePath: process.env.TLOQUE_QA_CHROME } : {}) })
const errors = [], writes = [], expected = {}
let artBook
const unicodeBook = { id: 87, title: "El alfabeto \ue001", author: "Lucía \u{f0001}", originalLanguage: "es", genre: "fantasia", isClassic: true, status: "published", coverUrl: "", revision: 1,
  chapters: [{ title: "Lenguas y dibujos", content: "El alfabeto inventado: \ue001 \u{f0001}.\nمرحبا بالعالم 123 (تجربة)\nשלום עולם (123)\nSímbolos: ∑ ∞ ♫ ✦ 😀.\nMi sello: [[sello]] [[sello]].\nÚLTIMA LÍNEA: a\u0323\u0301." }] }
const sentence = "Lucía cruzó el río y encontró la biblioteca abierta. ¿Quién recordaba todavía el nombre de aquella ciudad? La lámpara iluminaba sus páginas, y cada palabra traía consigo una memoria distinta."
const book = { id: 85, title: "La memoria del río", author: "Lucía Márquez", originalLanguage: "es",
  genre: "fantasia", isClassic: true, status: "published", coverUrl: "", revision: 1,
  synopsis: "Una biblioteca junto al río conserva las palabras que una ciudad ha olvidado. Lucía deberá escuchar sus páginas para encontrar el camino de regreso.",
  chapters: [
    { title: "El umbral", content: Array.from({ length: 25 }, () => sentence + " " + sentence).join("\n\n") },
    { title: "La casa de las palabras", content: Array.from({ length: 27 }, () => sentence).join("\n\n") },
    { title: "El regreso", content: Array.from({ length: 22 }, () => sentence).join("\n\n") + "\n\nÚLTIMA LÍNEA: México, Ελληνικά, русский." },
  ] }
const fonts = Object.fromEntries(await Promise.all([["normal", "Regular"], ["bold", "Bold"], ["italic", "It"]].map(async ([key, name]) => [key, (await readFile("client/src/print/assets/SourceSerif4-" + name + ".ttf")).toString("base64")])))
const metrics = fontMetrics(pdfDocument(148, 210, fonts))
function remember(name, patch) {
  const layout = composeEdition(book, editionSettings(patch), metrics, printLabels("es"))
  expected[name] = { width: layout.width, height: layout.height, chapters: layout.chapters,
    pages: layout.pages.map(p => ({ kind: p.kind, text: p.ops.filter(o => o.kind === "text").map(o => o.text).join("\n") })),
    plan: imposeBooklet(layout.pages.length, layout.settings.signature) }
  return layout
}
const press = remember("interior-a5", {})
remember("interior-a4", { destination: "home", paper: "a4", recto: false })
remember("booklet-reading-order", { destination: "booklet", paper: "letter", signature: 8, recto: false })
await writeFile(output + "/expected.json", JSON.stringify(expected, null, 2))

async function setup(mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, reducedMotion: "reduce", acceptDownloads: true })
  context.setDefaultTimeout(30_000)
  await context.addInitScript(() => {
    localStorage.setItem("novareads_onboarding_done", "1")
    sessionStorage.setItem("tloque_boot_seen_v1", "1")
    localStorage.setItem("tloque_settings_v2", JSON.stringify({ visualQuality: "essential", reduceMotion: true, orbSounds: false, musicEnabled: false, language: "es" }))
  })
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.hostname !== "127.0.0.1") return route.abort()
    if (!url.pathname.startsWith("/api/")) return route.continue()
    if (request.method() !== "GET") { writes.push(request.method() + " " + url.pathname); return route.fulfill({ status: 405, json: {} }) }
    let data = {}
    if (url.pathname === "/api/auth/me") data = { id: 99, email: "fixture@example.test", name: "Print QA", avatar: "", isAdmin: true, capabilities: { manageCatalog: true, manageFrames: true, manageAudioCatalog: true, manageFinance: true, manageAdmins: true, runDiagnostics: true }, persona: "admin" }
    else if (url.pathname === "/api/books/85") data = book
    else if (url.pathname === "/api/books/86") data = artBook
    else if (url.pathname === "/api/books/87") data = unicodeBook
    else if (url.pathname === "/api/books") data = []
    else if (url.pathname === "/api/frames") data = { frames: [] }
    else if (url.pathname.includes("notifications")) data = { notifications: [], unread: 0 }
    else if (url.pathname === "/api/sync/state") data = { library: [], progress: [], streak: null }
    else if (url.pathname === "/api/tokens/mine") data = { tokens: [] }
    return route.fulfill({ json: data })
  })
  const page = await context.newPage()
  page.on("pageerror", error => errors.push(error.message))
  return { context, page }
}
async function ready(page) {
  // The preview is deliberately hidden when mobile users are editing settings.
  await page.locator(".print-preview-pane[aria-busy=false]").waitFor({ state: "attached", timeout: 60_000 })
  await page.getByTestId("print-preview").waitFor({ state: "attached" })
  assert.equal(await page.locator(".print-error").count(), 0)
  await page.evaluate(() => document.fonts.ready)
}
async function open(page, id = "85") {
  await page.goto("http://127.0.0.1:4184/book/" + id)
  await page.getByRole("button", { name: "Crear edición física", exact: true }).click()
  await page.getByRole("dialog", { name: "Taller de ediciones", exact: true }).waitFor()
  await ready(page)
}
const screenshot = (page, name) => page.screenshot({ path: output + "/" + name + ".png", animations: "disabled", timeout: 45_000 })
const step = (page, name) => page.getByRole("button", { name, exact: true }).click()
async function download(page, label, name) {
  const event = page.waitForEvent("download")
  await page.getByRole("button", { name: label, exact: true }).click()
  await (await event).saveAs(output + "/" + name)
}
async function number(page, label, value) {
  const field = page.getByLabel(label, { exact: true })
  await field.fill(String(value)); await field.press("Tab"); await ready(page)
}
try {
  console.log("Print QA: built desktop studio, fonts, templates and separate print files")
  const { page, context } = await setup()
  await open(page)
  assert.match(await page.locator(".print-summary").innerText(), new RegExp("^" + press.pages.length + " páginas"))
  await page.getByLabel("Ir al capítulo", { exact: true }).selectOption({ label: "El umbral" })
  await step(page, "02 Diseño")
  await screenshot(page, "studio-desktop")
  await page.getByRole("button", { name: /Lectura amplia/ }).click(); await ready(page)
  const largeCount = Number((await page.locator(".print-summary").innerText()).split(" ")[0])
  assert.ok(largeCount > press.pages.length)
  await page.getByRole("button", { name: /Literaria/ }).click(); await ready(page)
  await step(page, "03 Revisión")
  await download(page, "Descargar interior PDF", "interior-a5.pdf")
  await page.getByText("Preparar la cubierta", { exact: true }).click()
  assert.equal(await page.getByRole("button", { name: "Descargar cubierta PDF", exact: true }).isDisabled(), true)
  await number(page, "Lomo confirmado · mm", 8.4)
  await page.getByLabel("La imprenta revisará el color y su plantilla de cubierta.", { exact: true }).check()
  await screenshot(page, "cover-desktop")
  await download(page, "Descargar cubierta PDF", "cover-wrap.pdf")
  await download(page, "Descargar ficha de impresión", "press-job.txt")

  await step(page, "01 Formato")
  await page.getByRole("button", { name: /^En casa/ }).click(); await ready(page)
  await page.getByLabel("Papel de la impresora", { exact: true }).selectOption("a4"); await ready(page)
  await step(page, "03 Revisión")
  await download(page, "Descargar interior PDF", "interior-a4.pdf")

  await step(page, "01 Formato")
  await page.getByRole("button", { name: /^Cuadernillos/ }).click(); await ready(page)
  await page.getByLabel("Papel de la impresora", { exact: true }).selectOption("letter"); await ready(page)
  await page.getByLabel("Páginas por cuadernillo", { exact: true }).selectOption("8"); await ready(page)
  await step(page, "03 Revisión")
  await download(page, "Descargar cuadernillos PDF", "booklet-letter.pdf")
  await download(page, "Descargar interior PDF", "booklet-reading-order.pdf")
  await page.getByText("Preparar la cubierta", { exact: true }).click()
  assert.equal(await page.getByLabel("Lomo confirmado · mm", { exact: true }).inputValue(), "0")
  await number(page, "Lomo confirmado · mm", 6.2)
  await page.getByLabel("Medí el lomo del bloque de páginas y revisaré una prueba.", { exact: true }).check()
  await download(page, "Descargar cubierta recortable PDF", "cover-kit.pdf")
  await download(page, "Descargar ficha de impresión", "booklet-job.txt")
  const storage = await page.evaluate(() => JSON.parse(localStorage.getItem("tloque_print_edition_v1")))
  assert.equal(storage.spineMm, 0)
  assert.equal(JSON.stringify(storage).includes(sentence.slice(0, 30)), false)
  await page.getByRole("button", { name: "Cerrar taller", exact: true }).click()
  assert.equal(await page.locator("#root").evaluate(el => getComputedStyle(el).visibility), "visible")

  // Tiny, original test artwork exercises decoding, embedding, low-resolution
  // warnings and the optional illustrated back. No external image service.
  const pictures = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 900
    const ctx = canvas.getContext("2d")
    return ["#164b79", "#285a36"].map((color, i) => {
      ctx.fillStyle = color; ctx.fillRect(0, 0, 600, 900)
      ctx.fillStyle = "#e3c078"; ctx.fillRect(60, 90, 480, 12)
      ctx.font = "32px serif"; ctx.fillText(i ? "CONTRAPORTADA DE PRUEBA" : "PORTADA DE PRUEBA", 60, 170)
      return canvas.toDataURL("image/png")
    })
  })
  artBook = { ...book, id: 86, coverUrl: pictures[0], backCoverUrl: pictures[1] }
  await page.evaluate(() => localStorage.removeItem("tloque_print_edition_v1"))
  await open(page, "86")
  await step(page, "03 Revisión")
  await page.getByText("Preparar la cubierta", { exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="print-preview"] image').length === 2)
  assert.equal(await page.getByLabel("Texto de contraportada", { exact: true }).isDisabled(), true)
  await number(page, "Lomo confirmado · mm", 8.4)
  await page.getByLabel("La imprenta revisará el color y su plantilla de cubierta.", { exact: true }).check()
  await download(page, "Descargar cubierta PDF", "cover-artwork.pdf")
  await screenshot(page, "cover-artwork")
  await page.getByLabel("Usar la contraportada ilustrada", { exact: true }).uncheck(); await ready(page)
  assert.equal(await page.getByTestId("print-preview").locator("image").count(), 1)
  assert.equal(await page.getByLabel("Texto de contraportada", { exact: true }).isEnabled(), true)
  await page.getByRole("button", { name: "Cerrar taller", exact: true }).click()

  console.log("Print QA: custom alphabet, Arabic/Hebrew shaping, emoji, drawn symbols, illustrations and resource round-trip")
  await page.evaluate(() => localStorage.removeItem("tloque_print_edition_v1"))
  await page.goto("http://127.0.0.1:4184/book/87")
  await page.getByRole("button", { name: "Crear edición física", exact: true }).click()
  await page.locator(".print-preview-pane[aria-busy=false]").waitFor()
  assert.match(await page.locator(".print-error").innerText(), /U\+E001/)
  await step(page, "02 Diseño")
  await page.getByText("Caracteres e ilustraciones", { exact: true }).click()
  await page.getByLabel("Añadir fuente", { exact: true }).setInputFiles("tests/fixtures/print-glyphs.ttf")
  await ready(page)
  const drawing = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 1500; canvas.height = 750
    const ctx = canvas.getContext("2d")
    ctx.fillStyle = "#256f82"; ctx.fillRect(40, 40, 1420, 670)
    ctx.fillStyle = "#f7d590"; ctx.beginPath(); ctx.arc(750, 375, 240, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = "#173540"; ctx.beginPath(); ctx.moveTo(750, 185); ctx.lineTo(870, 430); ctx.lineTo(630, 430); ctx.closePath(); ctx.fill()
    return canvas.toDataURL("image/png").split(",")[1]
  })
  await writeFile(output + "/drawing.png", Buffer.from(drawing, "base64"))
  await page.getByLabel("Carácter o marcador", { exact: true }).fill("[[sello]]")
  await page.getByLabel("Añadir dibujo del símbolo", { exact: true }).setInputFiles(output + "/drawing.png")
  await ready(page)
  await page.getByLabel("Pie de ilustración (opcional)", { exact: true }).fill("Ilustración interior · dibujo original")
  await page.getByLabel("Añadir ilustración", { exact: true }).setInputFiles(output + "/drawing.png")
  await ready(page)
  await page.getByLabel("Ir al capítulo", { exact: true }).selectOption({ label: "Lenguas y dibujos" })
  assert.equal(await page.getByTestId("print-preview").locator("image").count(), 3)
  assert.ok(await page.getByTestId("print-preview").locator("path").count() > 50)
  await screenshot(page, "studio-unicode")
  await download(page, "Guardar recursos", "unicode-resources.json")
  const exportedResources = JSON.parse(await readFile(output + "/unicode-resources.json", "utf8"))
  assert.equal(exportedResources.resources.fonts.length, 1)
  assert.equal(exportedResources.resources.symbols.length, 1)
  assert.equal(exportedResources.resources.illustrations.length, 1)
  assert.equal("key" in exportedResources, false)
  const resourceStorage = await page.evaluate(() => localStorage.getItem("tloque_print_edition_v1"))
  assert.ok(!resourceStorage.includes("base64") && !resourceStorage.includes("[[sello]]"))
  await page.getByRole("button", { name: "Quitar [[sello]]", exact: true }).click(); await ready(page)
  assert.equal(await page.getByTestId("print-preview").locator("image").count(), 1)
  await page.getByLabel("Cargar recursos guardados", { exact: true }).setInputFiles(output + "/unicode-resources.json"); await ready(page)
  assert.equal(await page.getByTestId("print-preview").locator("image").count(), 3)
  await step(page, "03 Revisión")
  await download(page, "Descargar interior PDF", "unicode-interior.pdf")
  await page.getByText("Preparar la cubierta", { exact: true }).click()
  await number(page, "Lomo confirmado · mm", 5)
  await page.getByLabel("La imprenta revisará el color y su plantilla de cubierta.", { exact: true }).check()
  await download(page, "Descargar cubierta PDF", "unicode-cover.pdf")
  await step(page, "01 Formato")
  await page.getByRole("button", { name: /^Cuadernillos/ }).click(); await ready(page)
  await step(page, "03 Revisión")
  await download(page, "Descargar cuadernillos PDF", "unicode-booklet.pdf")
  await page.getByText("Preparar la cubierta", { exact: true }).click()
  await number(page, "Lomo confirmado · mm", 5)
  await page.getByLabel("Medí el lomo del bloque de páginas y revisaré una prueba.", { exact: true }).check()
  await download(page, "Descargar cubierta recortable PDF", "unicode-cover-kit.pdf")
  await context.close()

  console.log("Print QA: mobile controls, readable preview and offline manuscript hydration")
  const mobile = await setup(true)
  // Seed a fresh origin before application modules open localforage connections.
  await mobile.context.route("**/qa-empty", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Fixture setup</title>" }))
  await mobile.page.goto("http://127.0.0.1:4184/qa-empty")
  await mobile.page.evaluate(async value => {
    const { chapters, ...slim } = value
    localStorage.setItem("tloque.account.v1:99:local:novareads_saved", JSON.stringify([{ ...slim, id: "gutenberg-85", hasOfflineContent: true, chapterCount: chapters.length }]))
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("tloque_account_99", 1)
      request.onupgradeneeded = () => request.result.createObjectStore("offline_content")
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("offline_content", "readwrite")
      transaction.objectStore("offline_content").put({ chapters, content: null, savedAt: Date.now() }, "content_gutenberg-85")
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  }, book)
  await open(mobile.page, "gutenberg-85")
  assert.match(await mobile.page.locator(".print-summary").innerText(), new RegExp("^" + press.pages.length + " páginas"))
  await screenshot(mobile.page, "studio-mobile")
  await mobile.page.getByRole("button", { name: "Maqueta", exact: true }).click()
  await mobile.page.getByLabel("Ir al capítulo", { exact: true }).selectOption({ label: "El regreso" })
  await screenshot(mobile.page, "preview-mobile")
  await mobile.page.getByRole("button", { name: "Ampliar maqueta", exact: true }).click()
  assert.equal(await mobile.page.locator(".print-stage").evaluate(el => el.scrollWidth > el.clientWidth), true)
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await mobile.page.getByRole("button", { name: "Ampliar maqueta", exact: true }).click()
  for (let n = 0; n < press.pages.length; n++) {
    if ((await mobile.page.getByTestId("print-preview").textContent()).includes("ÚLTIMA LÍNEA")) break
    const next = mobile.page.getByRole("button", { name: "Página siguiente", exact: true })
    if (await next.isDisabled()) break
    await next.click()
  }
  assert.match(await mobile.page.getByTestId("print-preview").textContent(), /ÚLTIMA LÍNEA/)
  await mobile.context.close()
  assert.deepEqual(writes, [], "Printing must not create purchases, copies or API writes")
  assert.deepEqual(errors, [], "Browser runtime errors")
  console.log("Print browser QA passed: eleven PDFs, desktop/mobile, Unicode, custom fonts, inline/interior artwork, resource round-trip and offline text")
} catch (error) {
  console.error("Print QA failed:", error)
  console.error("Runtime errors:", errors)
  throw error
} finally {
  await browser.close()
  await new Promise(resolve => vite.httpServer.close(resolve))
}
