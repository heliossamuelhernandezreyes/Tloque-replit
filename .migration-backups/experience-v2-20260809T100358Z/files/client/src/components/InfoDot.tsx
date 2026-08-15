import { useState, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Info } from "lucide-react"

interface Props {
  text:      string
  color?:    string
  size?:     number          // tamaño del ícono en px
  align?:    "left" | "right" | "center"
}

// Un puntito de información táctil: encapsula texto que estorbaría.
// Al tocarlo, revela el texto en una burbuja; toca fuera para cerrar.
// Pensado para móvil (funciona con tap, no requiere hover).
export default function InfoDot({ text, color = "rgba(255,255,255,0.4)", size = 14, align = "center" }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onOutside = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onOutside)
    document.addEventListener("touchstart", onOutside)
    return () => {
      document.removeEventListener("mousedown", onOutside)
      document.removeEventListener("touchstart", onOutside)
    }
  }, [open])

  const bubblePos =
    align === "left"  ? "left-0"
  : align === "right" ? "right-0"
  : "left-1/2 -translate-x-1/2"

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v) }}
        className="inline-flex items-center justify-center rounded-full transition-opacity"
        style={{ color, opacity: open ? 1 : 0.6 }}
        aria-label="Más información"
      >
        <Info style={{ width: size, height: size }} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className={`absolute z-[900] top-full mt-2 ${bubblePos} w-max max-w-[220px] px-3 py-2 rounded-xl pointer-events-none`}
            style={{
              background: "rgba(18,18,24,0.98)",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "0 8px 24px -6px rgba(0,0,0,0.6)",
            }}
          >
            <p className="text-[11px] font-sans leading-relaxed text-left"
              style={{ color: "rgba(255,255,255,0.8)" }}>
              {text}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
