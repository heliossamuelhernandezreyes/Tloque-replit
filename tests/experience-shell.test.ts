import test from "node:test"
import assert from "node:assert/strict"
import {
  FIRST_BOOT_MIN_MS,
  RETURNING_BOOT_MIN_MS,
  minimumBootDuration,
  normalizeAppPath,
  usesExperienceShell,
} from "../shared/experience-shell"

test("el shell persistente cubre solo la experiencia general", () => {
  for (const route of [
    "/",
    "/library",
    "/profile",
    "/inbox",
    "/editions",
    "/admin",
    "/book/42",
    "/author/ursula",
    "/claim/TLQ-100",
  ]) {
    assert.equal(usesExperienceShell(route), true, `${route} debe usar el shell`)
  }

  for (const route of [
    "/editor",
    "/read/42/7",
    "/sorteo",
    "/tarjetas",
    "/marcos",
    "/admin/diag",
    "/admin/marcos",
    "/admin/fonoteca",
    "/desconocida",
  ]) {
    assert.equal(usesExperienceShell(route), false, `${route} conserva su superficie propia`)
  }
})

test("query, hash y barra final no alteran la selección del shell", () => {
  assert.equal(normalizeAppPath("/library/?genre=fantasia#catalog"), "/library")
  assert.equal(usesExperienceShell("/library/?genre=fantasia#catalog"), true)
  assert.equal(usesExperienceShell("/editor/?chapter=1"), false)
})

test("la carga inicial es deliberada y las siguientes son breves", () => {
  assert.equal(minimumBootDuration(false), FIRST_BOOT_MIN_MS)
  assert.equal(minimumBootDuration(true), RETURNING_BOOT_MIN_MS)
  assert.ok(FIRST_BOOT_MIN_MS > RETURNING_BOOT_MIN_MS)
  assert.ok(RETURNING_BOOT_MIN_MS >= 0)
})
