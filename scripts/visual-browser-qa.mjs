import { createRequire } from "node:module"
import { mkdir, readFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { resolve } from "node:path"
import { createServer } from "vite"
import { createFrameScene, packageFrameScene } from "../shared/frame-scene.ts"
import { validateFrame } from "../server/frames.ts"

// Real application + local fixture API. Never connects to a deployed app or database.
// Install Playwright separately for QA; it is not shipped in the reading app.
const { chromium } = createRequire(import.meta.url)("playwright")
const output = resolve(".tloque_cache/visual-qa")
await mkdir(output, { recursive: true })
const server = await createServer({ server: { host: "127.0.0.1", port: 4182, strictPort: true }, logLevel: "error" })
await server.listen()
const args = ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
const browser = await chromium.launch({ headless: true, args, ...(process.env.TLOQUE_QA_CHROME ? { executablePath: process.env.TLOQUE_QA_CHROME } : {}) })
const errors = []
const frames = [{ id: 1, name: "Atlas astral", target: "both", priceTinta: 0, pkg: packageFrameScene(createFrameScene(), "Atlas astral", "both"), owned: true, available: true, visible: true, createdAt: "2026-09-12T00:00:00Z" }]
let saved = null
const user = { id: 9001, email: "fixture@example.test", name: "Visual QA", avatar: "", isAdmin: true, persona: "admin", subscription: { plan: "aesthetic", status: "active", expiresAt: null }, visualEntitlements: { themes: ["singularity", "fluorescent-rose"], expiresAt: null } }

async function setup({ mobile = false, essential = false, admin = true } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 })
  await context.addInitScript(({ essential }) => {
    localStorage.setItem("novareads_onboarding_done", "1")
    sessionStorage.setItem("tloque_boot_seen_v1", "1")
    localStorage.setItem("tloque_settings_v2", JSON.stringify({ visualQuality: essential ? "essential" : "premium", reduceMotion: false, orbSounds: false, musicEnabled: false, language: "es" }))
  }, { essential })
  await context.route("**/*", async route => {
    const url = new URL(route.request().url())
    if (url.hostname !== "127.0.0.1") return route.abort()
    if (!url.pathname.startsWith("/api/")) return route.continue()
    let data = {}
    if (url.pathname === "/api/auth/me") data = { ...user, isAdmin: admin }
    else if (url.pathname === "/api/frames") data = { frames }
    else if (url.pathname === "/api/admin/frames" && route.request().method() === "POST") {
      if (!admin) return route.fulfill({ status: 403, json: { message: "Forbidden" } })
      const input = route.request().postDataJSON(), checked = validateFrame(input)
      if (!checked.ok) return route.fulfill({ status: 400, json: { message: checked.error } })
      saved = checked.frame
      data = { ...saved, id: frames.length + 1, owned: true, available: true, visible: true, createdAt: "2026-09-12T00:00:00Z" }
      frames.push(data)
    } else if (url.pathname === "/api/books") data = []
    else if (url.pathname === "/api/wallet") data = { tinta: 300, papel: 0 }
    else if (url.pathname === "/api/sync/state") data = { library: [], progress: [], streak: null }
    else if (url.pathname.includes("notifications")) data = { notifications: [], unread: 0 }
    return route.fulfill({ json: data })
  })
  const page = await context.newPage()
  page.on("pageerror", error => errors.push(error.message))
  page.on("console", message => { if (/THREE.WebGLProgram|Error creating WebGL|INVALID_OPERATION|INVALID_ENUM/.test(message.text())) errors.push(message.text()) })
  return { context, page }
}
const openStudio = async page => {
  await page.goto("http://127.0.0.1:4182/admin/marcos")
  await page.getByRole("heading", { name: "Estudio de marcos 3D" }).waitFor({ timeout: 30000 })
}
const rendered = async page => {
  await page.waitForTimeout(180)
  await page.locator('.tq-cinematic-slot[data-visual-ready="true"]').waitFor({ timeout: 30000 })
}

try {
  const { context, page } = await setup()
  await openStudio(page); await rendered(page)
  assert.equal(await page.locator("canvas").count(), 1, "one shared WebGL surface")
  await page.screenshot({ path: `${output}/studio-desktop.png` })
  await page.getByRole("button", { name: "Reproducir inspección", exact: true }).click()
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="Tiempo de inspección"]').value) > .3)
  await page.getByRole("button", { name: "Pausar inspección", exact: true }).click()
  const paused = await page.getByRole("slider", { name: "Tiempo de inspección" }).inputValue()
  await page.waitForTimeout(200)
  assert.equal(await page.getByRole("slider", { name: "Tiempo de inspección" }).inputValue(), paused)
  await page.getByRole("button", { name: "Órbita de cámara, 2.6 segundos", exact: true }).click()
  await rendered(page)
  await page.screenshot({ path: `${output}/inspection-deployed.png` })
  await page.getByRole("button", { name: "Flor nocturna", exact: false }).first().click()
  await rendered(page)
  await page.getByRole("button", { name: "Perfil", exact: true }).click()
  await rendered(page)
  await page.screenshot({ path: `${output}/bloom-profile.png` })
  await page.getByRole("button", { name: "Guardar versión", exact: true }).click()
  await page.getByRole("status").filter({ hasText: "Versión guardada" }).waitFor()
  assert.equal(saved.pkg.scene.style, "bloom")
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "Exportar escena", exact: true }).click()
  const download = await downloadPromise, filePath = await download.path()
  const exported = JSON.parse(await readFile(filePath, "utf8"))
  assert.deepEqual(exported.pkg.scene, saved.pkg.scene)
  await page.getByRole("button", { name: "Atlas astral", exact: false }).first().click()
  await page.locator('input[type="file"]').setInputFiles(filePath)
  await page.getByRole("status").filter({ hasText: "Escena importada" }).waitFor()
  await page.reload(); await rendered(page)
  assert.ok(await page.getByRole("heading", { name: "Flor nocturna", exact: true }).count())
  await page.goto("http://127.0.0.1:4182/marcos")
  await page.getByRole("button", { name: /Explorar|Inspeccionar|Vista previa|Ver en 3D/i }).first().click()
  await rendered(page)
  await page.getByRole("button", { name: "Reproducir inspección", exact: true }).click()
  await page.keyboard.press("Escape")
  await page.locator('[role="dialog"]').waitFor({ state: "hidden" })
  await page.goto("http://127.0.0.1:4182/")
  await page.locator('.tq-orb-visual[data-visual-ready="true"]').waitFor({ timeout: 30000 })
  await page.getByRole("button", { name: "Tu género", exact: true }).click({ delay: 1800 })
  await page.getByRole("button", { name: "Apariencia", exact: true }).click()
  await page.getByRole("button", { name: "Explorar el orbe", exact: true }).click()
  await page.locator('[role="dialog"] .tq-visual-slot[data-visual-ready="true"]').waitFor({ timeout: 30000 })
  await page.screenshot({ path: `${output}/singularity-orb.png` })
  await page.getByRole("button", { name: "Activar el orbe", exact: true }).click()
  await page.waitForTimeout(250)
  await page.keyboard.press("Escape")
  await context.close()

  const mobile = await setup({ mobile: true })
  await openStudio(mobile.page); await rendered(mobile.page)
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await mobile.page.screenshot({ path: `${output}/studio-mobile.png` })
  await mobile.page.getByRole("button", { name: "Animación", exact: true }).click()
  await mobile.page.getByLabel("Pista", { exact: true }).selectOption("energy")
  await mobile.page.screenshot({ path: `${output}/studio-mobile-controls.png` })
  await mobile.context.close()

  const fallback = await setup({ essential: true })
  await openStudio(fallback.page)
  assert.equal(await fallback.page.locator("canvas").count(), 0)
  assert.equal(await fallback.page.getByRole("button", { name: "Reproducir inspección", exact: true }).isDisabled(), true)
  await fallback.page.screenshot({ path: `${output}/studio-essential.png` })
  await fallback.context.close()
  const reader = await setup({ admin: false })
  await reader.page.goto("http://127.0.0.1:4182/admin/marcos")
  await reader.page.waitForTimeout(1500)
  assert.equal(await reader.page.locator(".tq-studio").count(), 0)
  await reader.context.close()
  assert.deepEqual(errors, [])
  console.log("Visual browser QA passed: WebGL, inspector, pause/seek, save/export/import, mobile, essential and admin gate.")
  console.log(`Screenshots: ${output}`)
} catch (error) {
  for (const context of browser.contexts()) for (const [i, page] of context.pages().entries()) {
    await page.screenshot({ path: `${output}/failure-${i}.png` }).catch(() => {})
    console.error((await page.locator("body").innerText().catch(() => "")).slice(-1800))
  }
  throw error
} finally { await browser.close(); await server.close() }
