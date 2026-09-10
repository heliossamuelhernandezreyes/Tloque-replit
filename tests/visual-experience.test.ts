import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  allowedOrbTheme, carouselPose, normalizeVisualQuality, ORB_THEMES, selectVisualEntries,
  visualBudget, visualColor, visualDpr, visualEntitlements, visualFrame, visualViewport, VISUAL_PIXEL_BUDGET,
} from "../shared/visual-experience"
import { VISUAL_STRINGS } from "../client/src/visual/visual-strings"

const now = Date.parse("2026-09-10T00:00:00Z")
const active = { subscriptionPlan: "estetic", subscriptionStatus: "active", subscriptionExpiresAt: "2026-10-10T00:00:00Z" }

test("el servidor concede la rosa sólo a planes activos o administración", () => {
  for (const subscriptionPlan of ["estetic", "audio"]) assert.deepEqual(visualEntitlements({ ...active, subscriptionPlan }, false, now).themes, ORB_THEMES)
  for (const subscriptionPlan of ["reader", "premium", null]) assert.deepEqual(visualEntitlements({ ...active, subscriptionPlan }, false, now).themes, ["singularity"])
  assert.deepEqual(visualEntitlements(null, true, now), { themes: [...ORB_THEMES], expiresAt: null })
})

test("la expiración y estados no activos fallan cerrados", () => {
  for (const subscriptionStatus of ["inactive", "canceled", "pending", null]) assert.equal(visualEntitlements({ ...active, subscriptionStatus }, false, now).themes.length, 1)
  for (const subscriptionExpiresAt of [new Date(now), "invalid", "2025-01-01"]) assert.equal(visualEntitlements({ ...active, subscriptionExpiresAt }, false, now).themes.length, 1)
  assert.equal(visualEntitlements({ ...active, subscriptionExpiresAt: null }, false, now).themes.length, 2)
})

test("una preferencia local nunca concede el tema premium", () => {
  assert.equal(allowedOrbTheme("fluorescent-rose", null, now), "singularity")
  assert.equal(allowedOrbTheme("fluorescent-rose", { themes: null, expiresAt: null } as any, now), "singularity")
  assert.equal(allowedOrbTheme("untrusted", visualEntitlements(null, true), now), "singularity")
  const entitlement = visualEntitlements(active, false, now)
  assert.equal(allowedOrbTheme("fluorescent-rose", entitlement, now), "fluorescent-rose")
  assert.equal(allowedOrbTheme("fluorescent-rose", entitlement, Date.parse(active.subscriptionExpiresAt)), "singularity")
})

test("calidad desconocida se normaliza a automática", () => {
  for (const value of [null, {}, "max", 10]) assert.equal(normalizeVisualQuality(value), "auto")
  for (const value of ["essential", "premium", "ultra"] as const) assert.equal(normalizeVisualQuality(value), value)
})

test("movimiento reducido impide activar WebGL incluso en Ultra", () => {
  for (const quality of ["auto", "essential", "premium", "ultra"] as const) assert.equal(visualBudget(quality, { reducedMotion: true }).enabled, false)
  assert.equal(visualBudget("essential").enabled, false)
  assert.equal(visualBudget("auto", { memory: 2 }).enabled, false)
  assert.equal(visualBudget("auto", { saveData: true }).enabled, false)
  assert.equal(visualBudget("auto", { memory: 4, cores: 4 }).dpr, 1)
  assert.equal(visualBudget("ultra").fps, 60)
  assert.equal(visualBudget("auto").fps, 30)
  assert.equal(visualBudget("ultra").maxViews, 3)
})

test("la superficie no excede su presupuesto ni en una pantalla 8K", () => {
  for (const [width, height] of [[390, 844], [1920, 1080], [3840, 2160], [7680, 4320]]) {
    const dpr = visualDpr(width, height, 3, 1.75)
    assert.ok(dpr <= 1.75 && dpr > 0)
    assert.ok(width * height * dpr * dpr <= VISUAL_PIXEL_BUDGET + 1)
  }
  assert.equal(visualDpr(390, 844, NaN, 1.4), 1)
})

test("un diálogo retira del render los libros y el orbe de fondo", () => {
  const entries = [{ id: "orb", priority: 20 }, { id: "book", priority: 10 }, { id: "card", priority: 100 }]
  assert.deepEqual(selectVisualEntries(entries, [], 3).selected.map(e => e.id), ["card"])
  assert.deepEqual(selectVisualEntries(entries.slice(0, 2), [{ priority: 100 }], 3).selected, [])
  assert.equal(selectVisualEntries(Array.from({ length: 30 }, () => ({ priority: 10 })), [], 3).selected.length, 3)
  assert.equal(entries[0].id, "orb", "no muta el orden del registro")
})

test("recorta una vista fuera de pantalla sin estirar su cámara", () => {
  assert.deepEqual(visualViewport({ left: -10, top: -20, right: 90, bottom: 180, width: 100, height: 200 }, 300, 400), { viewport: [-10, 220, 100, 200], scissor: [0, 220, 90, 180] })
  assert.equal(visualViewport({ left: 0, top: 410, right: 100, bottom: 500, width: 100, height: 90 }, 300, 400), null)
})

test("el abanico es simétrico, acotado y estable ante offsets inválidos", () => {
  assert.equal(carouselPose(0).scale, 1)
  for (const offset of [1, 2, 300]) {
    assert.equal(carouselPose(offset).scale, carouselPose(-offset).scale)
    assert.equal(carouselPose(offset).rotate, -carouselPose(-offset).rotate)
    assert.ok(carouselPose(offset).opacity >= .64)
    assert.ok(carouselPose(offset).scale >= .78)
  }
  assert.deepEqual(carouselPose(Infinity), carouselPose(0))
  assert.equal(carouselPose(2, true).rotate, 0)
  assert.equal(carouselPose(2, true).scale, 1)
})

test("materiales del taller son datos acotados, no código ni URLs", () => {
  const frame = visualFrame({ runtimePreset: { appearance: { material: { baseColor: "url(javascript:x)", metalness: Infinity, roughness: -3 }, geometry: { thickness: { top: 99999 } }, glass: { reflection: 10 } } } })
  assert.equal(frame.color, "#c9a84c")
  assert.equal(frame.metalness, .85)
  assert.equal(frame.roughness, .12)
  assert.equal(frame.thickness, .12)
  assert.equal(frame.glass, .4)
  assert.equal(visualColor("#f00"), "#c9a84c")
})

test("todos los idiomas tienen la misma interfaz visual completa", () => {
  const keys = Object.keys(VISUAL_STRINGS.es).sort()
  for (const strings of Object.values(VISUAL_STRINGS)) {
    assert.deepEqual(Object.keys(strings).sort(), keys)
    assert.ok(Object.values(strings).every(value => typeof value === "string" && value.trim().length > 0))
  }
})

test("el carrusel no escribe sobre el transform reservado a Embla", () => {
  const source = readFileSync("client/src/pages/home.tsx", "utf8")
  assert.match(source, /node\.querySelector<HTMLElement>\("\.fan-presentation"\)/)
  assert.doesNotMatch(source, /const node = nodes\[i\]/)
  assert.doesNotMatch(source, /emblaApi\?\.reInit\(\)/)
})

test("partículas usan delta real y se pausan cuando la pestaña se oculta", () => {
  const source = readFileSync("client/src/components/CardParticles.tsx", "utf8")
  assert.match(source, /now - previousFrame/)
  assert.doesNotMatch(source, /t \+= 0\.016/)
  assert.match(source, /removeEventListener\("visibilitychange", onVisibility\)/)
  assert.match(source, /p\.size \* Math\.max\(0, p\.life\)/)
})
