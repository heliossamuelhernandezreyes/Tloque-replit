import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { createServer } from "vite"

// Real browser storage, disposable pages and synthetic identities only.
if (process.env.CI !== "true") throw new Error("Run this isolated browser fixture in CI")
const { chromium } = createRequire(import.meta.url)("playwright")
const output = resolve(".tloque_cache/account-qa")
await mkdir(output, { recursive: true })
const vite = await createServer({ server: { host: "127.0.0.1", port: 4186, strictPort: true }, logLevel: "error" })
await vite.listen()
const browser = await chromium.launch({ headless: true })
const checks = [], errors = []
const context = await browser.newContext()
context.setDefaultTimeout(15_000)
await context.route("**/*", route => {
  const url = new URL(route.request().url())
  if (url.hostname !== "127.0.0.1") return route.abort()
  if (url.pathname === "/account-fixture") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Account fixture</title>" })
  return route.continue()
})
const a = await context.newPage(), b = await context.newPage()
for (const page of [a, b]) page.on("pageerror", error => errors.push(error.message))
try {
  await a.goto("http://127.0.0.1:4186/account-fixture")
  await a.evaluate(async () => {
    const { accountContext, accountStorage, accountSessionStorage } = await import("/src/lib/account-context.ts")
    const { createAccountStore } = await import("/src/lib/account-store.ts")
    localStorage.setItem("novareads_drafts", "unassigned historical manuscript")
    accountContext.activate(501)
    accountStorage.setItem("novareads_saved", "library A")
    accountStorage.setItem("reading_chapter_71", "progress A")
    accountSessionStorage.setItem("editing", "session A")
    await createAccountStore("editor_drafts_v1").setItem("book:71", { text: "draft A" })
    await createAccountStore("offline_content").setItem("content_71", { text: "offline A" })
  })
  await b.goto("http://127.0.0.1:4186/account-fixture")
  const aReloaded = a.waitForEvent("domcontentloaded")
  const isolated = await b.evaluate(async () => {
    const { accountContext, accountStorage, accountSessionStorage } = await import("/src/lib/account-context.ts")
    const { createAccountStore } = await import("/src/lib/account-store.ts")
    accountContext.activate(502)
    const result = [accountStorage.getItem("novareads_saved"), accountStorage.getItem("reading_chapter_71"), accountSessionStorage.getItem("editing"),
      await createAccountStore("editor_drafts_v1").getItem("book:71"), await createAccountStore("offline_content").getItem("content_71")]
    accountStorage.setItem("novareads_saved", "library B")
    await createAccountStore("editor_drafts_v1").setItem("book:71", { text: "draft B" })
    return result
  })
  assert.deepEqual(isolated, [null, null, null, null, null])
  await aReloaded
  assert.equal(await a.evaluate(async () => (await import("/src/lib/account-context.ts")).accountContext.id), null)
  checks.push("localStorage, sessionStorage and IndexedDB isolate two accounts; the old tab reloads")

  const bReloaded = b.waitForEvent("domcontentloaded")
  const restored = await a.evaluate(async () => {
    const { accountContext, accountStorage } = await import("/src/lib/account-context.ts")
    const { createAccountStore } = await import("/src/lib/account-store.ts")
    accountContext.activate(501)
    return { library: accountStorage.getItem("novareads_saved"), draft: await createAccountStore("editor_drafts_v1").getItem("book:71"), offline: await createAccountStore("offline_content").getItem("content_71") }
  })
  await bReloaded
  assert.deepEqual(restored, { library: "library A", draft: { text: "draft A" }, offline: { text: "offline A" } })
  checks.push("returning to the original account restores its own durable draft and offline content")

  const logoutReloaded = a.waitForEvent("domcontentloaded")
  await a.evaluate(async () => (await import("/src/lib/account-context.ts")).accountContext.end())
  await logoutReloaded
  const retained = await a.evaluate(async () => {
    const { accountContext } = await import("/src/lib/account-context.ts")
    const { createAccountStore } = await import("/src/lib/account-store.ts")
    accountContext.activate(501)
    return createAccountStore("editor_drafts_v1").getItem("book:71")
  })
  assert.deepEqual(retained, { text: "draft A" })
  checks.push("logout preserves the owning account's unsynchronized draft")

  const deleted = await a.evaluate(async () => {
    const { clearLocalAccountData } = await import("/src/lib/privacy.ts")
    const { accountStorage } = await import("/src/lib/account-context.ts")
    const { createAccountStore } = await import("/src/lib/account-store.ts")
    await clearLocalAccountData()
    return { library: accountStorage.getItem("novareads_saved"), draft: await createAccountStore("editor_drafts_v1").getItem("book:71"), legacy: localStorage.getItem("novareads_drafts") }
  })
  assert.deepEqual(deleted, { library: null, draft: null, legacy: "unassigned historical manuscript" })
  const aReloadedAgain = a.waitForEvent("domcontentloaded")
  const remaining = await b.evaluate(async () => {
    const { accountContext, accountStorage } = await import("/src/lib/account-context.ts")
    const { createAccountStore } = await import("/src/lib/account-store.ts")
    accountContext.activate(502)
    return { library: accountStorage.getItem("novareads_saved"), draft: await createAccountStore("editor_drafts_v1").getItem("book:71") }
  })
  await aReloadedAgain
  assert.deepEqual(remaining, { library: "library B", draft: { text: "draft B" } })
  checks.push("deleting one account's copies preserves the other account and unassigned historical data")
  await b.evaluate(async () => {
    const { accountStorage } = await import("/src/lib/account-context.ts")
    const { saveOfflineContent } = await import("/src/lib/offline.ts")
    accountStorage.setItem("novareads_saved", JSON.stringify([{ id: 81, title: "Descarga de B", author: "Autor de prueba" }]))
    await saveOfflineContent(81, { content: "Texto conservado sin conexión. <script>window.offlineLeak=true</script>" })
  })
  const apiRequests = []
  await context.route("**/api/**", route => { apiRequests.push(new URL(route.request().url()).pathname); return route.abort() })
  const offline = await context.newPage()
  offline.on("pageerror", error => errors.push(error.message))
  await offline.goto("http://127.0.0.1:4186/")
  await offline.getByRole("button", { name: "Abrir mis descargas sin conexión", exact: true }).click()
  await offline.getByRole("button", { name: /Descarga de B/ }).click()
  await offline.getByText("Texto conservado sin conexión.", { exact: false }).waitFor()
  assert.equal(await offline.evaluate(() => window.offlineLeak), undefined)
  await offline.getByRole("button", { name: "Marcar lectura como terminada", exact: true }).click()
  const progress = await offline.evaluate(async () => {
    const { accountContext, accountStorage } = await import("/src/lib/account-context.ts")
    let blocked = false
    try { await accountContext.request("/api/admin/payouts") } catch { blocked = true }
    return { id: accountContext.id, completed: accountStorage.getItem("reading_completed_81"), updated: Number(accountStorage.getItem("reading_updated_81")), blocked }
  })
  assert.equal(progress.id, "502"); assert.equal(progress.completed, "true"); assert.ok(progress.updated > 0); assert.equal(progress.blocked, true)
  assert.ok(apiRequests.every(path => path === "/api/auth/me"), JSON.stringify(apiRequests))
  await offline.screenshot({ path: resolve(output, "cold-offline-reader.png") })
  checks.push("a cold app with unavailable authentication reads only its own IndexedDB download, escapes text and records completion without API authority")
  assert.deepEqual(errors, [])
  for (const check of checks) console.log("PASS " + check)
} finally {
  await writeFile(resolve(output, "results.json"), JSON.stringify({ checks, errors }, null, 2) + "\n")
  await browser.close()
  await vite.close()
}
