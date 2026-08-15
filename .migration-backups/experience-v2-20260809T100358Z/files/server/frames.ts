// Validación de marcos del Taller antes de guardarlos en la galería.
// El paquete viene del taller (postMessage) vía el admin; aun así se sanea.

const VALID_TARGETS = ["card", "profile", "both"] as const
const MAX_PKG_BYTES = 400_000   // el runtimePreset es ligero; 400 KB es holgado
const MAX_NAME = 60
const MAX_PRICE = 1000

export function validateFrame(input: any): { ok: true; frame: any } | { ok: false; error: string } {
  const name = typeof input?.name === "string" ? input.name.trim().slice(0, MAX_NAME) : ""
  if (!name) return { ok: false, error: "El marco necesita un nombre" }

  let priceTinta = Number(input?.priceTinta)
  if (!Number.isFinite(priceTinta)) priceTinta = 0
  priceTinta = Math.max(0, Math.min(MAX_PRICE, Math.round(priceTinta)))

  const pkg = input?.pkg
  if (!pkg || typeof pkg !== "object") return { ok: false, error: "Falta el paquete del marco" }
  const size = Buffer.byteLength(JSON.stringify(pkg), "utf8")
  if (size > MAX_PKG_BYTES) return { ok: false, error: `El marco pesa demasiado (${Math.round(size/1024)} KB)` }

  // target: la elección explícita al guardar gana; si no, la del paquete; si no, "both"
  const rawTarget = input?.target ?? pkg?.runtimePreset?.target ?? pkg?.target
  const target = VALID_TARGETS.includes(rawTarget) ? rawTarget : "both"

  const schemaVersion = typeof pkg?.schemaVersion === "string" ? pkg.schemaVersion.slice(0, 20) : "1.0.0"
  const fingerprint = typeof pkg?.fingerprint === "string" ? pkg.fingerprint.slice(0, 120) : ""

  return { ok: true, frame: { name, priceTinta, target, schemaVersion, fingerprint, pkg } }
}
