import { useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchCurrentUser, type AuthUser } from "@/lib/authClient"
import { accountContext } from "@/lib/account-context"
import { ACCOUNT_HEADER } from "@shared/account-context"
import type { AdminCapability } from "@shared/admin-permissions"

export type { AuthUser } from "@/lib/authClient"

const AUTH_KEY = ["/api/auth/me"]

export function useAuth() {
  const queryClient = useQueryClient()

  const { data: user, error, isError, isLoading, refetch } = useQuery<AuthUser | null>({
    queryKey: AUTH_KEY,
    queryFn: async () => {
      const marker = accountContext.marker()
      const current = await fetchCurrentUser()
      accountContext.activate(current?.id ?? null, marker)
      return current
    },
    // Sin staleTime alto — isAdmin puede cambiar entre sesiones
    staleTime:          0,
    gcTime:             5 * 60 * 1000,
    retry:              false,
    refetchOnWindowFocus: true,
  })

  return {
    user:            user ?? null,
    isLoading,
    authError:       isError ? error : null,
    isLoggedIn:      !!user,
    isAdmin:         !!user?.isAdmin,
    can:             (capability: AdminCapability) => user?.capabilities?.[capability] === true,
    refreshAuth:     () => queryClient.invalidateQueries({ queryKey: AUTH_KEY }),
    retryAuth:       () => refetch(),
    loginWithGoogle: () => { window.location.href = "/api/auth/google" },
    logout:          async () => {
      const id = accountContext.requireId()
      // Freeze background sync before ending the session. The raw logout
      // request remains bound to this account, even if another tab logs in.
      accountContext.pauseRequests()
      try {
        await queryClient.cancelQueries()
        queryClient.removeQueries({ predicate: query => query.queryKey[0] !== AUTH_KEY[0] })
        const response = await fetch("/api/auth/logout", {
          method: "POST", credentials: "include", headers: { [ACCOUNT_HEADER]: id },
        })
        if (!response.ok && response.headers.get("X-Tloque-Session") !== "changed") {
          throw new Error("No se pudo cerrar la sesión. Inténtalo de nuevo.")
        }
        accountContext.end()
        queryClient.clear()
        window.location.href = "/"
      } catch (error) {
        accountContext.resumeRequests()
        throw error
      }
    },
  }
}
