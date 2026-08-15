import { useQuery } from "@tanstack/react-query"

export interface GalleryFrame {
  id: number
  name: string
  priceTinta: number
  target: string          // "card" | "profile" | "both"
  pkg: any                // paquete del taller (trae el runtimePreset)
  owned: boolean          // desbloqueado por el usuario (o gratuito)
  available: boolean      // visible en la galería; los retirados aún renderizan
  createdAt: string
}

// La galería de marcos, en una sola consulta compartida por toda la app
// (TanStack cachea por clave: la carta, el editor y la galería la reusan).
export function useFrames() {
  const { data, isLoading } = useQuery<{ frames: GalleryFrame[] }>({
    queryKey: ["/api/frames"],
    queryFn: async () => {
      const res = await fetch("/api/frames", { credentials: "include" })
      if (!res.ok) return { frames: [] }
      return res.json()
    },
    staleTime: 60_000,
  })
  const allFrames = data?.frames || []
  const frames = allFrames.filter(frame => frame.available !== false)
  return {
    frames,
    isLoading,
    byId: (id?: number | null) => (id ? allFrames.find(f => f.id === id) : undefined),
    // Los que el autor puede usar ya (desbloqueados o gratis)
    usable: (target: "card" | "profile") =>
      frames.filter(f => f.owned && (f.target === target || f.target === "both")),
  }
}
