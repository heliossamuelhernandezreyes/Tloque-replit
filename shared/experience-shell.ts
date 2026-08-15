export const FIRST_BOOT_MIN_MS = 900
export const RETURNING_BOOT_MIN_MS = 240
export const BOOT_EXIT_MS = 520
export const SLOW_BOOT_MS = 4_000

const SHELL_EXACT_ROUTES = new Set([
  "/",
  "/library",
  "/profile",
  "/inbox",
  "/editions",
  "/admin",
])

const SHELL_ROUTE_PREFIXES = [
  "/book/",
  "/author/",
  "/claim/",
]

export function normalizeAppPath(location: string): string {
  const path = location.split(/[?#]/, 1)[0] || "/"
  if (path === "/") return path
  return path.endsWith("/") ? path.slice(0, -1) : path
}

/**
 * Declara las rutas que comparten la experiencia cósmica persistente.
 * Editor, lector, tarjetas, sorteo y talleres conservan sus superficies
 * especializadas y nunca reciben navegación duplicada.
 */
export function usesExperienceShell(location: string): boolean {
  const path = normalizeAppPath(location)
  return SHELL_EXACT_ROUTES.has(path)
    || SHELL_ROUTE_PREFIXES.some(prefix => path.startsWith(prefix))
}

export function minimumBootDuration(hasBootedThisSession: boolean): number {
  return hasBootedThisSession ? RETURNING_BOOT_MIN_MS : FIRST_BOOT_MIN_MS
}
