export const ACCOUNT_HEADER = "X-Tloque-Account"
export const CLIENT_CONTEXT_HEADER = "X-Tloque-Client"
export const CLIENT_CONTEXT_VERSION = "accounts-v1"
export const ACCOUNT_MARKER = "tloque_active_account_v1"
export const accountDatabaseName = (id: string | number) => "tloque_account_" + id

export function accountContextError(expected: string | undefined, actual: number | null, write: boolean) {
  if (expected !== undefined && expected !== String(actual)) return "ACCOUNT_CHANGED"
  if (write && actual !== null && expected === undefined) return "ACCOUNT_CONTEXT_REQUIRED"
  return null
}
