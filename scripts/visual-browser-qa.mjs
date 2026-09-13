import { createRequire } from "node:module"
import { mkdir, readFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { resolve } from "node:path"
import { createServer } from "vite"
import { createFrameScene, packageFrameScene } from "../shared/frame-scene.ts"
import { validateFrame } from "../server/frames.ts"
import { validateCard } from "../server/cards.ts"

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
const cards = []
let savedCard = null
const user = { id: 9001, email: "fixture@example.test", name: "Visual QA", avatar: "", isAdmin: true, persona: "admin", subscription: { plan: "aesthetic", status: "active", expiresAt: null }, visualEntitlements: { themes: ["singularity", "fluorescent-rose"], expiresAt: null } }

async function setup({ mobile = false, essential = false, admin = true } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 })
  context.setDefaultTimeout(30000)
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
    } else if (url.pathname === "/api/cards/loose") data = { cards }
    else if (url.pathname === "/api/cards" && route.request().method() === "POST" || /^\/api\/cards\/\d+$/.test(url.pathname) && route.request().method() === "PUT") {
      const checked = validateCard(route.request().postDataJSON())
      if (!checked.ok) return route.fulfill({ status: 400, json: { message: checked.message } })
      savedCard = { ...checked.card, id: 301, owned: true }
      cards.splice(0, cards.length, savedCard); data = savedCard
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
const slider = async (page, label, value) => {
  await page.getByRole("slider", { name: label, exact: true }).evaluate((element, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, String(value))
    element.dispatchEvent(new Event("input", { bubbles: true }))
    element.dispatchEvent(new Event("change", { bubbles: true }))
  }, value)
}
async function cardEditor(page, create = true) {
  await page.goto("http://127.0.0.1:4182/tarjetas")
  if (create) {
    await page.getByRole("button", { name: "Nueva tarjeta", exact: true }).click()
    await page.getByPlaceholder("Nombre (ej. Hall)").fill("Portal de prueba")
    // Synthetic local artwork for QA, not a bundled or licensed art asset.
    const assets = await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 700; canvas.height = 980
      const ctx = canvas.getContext("2d")
      const gradient = ctx.createLinearGradient(0, 0, 700, 980); gradient.addColorStop(0, "#06112f"); gradient.addColorStop(1, "#381049")
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 700, 980)
      ctx.fillStyle = "#d4c5a0"
      for (let i = 0; i < 100; i++) ctx.fillRect((i * 113) % 700, (i * 173) % 980, 2, 2)
      const back = canvas.toDataURL("image/png")
      ctx.clearRect(0, 0, 700, 980)
      const glow = ctx.createRadialGradient(350, 450, 50, 350, 450, 270); glow.addColorStop(0, "#d9bfea"); glow.addColorStop(.62, "#765abb"); glow.addColorStop(1, "#765abb00")
      ctx.fillStyle = glow; ctx.fillRect(0, 0, 700, 980)
      ctx.fillStyle = "#10142e"; ctx.beginPath(); ctx.arc(350, 430, 115, 0, Math.PI * 2); ctx.fill()
      return { back, front: canvas.toDataURL("image/webp", .9) }
    })
    await page.getByLabel("Fondo (obligatorio)", { exact: true }).setInputFiles({ name: "back.png", mimeType: "image/png", buffer: Buffer.from(assets.back.split(",")[1], "base64") })
    await page.getByText(/Imagen opaca · recorta/).waitFor()
    await page.getByLabel("Capa frontal (opcional)", { exact: true }).setInputFiles({ name: "front.webp", mimeType: "image/webp", buffer: Buffer.from(assets.front.split(",")[1], "base64") })
    await page.getByText(/Transparencia conservada/).waitFor()
  } else await page.getByRole("button", { name: "Editar Portal de prueba", exact: true }).click()
  await page.getByRole("button", { name: "Dirigir escena y animación", exact: true }).click()
  await page.getByRole("dialog", { name: "Dirección de tarjeta", exact: true }).waitFor()
}

try {
  console.log("QA: frames desktop")
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

  console.log("QA: frames mobile")
  const mobile = await setup({ mobile: true })
  await openStudio(mobile.page); await rendered(mobile.page)
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await mobile.page.screenshot({ path: `${output}/studio-mobile.png` })
  await mobile.page.getByRole("button", { name: "Animación", exact: true }).click()
  await mobile.page.getByLabel("Pista", { exact: true }).selectOption("energy")
  await mobile.page.screenshot({ path: `${output}/studio-mobile-controls.png` })
  await mobile.context.close()

  console.log("QA: card direction, import and save")
  const director = await setup()
  await cardEditor(director.page); await rendered(director.page)
  assert.equal(await director.page.locator("canvas").count(), 1)
  await director.page.getByLabel("Capa activa", { exact: true }).selectOption("front")
  await slider(director.page, "Posición X de capa", .12)
  await director.page.getByRole("button", { name: "Revelación", exact: false }).click()
  await director.page.getByLabel("Acabado de tarjeta", { exact: true }).selectOption("prismatic")
  await director.page.getByRole("button", { name: "Reproducir inspección", exact: true }).click()
  await director.page.waitForFunction(() => Number(document.querySelector('[aria-label="Tiempo de inspección"]').value) > .3)
  await director.page.getByRole("button", { name: "Pausar inspección", exact: true }).click()
  const cardPause = await director.page.getByLabel("Tiempo de inspección", { exact: true }).inputValue()
  await director.page.waitForTimeout(200)
  assert.equal(await director.page.getByLabel("Tiempo de inspección", { exact: true }).inputValue(), cardPause)
  await director.page.getByRole("button", { name: "Primer plano, 3.84 segundos", exact: true }).click()
  await director.page.getByLabel("Curva de la clave", { exact: true }).selectOption("ease-out")
  await rendered(director.page)
  await director.page.screenshot({ path: `${output}/card-director-desktop.png` })
  const cardDownloadPromise = director.page.waitForEvent("download")
  await director.page.getByRole("button", { name: "Exportar dirección", exact: true }).click()
  const cardDownload = await cardDownloadPromise, cardRecipePath = await cardDownload.path()
  const cardRecipe = JSON.parse(await readFile(cardRecipePath, "utf8"))
  assert.equal(cardRecipe.scene.layers.front.transform.x, .12)
  assert.equal(cardRecipe.scene.finish.type, "prismatic")
  await director.page.getByRole("button", { name: "Viaje astral", exact: false }).click()
  await director.page.locator('.tq-card-director input[type="file"]').setInputFiles(cardRecipePath)
  await director.page.getByRole("status").filter({ hasText: "Dirección importada" }).waitFor()
  await director.page.getByRole("button", { name: "Usar esta dirección", exact: true }).click()
  await director.page.getByRole("button", { name: "Crear tarjeta", exact: true }).click()
  await director.page.getByRole("button", { name: "Editar Portal de prueba", exact: true }).waitFor()
  assert.deepEqual(savedCard.fx.scene, cardRecipe.scene)
  assert.equal(savedCard.fx.layers.mid, "", "front identity survives a missing middle layer")
  assert.ok(savedCard.fx.layers.front.startsWith("data:image/webp;base64,"))
  const alpha = await director.page.evaluate(async source => {
    const img = new Image(); img.src = source; await img.decode()
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height
    const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0)
    return ctx.getImageData(0, 0, 1, 1).data[3]
  }, savedCard.fx.layers.front)
  assert.equal(alpha, 0, "WebP transparency survives import and save")
  console.log("QA: saved card in reader inspector")
  await director.page.getByRole("button", { name: "Editar Portal de prueba", exact: true }).click()
  await director.page.getByRole("button", { name: "Portal de prueba", exact: true }).click()
  await rendered(director.page)
  await director.page.getByRole("button", { name: "Reproducir inspección", exact: true }).click()
  await director.page.waitForFunction(() => Number(document.querySelector('[aria-label="Tiempo de inspección"]').value) > .3)
  await director.page.getByRole("button", { name: "Pausar inspección", exact: true }).click()
  await slider(director.page, "Tiempo de inspección", 3.84)
  await director.page.screenshot({ path: `${output}/card-reader-inspection.png` })
  await director.page.keyboard.press("Escape")
  await director.page.locator('[role="dialog"]').waitFor({ state: "hidden" })
  await director.context.close()

  console.log("QA: card mobile and essential")
  const mobileCard = await setup({ mobile: true })
  await cardEditor(mobileCard.page, false); await rendered(mobileCard.page)
  assert.equal(await mobileCard.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await mobileCard.page.screenshot({ path: `${output}/card-director-mobile.png` })
  await mobileCard.page.getByLabel("Capa activa", { exact: true }).selectOption("front")
  await slider(mobileCard.page, "Posición X de capa", -.15)
  await mobileCard.page.getByRole("button", { name: "Deshacer dirección", exact: true }).click()
  assert.equal(Number(await mobileCard.page.getByLabel("Posición X de capa", { exact: true }).inputValue()), .12)
  await mobileCard.context.close()

  const essentialCard = await setup({ essential: true })
  await cardEditor(essentialCard.page, false)
  assert.equal(await essentialCard.page.locator("canvas").count(), 0)
  assert.equal(await essentialCard.page.getByRole("button", { name: "Reproducir inspección", exact: true }).isDisabled(), true)
  assert.equal(await essentialCard.page.getByTestId("card-scene-poster").locator("img").count(), 2)
  await essentialCard.context.close()

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
  console.log("Visual browser QA passed: WebGL, frame/card inspectors, pause/seek, save/export/import, alpha-preserving image preparation, mobile, essential and admin gate.")
  console.log(`Screenshots: ${output}`)
} catch (error) {
  for (const context of browser.contexts()) for (const [i, page] of context.pages().entries()) {
    await page.screenshot({ path: `${output}/failure-${i}.png` }).catch(() => {})
    console.error((await page.locator("body").innerText().catch(() => "")).slice(-1800))
  }
  throw error
} finally { await browser.close(); await server.close() }
