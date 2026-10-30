import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { createServer } from "vite"
import { legalDocuments } from "../shared/legal.ts"

if (process.env.CI !== "true") throw new Error("Run this isolated browser fixture in CI")
const { chromium } = createRequire(import.meta.url)("playwright")
const output = resolve(".tloque_cache/gutenberg-qa")
await mkdir(output, { recursive: true })
const vite = await createServer({ server: { host: "127.0.0.1", port: 4187, strictPort: true }, logLevel: "error" })
await vite.listen()
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 })
await context.addCookies([{ name: "fixture-session", value: "synthetic", url: "http://127.0.0.1:4187" }])
const page = await context.newPage()
page.setDefaultTimeout(20_000)
const errors = [], submissions = []
let publicationReady = true
page.on("pageerror", error => errors.push(error.message))
await context.route("**/*", route => {
  const url = new URL(route.request().url())
  if (url.hostname !== "127.0.0.1") return route.abort()
  if (url.pathname === "/legal-fixture") return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>' })
  if (url.pathname === "/api/legal/documents") return route.fulfill({ json: { hash: "a".repeat(64), publicationReady,
    documents: legalDocuments({ name: "Operador simulado", address: "Domicilio simulado para QA", privacyEmail: "contacto@fixture.mx", phone: "8180000000" }) } })
  if (url.pathname === "/api/privacy/requests") {
    submissions.push({ body: route.request().postDataJSON(), cookie: route.request().headers().cookie })
    return route.fulfill({ status: 201, json: { folio: "fixture-folio", receivedAt: "2026-10-30T10:00:00Z", status: "received", message: "No se ha ejecutado ninguna eliminación ni entrega de datos." } })
  }
  if (url.pathname === "/api/admin/privacy/requests") return route.fulfill({ json: [{ id: 1, publicId: "folio-qa", type: "cancellation", status: "verification", email: "reader@fixture.mx", description: "Revisar conservación de mis borradores", createdAt: "2026-10-30T10:00:00Z" }] })
  if (url.pathname === "/api/admin/privacy/requests/1/events") return route.fulfill({ json: [{ id: 1, status: "received", note: "Identidad y alcance pendientes de verificar", createdAt: "2026-10-30T10:00:00Z" }] })
  if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 404, json: {} })
  return route.continue()
})
const fixture = "/@fs/" + resolve("scripts/fixtures/legal-ui.tsx")
async function show(view) {
  await page.evaluate(async ({ fixture, view }) => { (await import(fixture)).renderLegalFixture(view) }, { fixture, view })
}
async function screenshot(name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "mobile width")
  await page.screenshot({ path: resolve(output, "legal-" + name + ".png"), fullPage: true })
}
try {
  await page.goto("http://127.0.0.1:4187/legal-fixture")
  await show("publication")
  await page.getByRole("checkbox").nth(8).waitFor()
  const checks = page.getByRole("checkbox")
  assert.equal(await checks.count(), 9)
  for (let index = 0; index < 9; index++) assert.equal(await checks.nth(index).isChecked(), false)
  const confirm = page.getByRole("button", { name: "Confirmar y publicar esta versión", exact: true })
  assert.equal(await confirm.isDisabled(), true)
  await page.getByRole("dialog").focus()
  await page.keyboard.press("Shift+Tab")
  assert.equal(await page.getByRole("button", { name: "Volver al borrador", exact: true }).evaluate(element => element === document.activeElement), true)
  await page.keyboard.press("Tab")
  assert.equal(await page.locator("summary").first().evaluate(element => element === document.activeElement), true)
  await page.getByText(/Licencia de publicación y permisos opcionales ·/).click()
  await screenshot("publication-mobile")
  for (let index = 6; index < 9; index++) await checks.nth(index).check()
  await checks.nth(1).check()
  await confirm.click()
  const accepted = await page.evaluate(() => window.confirmed)
  assert.equal(accepted.choices.personalPrint, true)
  for (const name of ["offline", "commercialPrint", "audio", "translation", "collectibles"]) assert.equal(accepted.choices[name], false)
  await page.keyboard.press("Escape")
  assert.equal(await page.evaluate(() => window.cancelled), true)
  publicationReady = false
  await show("publication")
  await page.getByText(/Faltan datos del responsable/).waitFor()
  assert.equal(await confirm.isDisabled(), true)
  await show("request")
  await page.getByLabel("Correo para seguimiento").fill("reader@fixture.mx")
  await page.getByLabel("Derecho o solicitud").selectOption("cancellation")
  await page.getByLabel("Qué necesitas revisar").fill("Revisar conservación de mis borradores privados")
  await screenshot("privacy-form-mobile")
  await page.getByRole("button", { name: "Presentar solicitud", exact: true }).click()
  await page.getByText("fixture-folio", { exact: true }).waitFor()
  assert.equal(submissions.length, 1)
  assert.equal(submissions[0].body.type, "cancellation")
  assert.equal(submissions[0].cookie, undefined)
  await screenshot("privacy-receipt-mobile")
  await show("admin")
  await page.getByRole("button", { name: "Ver actuaciones", exact: true }).click()
  await page.getByText("Identidad y alcance pendientes de verificar", { exact: true }).waitFor()
  await screenshot("privacy-actions-mobile")
  assert.deepEqual(errors, [])
  console.log("Legal browser QA passed: explicit choices, pending setup, public receipt and restricted-action interface")
} finally { await context.close(); await browser.close(); await vite.close() }
