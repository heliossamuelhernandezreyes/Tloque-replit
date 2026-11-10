import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { createServer } from "vite"
import { DEFAULT_PRICES } from "../shared/pricing.ts"
import { legalDocuments } from "../shared/legal.ts"

if (process.env.CI !== "true") throw new Error("Use isolated CI fixtures")
const { chromium } = createRequire(import.meta.url)("playwright")
const output = resolve(".tloque_cache/ui-reliability")
await mkdir(output, { recursive: true })
const vite = await createServer({ server: { host: "127.0.0.1", port: 4188, strictPort: true }, logLevel: "error" })
await vite.listen()
const browser = await chromium.launch({ headless: true })
const origin = "http://127.0.0.1:4188"
const user = { id: 599, email: "ui@fixture.test", name: "Titular de prueba", avatar: "", banner: "", bio: "", socialLinks: {}, frame: "", roles: { reader: true, author: true, admin: false }, capabilities: { createBooks: true, manageOwnBooks: true }, persona: "author", isAdmin: false, subscription: { plan: "reader", status: "active", expiresAt: null } }
const chapter = "Un párrafo para verificar la lectura y conservar lo escrito. ".repeat(35)
const work = { id: 123, title: "Obra de prueba", author: user.name, authorId: user.id, status: "published", revision: 1, genre: "fantasia", type: "book", coverUrl: "", synopsis: "Una obra para probar navegación y escritura.", chapterCount: 2, chapters: [{ title: "Uno", content: chapter }, { title: "Dos", content: chapter }], updatedAt: "2026-11-01T12:00:00Z" }
const errors = []
async function setup() {
  const state = { signedIn: true, failDelete: false, failInbox: false, bookDelay: 0, order: "pending", searches: [], cloud: [], claims: [], oauth: [], showCards: false, cardBuys: [], walletStatus: "pending", walletBuys: [] }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "es-MX", isMobile: true, hasTouch: true })
  context.setDefaultTimeout(20_000)
  await context.addInitScript(() => {
    localStorage.setItem("novareads_onboarding_done", "1")
    sessionStorage.setItem("tloque_boot_seen_v1", "1")
    localStorage.setItem("tloque_settings_v2", JSON.stringify({ visualQuality: "essential", reduceMotion: true, orbSounds: false, musicEnabled: false, language: "es" }))
  })
  await context.route("**/*", async route => {
    const url = new URL(route.request().url()), method = route.request().method()
    if (url.origin !== origin) return route.abort()
    if (!url.pathname.startsWith("/api/")) return route.continue()
    let data = {}
    if (url.pathname === "/api/auth/me") data = state.signedIn ? user : null
    else if (url.pathname === "/api/auth/google") {
      state.oauth.push(url.searchParams.get("returnTo")); state.signedIn = true
      assert.ok(!url.href.includes("ABCD-EFGH"), "claim key must never reach OAuth URL")
      return route.fulfill({ status: 302, headers: { location: url.searchParams.get("returnTo") || "/" } })
    } else if (url.pathname === "/api/books") {
      const query = url.searchParams.get("search"); if (query) state.searches.push(query)
      data = query ? [{ ...work, id: query === "alpha" ? 456 : 789, authorId: 600, title: query === "alpha" ? "Alpha" : "Beta" }] : [work]
    } else if (url.pathname === "/api/books/mine") data = [work]
    else if (url.pathname === "/api/books/123/draft") {
      if (method === "PUT") { const payload = route.request().postDataJSON(); state.cloud.push(payload.data); data = { draft: { draftRevision: state.cloud.length } } }
      else data = { draft: null }
    } else if (url.pathname === "/api/books/123") {
      if (method === "DELETE") return route.fulfill({ status: state.failDelete ? 500 : 204, ...(state.failDelete ? { json: { message: "Fallo de prueba" } } : {}) })
      if (state.bookDelay) await new Promise(r => setTimeout(r, state.bookDelay))
      data = work
    } else if (url.pathname.endsWith("/comments")) data = { commentsEnabled: true, canModerate: false, comments: [] }
    else if (url.pathname === "/api/books/123/audio") data = { assignments: [] }
    else if (url.pathname.includes("/experience/")) data = { profile: null, musicBrain: null, audioLayers: [] }
    else if (url.pathname.includes("/audiobook/")) data = { status: "unavailable" }
    else if (url.pathname === "/api/notifications") {
      if (state.failInbox) return route.fulfill({ status: 503, json: { message: "Prueba sin conexión" } })
      data = { notifications: [], unread: 0 }
    } else if (url.pathname === "/api/author/editions") data = { editions: [], summary: { total: 0, available: 0, sold: 0, returned: 0, digitalClaimed: 0 } }
    else if (url.pathname === "/api/frames") data = { frames: [] }
    else if (url.pathname === "/api/cards/owned") data = { cards: [] }
    else if (url.pathname === "/api/tokens/mine") data = { tokens: [] }
    else if (url.pathname === "/api/tokens/unlocked") data = { bookIds: [] }
    else if (url.pathname === "/api/payments/config") data = { enabled: false, beta: false, prices: DEFAULT_PRICES, offers: { support: null, sale: null } }
    else if (url.pathname === "/api/legal/documents") data = { hash: "a".repeat(64), publicationReady: true, documents: legalDocuments({ name: "Operador simulado", address: "Domicilio simulado", privacyEmail: "qa@fixture.test", phone: "8180000000" }) }
    else if (url.pathname === "/api/wallet") data = { tinta: state.cardBuys.length ? 15 : 20, papel: 0 }
    else if (url.pathname === "/api/wallet/packs") data = { enabled: true, beta: false, commerceVersion: "fixture-commerce", packs: [{ id: "gota", tinta: 10, cents: 3000, label: "Gota", recommended: true }] }
    else if (url.pathname === "/api/wallet/orders/17") data = { id: 17, status: state.walletStatus, units: 10, packId: "gota", commerceVersion: "fixture-commerce", purchaseKey: "previous-fixture-key" }
    else if (url.pathname === "/api/wallet/orders/lookup") return route.fulfill({ status: 404, json: { message: "No pending fixture order" } })
    else if (url.pathname === "/api/wallet/buy") {
      state.walletBuys.push({ key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() })
      data = { mode: "free_beta", credited: 10, orderId: 100 + state.walletBuys.length }
    }
    else if (url.pathname === "/api/books/123/cards") data = { cards: state.showCards ? [{ id: 55, bookId: 123, name: "Carta auditada", rarity: "common", unlock: "tinta", priceTinta: 5, owned: !!state.cardBuys.length, isSaga: false, position: 0, fx: { layers: { back: "", mid: "", front: "" } } }] : [] }
    else if (url.pathname === "/api/cards/55/quote") data = { hash: "b".repeat(64), documentHash: "a".repeat(64), canPay: true, bookTitle: work.title, economics: { units: 5, authorCents: 500, platformCents: 500 }, documents: [] }
    else if (url.pathname === "/api/cards/55/buy") {
      state.cardBuys.push(route.request().postDataJSON()); data = { ok: true, cardId: 55, editionId: 1 }
    }
    else if (url.pathname === "/api/tokens/orders/7") data = { id: 7, bookId: 123, status: state.order, tokenId: state.order === "paid" ? 77 : null }
    else if (url.pathname === "/api/tokens/orders/999") return route.fulfill({ status: 404, json: { message: "Orden no disponible" } })
    else if (url.pathname === "/api/claim/TLQ-FIXTURE") {
      if (method === "POST") { state.claims.push(route.request().postDataJSON()); data = { ok: true } }
      else data = { folio: "TLQ-FIXTURE", status: "free", kind: "sale", bookId: 123, title: work.title, author: user.name, coverUrl: "" }
    } else if (url.pathname === "/api/sync/state") data = { library: [], progress: [], streak: null }
    else if (url.pathname.includes("/cards")) data = { cards: [] }
    else return route.fulfill({ status: 404, json: { message: "Endpoint no incluido en esta prueba" } })
    return route.fulfill({ json: data })
  })
  const page = await context.newPage()
  page.on("pageerror", error => { errors.push(error.message); console.error("App runtime:", error.stack || error.message) })
  page.on("console", message => {
    if (message.type() === "error" && message.text().includes("Tloque no pudo renderizar")) {
      errors.push(message.text()); console.error("App boundary:", message.text())
    }
  })
  return { page, context, state }
}
const navigate = (page, path) => page.evaluate(path => { history.pushState(null, "", path); dispatchEvent(new PopStateEvent("popstate")) }, path)
const draft = page => page.evaluate(async () => (await import("/src/lib/editor-drafts.ts")).loadDurableEditorDraft(123))
const failures = []
async function scenario(name, run) {
  console.log("UI reliability:", name)
  try { await run() } catch (error) {
    failures.push(error)
    for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) {
      await page.screenshot({ path: resolve(output, `failure-${failures.length}-${index}.png`) }).catch(() => {})
      console.error("Failure screen:", (await page.locator("body").innerText().catch(() => "")).slice(0, 2000))
    }
    console.error(error)
  } finally { for (const context of browser.contexts()) await context.close() }
}
try {
  await scenario("OAuth destination and claim secret", async () => {
  const login = await setup(); login.state.signedIn = false
  await login.page.goto(origin + "/claim/TLQ-FIXTURE#key=ABCD-EFGH")
  await login.page.getByRole("button", { name: "Continuar con Google", exact: true }).click()
  await login.page.waitForURL("**/claim/TLQ-FIXTURE")
  await login.page.locator("input").waitFor()
  assert.equal(await login.page.locator("input").inputValue(), "ABCD-EFGH")
  assert.deepEqual(login.state.oauth, ["/claim/TLQ-FIXTURE"])
  assert.equal(await login.page.evaluate(() => sessionStorage.getItem("tloque_login_return_v1")), null)
  await login.context.close()
  })

  await scenario("immediate editor exit and SPA Back retain the manuscript", async () => {
  const editor = await setup()
  await editor.page.goto(origin + "/library")
  await editor.page.getByRole("heading", { name: user.name, exact: true }).waitFor()
  await navigate(editor.page, "/editor?id=123&source=server&status=published")
  const manuscript = editor.page.getByRole("textbox", { name: /Escribe aquí tu historia/ })
  await manuscript.waitFor(); await editor.page.waitForFunction(text => document.querySelector('textarea[aria-label]')?.value === text, chapter)
  const first = chapter + " ÚLTIMA FRASE ANTES DE VOLVER"
  await manuscript.fill(first)
  await editor.page.getByRole("button", { name: "Volver a la biblioteca", exact: true }).click()
  await editor.page.waitForURL("**/library")
  assert.equal((await draft(editor.page)).value.chapters[0].content, first)
  editor.page.once("dialog", dialog => dialog.accept())
  await navigate(editor.page, "/editor?id=123&source=server&status=published")
  await manuscript.waitFor()
  const second = first + " CAMBIO ANTES DE ATRÁS"
  await manuscript.fill(second)
  await editor.page.goBack()
  await editor.page.waitForURL("**/library")
  await assert.doesNotReject(async () => {
    await editor.page.waitForFunction(async text => (await (await import("/src/lib/editor-drafts.ts")).loadDurableEditorDraft(123))?.value.chapters[0].content === text, second)
  })
  await editor.context.close()
  })

  await scenario("consecutive searches, failed Inbox and visible navigation", async () => {
  const search = await setup()
  await search.page.goto(origin + "/library?search=alpha")
  await search.page.getByRole("heading", { name: '"alpha"', exact: true }).waitFor()
  await navigate(search.page, "/library?search=beta")
  await search.page.getByRole("heading", { name: '"beta"', exact: true }).waitFor()
  await search.page.getByRole("heading", { name: "Beta", exact: true }).waitFor()
  assert.ok(search.state.searches.includes("beta"))
  await search.page.getByRole("button", { name: "Buscar", exact: true }).click()
  await search.page.locator('input[placeholder]').waitFor()
  await search.page.keyboard.press("Escape")
  search.state.failInbox = true
  // Reload to exercise a failed request instead of the header's fresh notification cache.
  await search.page.goto(origin + "/inbox")
  await search.page.getByRole("alert").waitFor()
  await search.page.getByRole("button", { name: "Reintentar", exact: true }).waitFor()
  await search.context.close()
  })

  await scenario("cold reader scrolling and reading settings", async () => {
  const reader = await setup(); reader.state.bookDelay = 600
  await reader.page.goto(origin + "/read/123/1")
  const scroll = reader.page.getByTestId("reader-scroll")
  await scroll.waitFor()
  await scroll.evaluate(el => { el.scrollTop = el.scrollHeight * .35; el.dispatchEvent(new Event("scroll", { bubbles: true })) })
  await reader.page.waitForFunction(() => parseFloat(document.querySelector('[data-testid="reader-progress"]')?.style.width || "0") > 10)
  await scroll.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll", { bubbles: true })) })
  await reader.page.getByRole("button", { name: "Lectura", exact: true }).click()
  await reader.page.getByRole("dialog").getByRole("button", { name: "Grande", exact: true }).click()
  await reader.page.keyboard.press("Escape")
  // Radix restores focus in its unmount cleanup, after Escape has been handled.
  await reader.page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Lectura")
  await reader.page.screenshot({ path: resolve(output, "reader-mobile.png") })
  await reader.context.close()
  })

  await scenario("order confirmation follows server state", async () => {
  const checkout = await setup()
  await checkout.page.goto(origin + "/book/123?paid=7")
  await checkout.page.getByRole("status").filter({ hasText: /verificando el pago/ }).waitFor()
  assert.equal(await checkout.page.getByText("Pago confirmado. Tu edición está disponible.", { exact: true }).count(), 0)
  checkout.state.order = "paid"
  await checkout.page.getByText("Pago confirmado. Tu edición está disponible.", { exact: true }).waitFor()
  await checkout.page.goto(origin + "/book/123?paid=999")
  await checkout.page.getByRole("alert").waitFor()
  assert.equal(await checkout.page.getByText("Pago confirmado. Tu edición está disponible.", { exact: true }).count(), 0)
  await checkout.context.close()
  })

  await scenario("card purchase requires a visible quote and explicit acceptance", async () => {
    const card = await setup(); card.state.showCards = true
    await card.page.goto(origin + "/book/123")
    await card.page.getByRole("button", { name: "Obtener · 100 💧", exact: true }).click()
    const dialog = card.page.getByRole("dialog", { name: "Confirmar compra de tarjeta" })
    await dialog.getByText(/edición digital permanente/).waitFor()
    const confirm = dialog.getByRole("button", { name: "Confirmar compra", exact: true })
    assert.equal(await confirm.isDisabled(), true)
    assert.deepEqual(card.state.cardBuys, [])
    await dialog.getByRole("checkbox").check()
    await card.page.screenshot({ path: resolve(output, "card-purchase-mobile.png") })
    await Promise.all([card.page.waitForResponse(response => response.url().endsWith("/api/cards/55/buy")), confirm.click()])
    await dialog.waitFor({ state: "hidden" })
    assert.deepEqual(card.state.cardBuys, [{ acceptance: { accepted: true, documentHash: "a".repeat(64), quoteHash: "b".repeat(64) } }])
  })

  await scenario("wallet return verifies payment and two new recharges use distinct intentions", async () => {
    const wallet = await setup()
    await wallet.context.addInitScript(() => localStorage.setItem("tloque.account.v1:599:local:wallet-purchase:fixture-commerce:gota", "previous-fixture-key"))
    await wallet.page.goto(origin + "/?tinta=17")
    await wallet.page.getByText(/Tu pago sigue pendiente de confirmación/).waitFor()
    assert.equal(await wallet.page.getByText(/Recarga confirmada:/).count(), 0)
    wallet.state.walletStatus = "paid"
    await wallet.page.getByText(/Recarga confirmada: 200 Tintas/).waitFor()
    await wallet.page.waitForFunction(() => localStorage.getItem("tloque.account.v1:599:local:wallet-purchase:fixture-commerce:gota") === null)
    await wallet.page.goto(origin + "/book/123")
    await wallet.page.getByRole("button", { name: /Conseguir Tinta/ }).click()
    const dialog = wallet.page.getByRole("dialog", { name: "Monedero" })
    await dialog.getByRole("checkbox").check()
    const pack = dialog.getByRole("button").filter({ hasText: /200/ }).last()
    for (let index = 0; index < 2; index++) {
      await Promise.all([wallet.page.waitForResponse(response => response.url().endsWith("/api/wallet/buy")), pack.click()])
      await dialog.getByText(/Tinta acreditada/).waitFor()
    }
    assert.equal(wallet.state.walletBuys.length, 2)
    assert.notEqual(wallet.state.walletBuys[0].key, wallet.state.walletBuys[1].key)
    assert.ok(wallet.state.walletBuys.every(purchase => purchase.key !== "previous-fixture-key" && purchase.body.acceptance.accepted === true))
    await wallet.page.screenshot({ path: resolve(output, "wallet-recharge-mobile.png") })
  })
  if (failures.length) throw new AggregateError(failures, "UI reliability scenarios failed")
  assert.deepEqual(errors, [])
  console.log("UI reliability gate passed: OAuth/QR, drafts, searches, errors, reader, card consent and wallet payment states; no live services.")
} finally { await browser.close(); await vite.close() }
