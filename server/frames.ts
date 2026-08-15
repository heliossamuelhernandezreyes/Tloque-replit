// Validación de marcos del Taller antes de guardarlos en la galería.
// El paquete viene del taller (postMessage) vía el admin; aun así se sanea.

const VALID_TARGETS = ["card", "profile", "both"] as const
const MAX_PKG_BYTES = 400_000   // el runtimePreset es ligero; 400 KB es holgado
const MAX_NAME = 60
const MAX_PRICE = 1000
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"])

function isSafeJsonTree(value: unknown, depth = 0, budget = { nodes: 0 }): boolean {
  if (++budget.nodes > 5_000 || depth > 14) return false
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return typeof value !== "string" || value.length <= 20_000
  }
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) {
    return value.length <= 1_000 && value.every(item => isSafeJsonTree(item, depth + 1, budget))
  }
  if (typeof value !== "object") return false
  const entries = Object.entries(value as Record<string, unknown>)
  return entries.length <= 300 && entries.every(([key, item]) =>
    key.length <= 100 && !FORBIDDEN_KEYS.has(key) && isSafeJsonTree(item, depth + 1, budget))
}

export function validateFrame(input: any): { ok: true; frame: any } | { ok: false; error: string } {
  const name = typeof input?.name === "string" ? input.name.trim().slice(0, MAX_NAME) : ""
  if (!name) return { ok: false, error: "El marco necesita un nombre" }

  let priceTinta = Number(input?.priceTinta)
  if (!Number.isFinite(priceTinta)) priceTinta = 0
  priceTinta = Math.max(0, Math.min(MAX_PRICE, Math.round(priceTinta)))

  const pkg = input?.pkg
  if (!pkg || typeof pkg !== "object") return { ok: false, error: "Falta el paquete del marco" }
  if (!isSafeJsonTree(pkg)) return { ok: false, error: "El paquete contiene una estructura no permitida" }
  let serialized = ""
  try { serialized = JSON.stringify(pkg) } catch { return { ok: false, error: "El paquete no es JSON válido" } }
  const size = Buffer.byteLength(serialized, "utf8")
  if (size > MAX_PKG_BYTES) return { ok: false, error: `El marco pesa demasiado (${Math.round(size/1024)} KB)` }
  const safePkg = JSON.parse(serialized)
  if (!safePkg.runtimePreset || typeof safePkg.runtimePreset !== "object") {
    return { ok: false, error: "Falta runtimePreset en el paquete" }
  }

  // target: la elección explícita al guardar gana; si no, la del paquete; si no, "both"
  const rawTarget = input?.target ?? safePkg?.runtimePreset?.target ?? safePkg?.target
  const target = VALID_TARGETS.includes(rawTarget) ? rawTarget : "both"

  const schemaVersion = typeof safePkg?.schemaVersion === "string" ? safePkg.schemaVersion.slice(0, 20) : "1.0.0"
  const fingerprint = typeof safePkg?.fingerprint === "string" ? safePkg.fingerprint.slice(0, 120) : ""

  return { ok: true, frame: { name, priceTinta, target, schemaVersion, fingerprint, pkg: safePkg } }
}
