import { lazy, Suspense, type ReactNode } from "react"
import { motion } from "framer-motion"
import { useLocation } from "wouter"
import { usesExperienceShell } from "@shared/experience-shell"
import { useGenre } from "@/context/GenreContext"

const AppHeader = lazy(() => import("./AppHeader"))
const CosmicBackground = lazy(() => import("./CosmicBackground"))
const OrbSystem = lazy(() => import("./OrbSystem"))

/**
 * El fondo, la navegación y los orbes viven fuera de cada página. De esta
 * forma no se destruyen y reconstruyen al navegar por el lobby, biblioteca,
 * perfiles o fichas de libro.
 */
export default function ExperienceShell({ children }: { children: ReactNode }) {
  const [location] = useLocation()
  const { cfg, activeGenre } = useGenre()
  const enabled = usesExperienceShell(location)

  return (
    <>
      {enabled && (
        <Suspense fallback={null}>
          <CosmicBackground />
          <motion.div
            key={activeGenre}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.2, ease: "easeInOut" }}
            className="fixed inset-0 -z-30 pointer-events-none"
            style={{
              background: `radial-gradient(ellipse 60% 50% at 50% 80%, ${cfg.glow}18, transparent 70%)`,
            }}
          />
          <AppHeader />
          <OrbSystem />
        </Suspense>
      )}
      {children}
    </>
  )
}
