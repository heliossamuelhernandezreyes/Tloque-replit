export const ADMIN_CAPABILITIES = [
  "manageCatalog", "manageFrames", "manageAudioCatalog",
  "manageFinance", "manageAdmins", "runDiagnostics",
] as const
export type AdminCapability = typeof ADMIN_CAPABILITIES[number]

export const ADMIN_ROLES = ["catalog", "visual", "audio", "finance", "access", "full"] as const
export type AdminRole = typeof ADMIN_ROLES[number] | "legacy"
export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  catalog: "Catálogo y manuscritos", visual: "Marcos y recursos visuales",
  audio: "Audio y diagnóstico", finance: "Pagos y liquidaciones",
  access: "Gestión de permisos", full: "Administración completa",
  legacy: "Permisos anteriores · revisar",
}
const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminCapability[]> = {
  catalog: ["manageCatalog"],
  visual: ["manageFrames"],
  audio: ["manageAudioCatalog", "runDiagnostics"],
  finance: ["manageFinance"],
  access: ["manageAdmins"],
  full: ADMIN_CAPABILITIES,
  // Preserve existing operational access. Delegating access now requires an
  // explicit grant by the founder or an access manager.
  legacy: ADMIN_CAPABILITIES.filter(capability => capability !== "manageAdmins"),
}
export function permissionsForRole(role: unknown): readonly AdminCapability[] {
  return typeof role === "string" && Object.hasOwn(ROLE_PERMISSIONS, role)
    ? ROLE_PERMISSIONS[role as AdminRole] : []
}

/** Unknown administrative routes fail closed until a capability is assigned. */
export function administrativeCapability(path: string): AdminCapability | null {
  const segment = path.split("/")[3]
  if (segment === "admins") return "manageAdmins"
  if (["books", "authors", "gutenberg"].includes(segment)) return "manageCatalog"
  if (segment === "frames") return "manageFrames"
  if (["audio", "speech"].includes(segment)) return "manageAudioCatalog"
  if (["payouts", "payment-incidents", "gacha"].includes(segment)) return "manageFinance"
  return null
}
