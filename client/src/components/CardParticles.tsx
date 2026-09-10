import { useEffect, useRef } from "react"
import { useSettings } from "@/context/SettingsContext"
import { useReducedMotion } from "framer-motion"
import { boundedVisual } from "@shared/visual-experience"

export type ParticleEffect = "none" | "snow" | "rain" | "rainGlass" | "embers" | "fire" | "smoke" | "sparkle"

interface Props {
  effect:    ParticleEffect
  intensity: number          // 0..1 — densidad y velocidad
  className?: string
  tint?:     string          // color base (hex) para brasas/fuego/destellos
}

// Motor de partículas en <canvas> transparente. Cada efecto está afinado
// para sentirse natural y pesar poco. Se detiene si effect==="none".
export default function CardParticles({ effect, intensity: rawIntensity, className, tint = "#ffffff" }: Props) {
  const { settings } = useSettings()
  const systemReduced = useReducedMotion()
  const intensity = boundedVisual(rawIntensity, 0, 0, 1)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef    = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || effect === "none" || intensity <= 0 || settings.reduceMotion || systemReduced) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const canvasEl = canvas
    const context = ctx
    let visible = true
    let pageVisible = document.visibilityState !== "hidden"
    let previousFrame = 0

    let W = 0, H = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    function resize() {
      const r = canvasEl.getBoundingClientRect()
      W = r.width; H = r.height
      canvasEl.width = W * dpr; canvasEl.height = H * dpr
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const hex = tint.replace("#", "")
    const R = parseInt(hex.slice(0, 2) || "ff", 16)
    const G = parseInt(hex.slice(2, 4) || "ff", 16)
    const B = parseInt(hex.slice(4, 6) || "ff", 16)
    const rnd = (a: number, b: number) => a + Math.random() * (b - a)

    type P = any
    let parts: P[] = []
    let t = 0

    // Densidad base por efecto (algunos piden más/menos partículas)
    const density: Record<string, number> = {
      snow: 8 + intensity * 42, rain: 10 + intensity * 50, rainGlass: 3 + intensity * 10,
      embers: 8 + intensity * 40, fire: 20 + intensity * 60, smoke: 5 + intensity * 18,
      sparkle: 8 + intensity * 42,
    }
    const count = Math.round(density[effect] ?? 20)

    function spawn(kind: string, initial = false): P {
      const speed = 0.3 + intensity * 1.2
      switch (kind) {
        case "snow":
          return { x: rnd(0, W), y: initial ? rnd(0, H) : -4, vx: rnd(-0.2, 0.2),
                   vy: rnd(0.4, 1.1) * speed, size: rnd(1.2, 2.8), drift: rnd(0, 6.28) }
        case "rain":
          return { x: rnd(0, W), y: initial ? rnd(0, H) : -12, vx: rnd(-0.3, -0.1),
                   vy: rnd(6, 10) * speed, len: rnd(6, 12) }
        case "rainGlass":
          // Gotas que "golpean el vidrio": aparecen, crecen y resbalan
          return { x: rnd(0, W), y: rnd(0, H * 0.7), r: rnd(2, 5), life: 0,
                   maxLife: rnd(1.5, 3.5), slideAt: rnd(0.4, 0.7), vy: 0, trail: 0 }
        case "embers":
          return { x: rnd(0, W), y: initial ? rnd(0, H) : H + 4, vx: rnd(-0.4, 0.4),
                   vy: -rnd(0.5, 1.4) * speed, size: rnd(1.4, 3), life: 1, drift: rnd(0, 6.28) }
        case "fire":
          // Llamas: nacen abajo, suben rápido, se encogen y cambian de color
          return { x: rnd(W * 0.1, W * 0.9), y: H + rnd(0, 10), vx: rnd(-0.3, 0.3),
                   vy: -rnd(1.5, 3.5) * speed, size: rnd(6, 14), life: 1,
                   maxLife: rnd(0.5, 0.9), drift: rnd(0, 6.28), seed: rnd(0, 100) }
        case "smoke":
          return { x: rnd(W * 0.2, W * 0.8), y: H + rnd(0, 20), vx: rnd(-0.2, 0.2),
                   vy: -rnd(0.3, 0.8) * speed, size: rnd(20, 40), life: 1,
                   maxLife: rnd(0.6, 1), drift: rnd(0, 6.28) }
        default: // sparkle
          return { x: rnd(0, W), y: rnd(0, H), size: rnd(0.8, 2.2),
                   life: rnd(0, 1), maxLife: rnd(0.5, 1.2), drift: rnd(0, 6.28) }
      }
    }

    parts = Array.from({ length: count }, () => spawn(effect, true))

    function frame(now: number) {
      rafRef.current = 0
      if (!visible || !pageVisible) return
      if (previousFrame && now - previousFrame < 1000 / 60 - 1) { rafRef.current = requestAnimationFrame(frame); return }
      const dt = Math.min(.05, previousFrame ? (now - previousFrame) / 1000 : 1 / 60)
      previousFrame = now
      const step = dt * 60
      context.clearRect(0, 0, W, H)
      t += dt

      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]

        if (effect === "snow") {
          p.x += (p.vx + Math.sin(t + p.drift) * 0.3) * step; p.y += p.vy * step
          context.beginPath(); context.arc(p.x, p.y, p.size, 0, 6.28)
          context.fillStyle = `rgba(255,255,255,${0.5 + intensity * 0.4})`; context.fill()
          if (p.y > H + 4) parts[i] = spawn("snow")

        } else if (effect === "rain") {
          p.x += p.vx * step; p.y += p.vy * step
          context.beginPath(); context.moveTo(p.x, p.y); context.lineTo(p.x + p.vx * 1.5, p.y + p.len)
          context.strokeStyle = `rgba(180,200,230,${0.25 + intensity * 0.35})`; context.lineWidth = 1; context.stroke()
          if (p.y > H + 12) parts[i] = spawn("rain")

        } else if (effect === "rainGlass") {
          // Gota sobre el "vidrio": crece, luego resbala dejando reguero
          p.life += dt
          const prog = p.life / p.maxLife
          if (prog >= p.slideAt) { p.vy += 0.06 * step; p.y += p.vy * step; p.trail = Math.min(p.trail + 1.5 * step, 40) }
          const a = Math.min(1, prog < 0.15 ? prog / 0.15 : (prog > 0.9 ? (1 - prog) / 0.1 : 1)) * 0.7
          // reguero
          if (p.trail > 0) {
            const g = context.createLinearGradient(p.x, p.y - p.trail, p.x, p.y)
            g.addColorStop(0, `rgba(200,220,245,0)`)
            g.addColorStop(1, `rgba(200,220,245,${a * 0.4})`)
            context.strokeStyle = g; context.lineWidth = p.r * 0.8
            context.beginPath(); context.moveTo(p.x, p.y - p.trail); context.lineTo(p.x, p.y); context.stroke()
          }
          // cuerpo de la gota con brillo (parece pegada al vidrio)
          const grad = context.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.1, p.x, p.y, p.r)
          grad.addColorStop(0, `rgba(255,255,255,${a * 0.9})`)
          grad.addColorStop(0.4, `rgba(190,215,240,${a * 0.5})`)
          grad.addColorStop(1, `rgba(150,180,215,${a * 0.15})`)
          context.beginPath(); context.arc(p.x, p.y, p.r, 0, 6.28); context.fillStyle = grad; context.fill()
          if (p.life >= p.maxLife || p.y > H + 10) parts[i] = spawn("rainGlass")

        } else if (effect === "embers") {
          p.x += (p.vx + Math.sin(t * 1.5 + p.drift) * 0.4) * step; p.y += p.vy * step; p.life -= 0.006 * step
          const a = Math.max(0, p.life) * (0.5 + intensity * 0.4)
          const g = Math.round(G * (0.4 + p.life * 0.6))
          context.beginPath(); context.arc(p.x, p.y, p.size * Math.max(0, p.life), 0, 6.28)
          context.fillStyle = `rgba(${R},${g},${Math.round(B * 0.3)},${a})`
          context.shadowColor = `rgba(${R},${g},60,${a})`; context.shadowBlur = 4; context.fill(); context.shadowBlur = 0
          if (p.life <= 0 || p.y < -4) parts[i] = spawn("embers")

        } else if (effect === "fire") {
          // Llama realista: parpadeo lateral, sube, encoge, gradiente cálido
          p.life -= dt / p.maxLife
          p.x += (p.vx + Math.sin(t * 4 + p.seed) * 0.7) * step
          p.y += p.vy * (0.6 + p.life * 0.4) * step
          p.vy *= Math.pow(.99, step)
          const prog = 1 - p.life
          const size = p.size * (0.4 + p.life * 0.8)
          // color: amarillo→naranja→rojo→humo al morir
          let cr = 255, cg = Math.round(200 - prog * 140), cb = Math.round(40 - prog * 40)
          const a = Math.max(0, p.life) * (0.55 + intensity * 0.35)
          const grad = context.createRadialGradient(p.x, p.y, 0, p.x, p.y, size)
          grad.addColorStop(0, `rgba(255,${Math.min(255, cg + 60)},120,${a})`)
          grad.addColorStop(0.5, `rgba(${cr},${cg},${cb},${a * 0.8})`)
          grad.addColorStop(1, `rgba(${cr},${Math.round(cg * 0.4)},0,0)`)
          context.beginPath(); context.arc(p.x, p.y, size, 0, 6.28); context.fillStyle = grad
          context.shadowColor = `rgba(255,120,20,${a * 0.6})`; context.shadowBlur = 8; context.fill(); context.shadowBlur = 0
          if (p.life <= 0 || p.y < H * 0.15) parts[i] = spawn("fire")

        } else if (effect === "smoke") {
          p.life -= dt / p.maxLife
          p.x += (p.vx + Math.sin(t + p.drift) * 0.3) * step
          p.y += p.vy * step; p.size += 0.15 * step
          const a = Math.max(0, p.life) * (0.12 + intensity * 0.12)
          const grad = context.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size)
          grad.addColorStop(0, `rgba(120,120,130,${a})`)
          grad.addColorStop(1, `rgba(90,90,100,0)`)
          context.beginPath(); context.arc(p.x, p.y, p.size, 0, 6.28); context.fillStyle = grad; context.fill()
          if (p.life <= 0) parts[i] = spawn("smoke")

        } else {
          // sparkle
          p.life += 0.02 * step
          const phase = (Math.sin(p.life * 6.28 + p.drift) + 1) / 2
          const a = phase * (0.4 + intensity * 0.5)
          context.beginPath(); context.arc(p.x, p.y, p.size, 0, 6.28)
          context.fillStyle = `rgba(${R},${G},${B},${a})`; context.fill()
          if (p.life > p.maxLife * 6) parts[i] = spawn("sparkle")
        }
      }
      rafRef.current = requestAnimationFrame(frame)
    }

    const start = () => {
      if (!visible || !pageVisible || rafRef.current) return
      previousFrame = 0
      rafRef.current = requestAnimationFrame(frame)
    }
    start()

    // Una colección puede tener decenas de lienzos. Los que están fuera de la
    // pantalla no conservan un RAF ni consumen batería; al volver se reanudan.
    const visibilityObserver = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible) {
        resize()
        start()
      } else {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
        context.clearRect(0, 0, W, H)
      }
    }, { rootMargin: "100px 0px", threshold: 0.01 })
    visibilityObserver?.observe(canvasEl)
    const onVisibility = () => {
      pageVisible = document.visibilityState !== "hidden"
      if (pageVisible) start()
      else { cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
    }
    document.addEventListener("visibilitychange", onVisibility)

    const onResize = () => resize()
    window.addEventListener("resize", onResize)
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize)
    resizeObserver?.observe(canvasEl)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener("resize", onResize)
      document.removeEventListener("visibilitychange", onVisibility)
      visibilityObserver?.disconnect()
      resizeObserver?.disconnect()
    }
  }, [effect, intensity, tint, settings.reduceMotion, systemReduced])

  if (effect === "none" || intensity <= 0 || settings.reduceMotion || systemReduced) return null
  return (
    <canvas ref={canvasRef} className={className}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
  )
}
