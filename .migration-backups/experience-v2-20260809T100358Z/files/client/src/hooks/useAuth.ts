import { useQuery, useQueryClient } from "@tanstack/react-query"

export interface AuthUser {
  id:       number
  googleId: string
  email:    string
  name:     string
  avatar:   string
  isAdmin:  boolean  // viene del servidor — basado en tabla admins
}

const AUTH_KEY = ["/api/auth/me"]

export function useAuth() {
  const queryClient = useQueryClient()

  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: AUTH_KEY,
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { credentials: "include" })
      if (!res.ok) return null
      return res.json()
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
    isLoggedIn:      !!user,
    isAdmin:         !!user?.isAdmin,
    refreshAuth:     () => queryClient.invalidateQueries({ queryKey: AUTH_KEY }),
    loginWithGoogle: () => { window.location.href = "/api/auth/google" },
    logout:          () => { window.location.href = "/api/auth/logout" },
  }
}
