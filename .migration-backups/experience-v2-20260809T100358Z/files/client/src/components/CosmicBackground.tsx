import { useEffect, useRef } from "react"
import { useGenre } from "@/context/GenreContext"
import { useSettings } from "@/context/SettingsContext"

// Canvas-based particle system — mucho más eficiente que 50 motion.div
// Sin framer-motion, sin re-renders, todo en requestAnimationFrame

interface Particle {
  x:        number
  y:        number
  size:     number
  speed:    number
  opacity:  number
  maxOp:    number
  blur:     boolean
}

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return [r, g, b]
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

export default function CosmicBackground() {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const stateRef    = useRef({
    particles:   [] as Particle[],
    animId:      0,
    currentColor: [160, 160, 255] as [number,number,number],
    targetColor:  [160, 160, 255] as [number,number,number],
    colorT:      1,
    intensity:   0.7,
  })
  const { cfg }      = useGenre()
  const { settings } = useSettings()

  // Actualizar color objetivo cuando cambia el género
  useEffect(() => {
    stateRef.current.targetColor = hexToRgb(cfg.particle)
    stateRef.current.colorT = 0
  }, [cfg.particle])

  // Sincronizar intensidad desde settings
  useEffect(() => {
    stateRef.current.intensity = settings.cosmicIntensity
  }, [settings.cosmicIntensity])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const state = stateRef.current

    // Crear partículas iniciales distribuidas por toda la pantalla
    function createParticle(randomY = false): Particle {
      return {
        x:       Math.random() * canvas!.width,
        y:       randomY ? Math.random() * canvas!.height : -10,
        size:    Math.random() * 2 + 0.5,
        speed:   0.3 + Math.random() * 0.8,
        opacity: 0,
        maxOp:   0.15 + Math.random() * 0.45,
        blur:    Math.random() > 0.72,
      }
    }

    function resize() {
      canvas!.width  = window.innerWidth
      canvas!.height = window.innerHeight
    }

    resize()
    window.addEventListener("resize", resize)

    // Inicializar partículas ya en movimiento
    state.particles = Array.from({ length: 55 }, () => createParticle(true))

    let frame = 0

    function tick() {
      state.animId = requestAnimationFrame(tick)
      frame++

      // Interpolación de color (transición suave al cambiar género)
      if (state.colorT < 1) {
        state.colorT = Math.min(1, state.colorT + 0.008)
        state.currentColor = [
          lerp(state.currentColor[0], state.targetColor[0], state.colorT),
          lerp(state.currentColor[1], state.targetColor[1], state.colorT),
          lerp(state.currentColor[2], state.targetColor[2], state.colorT),
        ] as [number,number,number]
      }

      const [r, g, b] = state.currentColor

      ctx.clearRect(0, 0, canvas!.width, canvas!.height)

      for (const p of state.particles) {
        // Mover hacia abajo
        p.y += p.speed

        // Fade in al entrar
        if (p.opacity < p.maxOp) p.opacity = Math.min(p.maxOp, p.opacity + 0.004)
        // Fade out al salir
        if (p.y > canvas!.height * 0.85) {
          p.opacity = Math.max(0, p.opacity - 0.006)
        }
        // Resetear cuando sale
        if (p.y > canvas!.height + 10) {
          Object.assign(p, createParticle(false))
        }

        if (p.opacity <= 0) continue

        ctx.beginPath()
        // Simular blur con radio mayor y opacidad reducida — sin ctx.filter costoso
        const drawSize = p.blur ? p.size * 2.2 : p.size
        const intensity = stateRef.current.intensity ?? 0.7
        const drawOp   = (p.blur ? p.opacity * 0.55 : p.opacity) * intensity
        ctx.arc(p.x, p.y, drawSize, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${drawOp})`
        ctx.fill()
      }
    }

    tick()

    return () => {
      cancelAnimationFrame(state.animId)
      window.removeEventListener("resize", resize)
    }
  }, []) // Solo una vez — el color se maneja en stateRef

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 -z-40 pointer-events-none"
      style={{ width: "100%", height: "100%" }}
    />
  )
}
