import { useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchCurrentUser, type AuthUser } from "@/lib/authClient"

export type { AuthUser } from "@/lib/authClient"

const AUTH_KEY = ["/api/auth/me"]

export function useAuth() {
  const queryClient = useQueryClient()

  const { data: user, error, isError, isLoading, refetch } = useQuery<AuthUser | null>({
    queryKey: AUTH_KEY,
    queryFn: () => fetchCurrentUser(),
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
    refreshAuth:     () => queryClient.invalidateQueries({ queryKey: AUTH_KEY }),
    retryAuth:       () => refetch(),
    loginWithGoogle: () => { window.location.href = "/api/auth/google" },
    logout:          async () => {
      try {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
      } finally {
        queryClient.setQueryData(AUTH_KEY, null)
        window.location.href = "/"
      }
    },
  }
}
