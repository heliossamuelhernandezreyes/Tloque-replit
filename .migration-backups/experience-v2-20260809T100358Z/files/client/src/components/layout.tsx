import CosmicBackground from "./CosmicBackground"
import OrbSystem from "./OrbSystem"
import { useLocation } from "wouter"
import { useGenre } from "@/context/GenreContext"
import { motion } from "framer-motion"

interface LayoutProps {
  children:  React.ReactNode
  hideOrbs?: boolean
}

const PAGES_WITH_OWN_HEADER = ["/editor"]

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

      {/* logo */}
      {!hasOwnHeader && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[120] pointer-events-none">
          <p
            className="text-[13px] tracking-[0.3em] font-display font-semibold transition-colors duration-700"
            style={{ color: `${cfg.color}aa` }}
          >
            Tloque
          </p>
        </div>
      )}

      {/* contenido */}
      <main className={`relative w-full z-10 ${hasOwnHeader ? "" : "pt-16 pb-40"}`}>
        {children}
      </main>

      {/* orbes */}
      {!hideOrbs && <OrbSystem />}
    </div>
  )
}
