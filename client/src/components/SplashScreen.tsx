import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"

interface Props {
  onComplete: () => void
}

export default function SplashScreen({ onComplete }: Props) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const exitTimer = setTimeout(() => setVisible(false), 2600)
    const doneTimer = setTimeout(() => onComplete(), 3300)
    return () => {
      clearTimeout(exitTimer)
      clearTimeout(doneTimer)
    }
  }, [onComplete])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7, ease: "easeInOut" }}
          className="fixed inset-0 z-[999] bg-black flex items-center justify-center overflow-hidden"
        >
          <style>{`
            @keyframes tloqueShine {
              0%   { background-position: -150% center; }
              100% { background-position:  250% center; }
            }
            @keyframes tloqueGlow {
              0%, 100% { opacity: 0.12; transform: scale(1); }
              50%      { opacity: 0.26; transform: scale(1.25); }
            }
          `}</style>

          <div
            className="absolute rounded-full blur-3xl"
            style={{
              width: 420, height: 420,
              background: "radial-gradient(circle, rgba(220,220,235,0.18), transparent 70%)",
              animation: "tloqueGlow 4s ease-in-out infinite",
            }}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.9, filter: "blur(14px)" }}
            animate={{ opacity: 1, scale: 1,   filter: "blur(0px)"  }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 flex flex-col items-center gap-4 select-none"
          >
            <h1
              className="text-5xl sm:text-6xl font-display font-bold"
              style={{
                letterSpacing: "0.18em",
                backgroundImage:
                  "linear-gradient(110deg, #6e6e76 0%, #b8b8c2 18%, #ffffff 42%, #f2f2f7 50%, #c4c4cf 60%, #8a8a93 80%, #5c5c64 100%)",
                backgroundSize: "250% auto",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                WebkitTextFillColor: "transparent",
                animation: "tloqueShine 3.4s linear infinite",
                filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.5)) drop-shadow(0 0 22px rgba(200,200,225,0.25))",
              }}
            >
              Tloque
            </h1>

            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 64, opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.7, ease: "easeOut" }}
              className="h-px rounded-full"
              style={{
                background: "linear-gradient(to right, transparent, rgba(210,210,225,0.6), transparent)",
              }}
            />

            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8, duration: 0.6 }}
              className="text-[10px] tracking-[0.4em] uppercase font-sans"
              style={{ color: "rgba(200,200,215,0.35)" }}
            >
              narrativas que permanecen
            </motion.p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
