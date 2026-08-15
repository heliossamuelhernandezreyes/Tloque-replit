import { useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"

interface Props {
  trigger:  boolean        // cuando cambia a true, dispara la animación
  color:    string         // color del género activo
  onDone?:  () => void
}

// Partículas individuales que explotan desde el ícono de bookmark
const PARTICLE_COUNT = 14

interface Particle {
  id:     number
  angle:  number   // dirección en radianes
  dist:   number   // distancia final
  size:   number
  delay:  number
}

function generateParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    id:    i,
    angle: (Math.PI * 2 * i) / PARTICLE_COUNT + (Math.random() - 0.5) * 0.4,
    dist:  28 + Math.random() * 22,
    size:  2 + Math.random() * 3,
    delay: Math.random() * 0.06,
  }))
}

const particles = generateParticles()

export default function BookmarkBurst({ trigger, color, onDone }: Props) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (trigger && onDone) {
      timerRef.current = setTimeout(onDone, 700)
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [trigger, onDone])

  return (
    <AnimatePresence>
      {trigger && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {particles.map(p => {
            const tx = Math.cos(p.angle) * p.dist
            const ty = Math.sin(p.angle) * p.dist

            return (
              <motion.div
                key={p.id}
                initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
                animate={{
                  x:       tx,
                  y:       ty,
                  scale:   [0, 1.4, 0.8, 0],
                  opacity: [1, 1, 0.6, 0],
                }}
                transition={{
                  duration: 0.55,
                  delay:    p.delay,
                  ease:     "easeOut",
                }}
                className="absolute rounded-full"
                style={{
                  width:     p.size,
                  height:    p.size,
                  background: color,
                  boxShadow:  `0 0 ${p.size * 2}px ${color}`,
                }}
              />
            )
          })}

          {/* flash central */}
          <motion.div
            initial={{ scale: 0, opacity: 0.8 }}
            animate={{ scale: 2.5, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="absolute w-6 h-6 rounded-full"
            style={{ background: `radial-gradient(circle, ${color}aa, transparent 70%)` }}
          />
        </div>
      )}
    </AnimatePresence>
  )
}
