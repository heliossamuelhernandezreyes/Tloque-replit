import { createContext, useContext, useState, useCallback, ReactNode } from "react"

// ── TIPOS ────────────────────────────────────────────────
// "todos" es el estado neutro — muestra todo sin filtrar por género
// Los demás son géneros reales con su propio color y carácter
export type Genre = "todos" | "melancolico" | "terror" | "fantasia" | "misterio" | "romance"
export type LobbyFilter = "all" | "short"

export interface GenreConfig {
  color:    string
  glow:     string
  label:    string   // label en español — fallback
  tKey:     string   // clave para t() — permite traducción dinámica
  bg:       string
  particle: string
}

export const GENRE_CONFIG: Record<Genre, GenreConfig> = {
  // "todos" — estado neutro, color blanco suave, no es un género
  todos:       { color: "#e0e0e0", glow: "#888888", label: "Todos",       tKey: "genreTodos",       bg: "rgba(200,200,200,0.06)", particle: "#cccccc" },
  melancolico: { color: "#8aabff", glow: "#3355dd", label: "Melancólico", tKey: "genreMelancolico", bg: "rgba(51,85,221,0.15)",   particle: "#6688ff" },
  terror:      { color: "#ff7070", glow: "#cc1111", label: "Terror",      tKey: "genreTerror",      bg: "rgba(204,17,17,0.15)",   particle: "#ff4444" },
  fantasia:    { color: "#ffe090", glow: "#cc8800", label: "Fantasía",    tKey: "genreFantasia",    bg: "rgba(204,136,0,0.15)",   particle: "#ffcc44" },
  misterio:    { color: "#cc99ff", glow: "#8833ee", label: "Misterio",    tKey: "genreMisterio",    bg: "rgba(136,51,238,0.15)",  particle: "#aa66ff" },
  romance:     { color: "#ffaadd", glow: "#dd2288", label: "Romance",     tKey: "genreRomance",     bg: "rgba(221,34,136,0.15)",  particle: "#ff66bb" },
}

// Géneros reales (sin "todos") — para el ciclo del orbe izquierdo
// El ciclo va: todos → melancolico → terror → fantasia → misterio → romance → todos
export const GENRES: Genre[] = [
  "todos", "melancolico", "terror", "fantasia", "misterio", "romance"
]

// Solo los géneros de contenido (sin "todos") — para filtros y etiquetas
export const CONTENT_GENRES: Exclude<Genre, "todos">[] = [
  "melancolico", "terror", "fantasia", "misterio", "romance"
]

// ── CONTEXTO ─────────────────────────────────────────────
interface GenreContextValue {
  activeGenre:  Genre
  lobbyFilter:  LobbyFilter
  cfg:          GenreConfig
  isFiltered:   boolean          // true cuando hay cualquier filtro activo
  cycleGenre:   () => void
  resetGenre:   () => void
  setFilter:    (f: LobbyFilter) => void
  toggleFilter: () => void
}

const GenreContext = createContext<GenreContextValue | null>(null)

export function GenreProvider({ children }: { children: ReactNode }) {
  const [activeGenre, setActiveGenre] = useState<Genre>("todos")
  const [lobbyFilter, setLobbyFilter] = useState<LobbyFilter>("all")

  const cfg        = GENRE_CONFIG[activeGenre]
  const isFiltered = activeGenre !== "todos" || lobbyFilter !== "all"

  const cycleGenre   = useCallback(() => {
    setActiveGenre(prev => GENRES[(GENRES.indexOf(prev) + 1) % GENRES.length])
  }, [])

  const resetGenre   = useCallback(() => setActiveGenre("todos"), [])
  const setFilter    = useCallback((f: LobbyFilter) => setLobbyFilter(f), [])
  const toggleFilter = useCallback(() => setLobbyFilter(p => p === "all" ? "short" : "all"), [])

  return (
    <GenreContext.Provider value={{
      activeGenre, lobbyFilter, cfg, isFiltered,
      cycleGenre, resetGenre, setFilter, toggleFilter,
    }}>
      {children}
    </GenreContext.Provider>
  )
}

export function useGenre(): GenreContextValue {
  const ctx = useContext(GenreContext)
  if (!ctx) throw new Error("useGenre debe usarse dentro de <GenreProvider>")
  return ctx
}
