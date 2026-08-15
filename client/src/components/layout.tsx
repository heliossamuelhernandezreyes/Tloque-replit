import CosmicBackground from "./CosmicBackground"
import OrbSystem from "./OrbSystem"
import { useLocation } from "wouter"
import { useGenre } from "@/context/GenreContext"
import { motion } from "framer-motion"
import AppHeader from "./AppHeader"

interface LayoutProps {
  children:  React.ReactNode
  hideOrbs?: boolean
}

const PAGES_WITH_OWN_HEADER = ["/editor", "/admin/fonoteca", "/admin/marcos", "/admin/diag"]

export function Layout({ children, hideOrbs = false }: LayoutProps) {
  const [location]        = useLocation()
  const { cfg, activeGenre } = useGenre()
  const hasOwnHeader      = PAGES_WITH_OWN_HEADER.some(p => location.startsWith(p))

  return (
    <div className="min-h-screen bg-black text-zinc-300 font-serif overflow-x-hidden">

      {/* fondo cósmico */}
      <CosmicBackground />

      {/* blob de color de género — reacciona al cambio */}
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

      {!hasOwnHeader && <AppHeader />}

      {/* contenido */}
      <main className={`relative w-full z-10 ${hasOwnHeader ? "" : "pt-[4.5rem] pb-40"}`}>
        {children}
      </main>

      {/* orbes */}
      {!hideOrbs && <OrbSystem />}
    </div>
  )
}
