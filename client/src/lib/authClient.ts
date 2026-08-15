export interface AuthUser {
  id:          number
  email:       string
  name:        string
  avatar:      string
  banner:      string
  bio:         string
  frame:       string
  socialLinks: Record<string, string>
  isAdmin:     boolean
  persona:     "reader" | "author" | "admin"
  roles:       { reader: true; author: boolean; admin: boolean }
  capabilities: {
    createBooks: boolean
    manageOwnBooks: boolean
    manageEditions: boolean
    manageCatalog: boolean
    manageAudioCatalog: boolean
    manageFrames: boolean
    manageAdmins: boolean
    runDiagnostics: boolean
  }
  subscription: {
    plan: string
    status: string
    expiresAt: string | null
  }
}

export const AUTH_TIMEOUT_MS = 12_000

/**
 * Consulta la sesión sin permitir que una conexión o consulta atascada deje
 * toda la interfaz esperando indefinidamente. Un 401 es una sesión ausente;
 * otros fallos son indisponibilidad y no deben fingir que el usuario salió.
 */
export async function fetchCurrentUser(
  timeoutMs = AUTH_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthUser | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl("/api/auth/me", {
      credentials: "include",
      signal: controller.signal,
    })
    if (response.status === 401) return null
    if (!response.ok) throw new Error(`No se pudo verificar la sesión (${response.status})`)

    const payload: unknown = await response.json()
    if (payload === null) return null
    if (!payload || typeof payload !== "object"
        || !Number.isInteger((payload as any).id)
        || typeof (payload as any).email !== "string"
        || typeof (payload as any).name !== "string") {
      throw new Error("El servidor devolvió una sesión inválida")
    }
    return payload as AuthUser
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("La verificación de sesión tardó demasiado")
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
