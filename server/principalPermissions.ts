import { ADMIN_CAPABILITIES, permissionsForRole, type AdminCapability } from "../shared/admin-permissions"

// Only server-resolved request principals enter this map. Neither body fields,
// serialized sessions nor an isAdmin property can confer a permission.
const permissions = new WeakMap<object, ReadonlySet<AdminCapability>>()

export function resolvePrincipalPermissions(user: object, role: unknown, founder: boolean): void {
  permissions.set(user, new Set(founder ? ADMIN_CAPABILITIES : permissionsForRole(role)))
}
export function hasCapability(user: unknown, capability: AdminCapability): boolean {
  return !!user && typeof user === "object" && !!permissions.get(user)?.has(capability)
}
export function isAdmin(user: unknown): boolean {
  return !!user && typeof user === "object" && !!permissions.get(user)?.size
}
