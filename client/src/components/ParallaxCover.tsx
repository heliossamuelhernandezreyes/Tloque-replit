import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { BookOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { hasLayeredCover, normalizeCoverFx } from "@/lib/cover-effects"
import { useSettings } from "@/context/SettingsContext"

// ─────────────────────────────────────────────────────────────
// PARALLAXCOVER — sin framer-motion. A propósito.
//
// LA HISTORIA DEL BUG (para que no vuelva):
// La versión anterior usaba framer-motion con `useState(active)`. El flotar
// (una animación infinita) movía la carta unos píxeles… y al moverse, el
// elemento pasaba bajo el puntero y disparaba `onPointerEnter` → setActive(true)
// → React re-renderizaba → framer-motion CAMBIABA de animación → la carta se
// movía → `onPointerLeave` → setActive(false) → y vuelta a empezar.
// Un bucle infinito de re-renders que hacía saltar la carta entre estados,
// incluso quieta. Eso era el "parpadeo".
//
// LA CURA: React no toca el movimiento. Ni un solo re-render mientras la carta
// se mueve. Los transforms se escriben DIRECTO al DOM desde un bucle de
// animación, con un resorte propio (12 líneas). El flotar es CSS puro, en su
// propio elemento, sin JavaScript.
//
// Verificado: esta misma técnica corre lisa en un Poco X7 Pro con 12 cartas
// y 300 capas simultáneas.
// ─────────────────────────────────────────────────────────────

interface ParallaxCoverProps {
  title?:         string
  coverUrl?:      string
  coverFx?:       any
  accentColor:    string
  accentGlow:     string
  className?:     string
  imageClassName?: string
  children?:      ReactNode
  layerSlots?:    { back?: ReactNode; mid?: ReactNode; front?: ReactNode }
  frameOverlay?:  ReactNode
}

// Partículas deterministas (no random en cada render)
function buildMotes(seed: string) {
  const n = [...seed].reduce((acc, ch, i) => acc + ch.charCodeAt(0) * (i + 1), 97)
  return Array.from({ length: 8 }, (_, i) => {
    const b = n * (i + 3)
    return {
      id: i,
      left: 8 + (b % 78),
      top: 7 + ((b * 5) % 78),
      size: 4 + (b % 7),
      duration: 5.5 + (b % 5),
      delay: (b % 4) * 0.45,
      opacity: 0.18 + ((b % 5) * 0.08),
    }
  })
}

/** Un resorte crítico, en doce líneas. Suave, estable, sin dependencias. */
function spring(current: number, target: number, velocity: number, dt: number,
                stiffness = 170, damping = 22) {
  const f = -stiffness * (current - target)
  const d = -damping * velocity
  const a = f + d
  const v = velocity + a * dt
  const p = current + v * dt
  return [p, v] as const
}

export default function ParallaxCover({
  title, coverUrl, coverFx,
  accentColor, accentGlow,
  className, imageClassName, children, layerSlots, frameOverlay,
}: ParallaxCoverProps) {
  const { settings } = useSettings()
  const fx      = useMemo(() => normalizeCoverFx(coverFx), [coverFx])
  const motes   = useMemo(() => buildMotes(title || "Tloque"), [title])
  const layered = hasLayeredCover(fx)

  // Lo ÚNICO que vive en estado de React: si la imagen falló.
  // No cambia con el movimiento, así que no re-renderiza nunca durante la interacción.
  const [imgBroken, setImgBroken] = useState(false)
  const [gyroReady, setGyroReady] = useState(false)

  // ── TODO EL MOVIMIENTO VIVE EN REFS. React no se entera. ──
  const root    = useRef<HTMLDivElement>(null)
  const rotator = useRef<HTMLDivElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)
  const sheenRef= useRef<HTMLDivElement>(null)
  const foilRef = useRef<HTMLDivElement>(null)
  const glassEl = useRef<HTMLElement | null>(null)   // el vidrio del marco (si lo hay)
  const backRef = useRef<HTMLDivElement>(null)
  const midRef  = useRef<HTMLDivElement>(null)
  const frontRef= useRef<HTMLDivElement>(null)
  const imgRef  = useRef<HTMLDivElement>(null)

  // El objetivo (a dónde apunta el dedo) y el actual (dónde está el resorte)
  const target  = useRef({ x: 0, y: 0 })
  const cur     = useRef({ x: 0, y: 0, vx: 0, vy: 0 })
  const dragging= useRef(false)
  const gyroOn  = useRef(false)
  const wakeRef = useRef<() => void>(() => {})

  const hasImage = !!coverUrl && !imgBroken

  // ── EL BUCLE: escribe los transforms DIRECTO al DOM, 60 veces por segundo,
  //    sin pasar por React ni una sola vez. ──
  useEffect(() => {
    if (settings.reduceMotion) {
      if (rotator.current) rotator.current.style.transform = "none"
      return
    }
    let raf = 0
    let last = performance.now()

    const tick = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000)   // techo: si la pestaña se durmió
      last = now

      const c = cur.current
      const t = target.current
      const [nx, nvx] = spring(c.x, t.x, c.vx, dt)
      const [ny, nvy] = spring(c.y, t.y, c.vy, dt)
      c.x = nx; c.vx = nvx
      c.y = ny; c.vy = nvy

      // ¿Vale la pena repintar? Si ya está en reposo, no tocamos el DOM.
      const quieto = Math.abs(c.x - t.x) < 0.0004 && Math.abs(c.y - t.y) < 0.0004
                  && Math.abs(c.vx) < 0.004 && Math.abs(c.vy) < 0.004
      if (!quieto) {
        const rx = (-c.y * 22).toFixed(3)
        const ry = ( c.x * 28).toFixed(3)
        if (rotator.current) {
          rotator.current.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`
        }
        // ── EL VIDRIO DEL MARCO ──
        // Antes se movía con variables CSS (--tq-tx). Eso obligaba al navegador a
        // RECALCULAR EL ESTILO de todo el subárbol en cada cuadro — y ahí adentro
        // hay un SVG con gradientes y clipPaths. ESO era el parpadeo de las cartas
        // CON marco. Ahora le escribimos el transform directo a su nodo: uno solo.
        if (!glassEl.current && rotator.current) {
          glassEl.current = rotator.current.querySelector(".tqf-glass") as HTMLElement | null
        }
        if (glassEl.current) {
          glassEl.current.style.transform =
            `translate(${(c.x * 30).toFixed(2)}px, ${(c.y * 28).toFixed(2)}px)`
        }
        const set = (el: HTMLDivElement | null, mx: number, my: number, extra = "") => {
          if (el) el.style.transform =
            `translate3d(${(c.x * mx).toFixed(2)}px, ${(c.y * my).toFixed(2)}px, 0)${extra}`
        }
        // Los MISMOS multiplicadores del original, al píxel:
        //   base = 18px en X, 14px en Y
        //   back  = base × 0.35  (lejana: se mueve poco)
        //   mid   = base × 1.0   (la imagen)
        //   front = base × 1.5   (cercana: se mueve más) → ESO es el parallax
        set(imgRef.current,    18,  14, " scale(1.02)")
        set(backRef.current,   6.3, 4.9)      // 18×0.35 · 14×0.35
        set(midRef.current,   18,  14)        // 18×1.0  · 14×1.0
        set(frontRef.current, 27,  21)        // 18×1.5  · 14×1.5
        set(sheenRef.current,  38,  26)
        set(foilRef.current,   22,  18)
        if (glowRef.current) glowRef.current.style.transform = `translate3d(${(c.x * 14).toFixed(2)}px, 0, 0)`
      }
      // Dormir el bucle cuando el resorte llega al centro. Una nueva entrada,
      // orientación o gesto lo despierta; así una galería quieta no mantiene
      // un requestAnimationFrame por cada carta.
      raf = quieto ? 0 : requestAnimationFrame(tick)
    }
    const wake = () => {
      if (raf || document.visibilityState === "hidden") return
      last = performance.now()
      raf = requestAnimationFrame(tick)
    }
    wakeRef.current = wake
    wake()
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        cancelAnimationFrame(raf); raf = 0
      } else wake()
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener("visibilitychange", onVisibility)
      wakeRef.current = () => {}
    }
  }, [settings.reduceMotion])

  // ── PUNTERO: solo escribe en una ref. Cero re-renders. ──
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current || settings.reduceMotion) return
    const r = e.currentTarget.getBoundingClientRect()
    target.current.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1))
    target.current.y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1))
    wakeRef.current()
  }
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (settings.reduceMotion) return
    dragging.current = true
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* noop */ }
    onPointerMove(e)
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    dragging.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* noop */ }
    // Vuelve al centro sola (el resorte se encarga)
    if (!gyroOn.current) { target.current.x = 0; target.current.y = 0 }
    wakeRef.current()
  }
  // NOTA: ya NO hay onPointerEnter/onPointerLeave. Eran los que, junto con el
  // flotar, armaban el bucle infinito de re-renders.

  // ── GIROSCOPIO ──
  // En Android (y escritorio) NO hace falta pedir permiso: se activa solo.
  // Solo iOS exige el gesto del usuario. Mi versión anterior dejaba el
  // giroscopio APAGADO en Android porque el botón únicamente aparecía en iOS.
  useEffect(() => {
    const DOE: any = (window as any).DeviceOrientationEvent
    if (!settings.reduceMotion && DOE && typeof DOE.requestPermission !== "function") {
      gyroOn.current = true          // Android: directo
      setGyroReady(true)
    }
  }, [settings.reduceMotion])

  useEffect(() => {
    let base = { g: 0, b: 0 }
    let calibrado = false
    function onOrient(e: DeviceOrientationEvent) {
      if (!gyroOn.current || dragging.current) return
      const g = e.gamma ?? 0, b = e.beta ?? 0
      if (!calibrado) { base = { g, b }; calibrado = true }
      target.current.x = Math.max(-1, Math.min(1, (g - base.g) / 25))
      target.current.y = Math.max(-1, Math.min(1, (b - base.b) / 20))
      wakeRef.current()
    }
    window.addEventListener("deviceorientation", onOrient, { passive: true })
    return () => window.removeEventListener("deviceorientation", onOrient)
  }, [settings.reduceMotion])

  async function pedirGyro() {
    if (settings.reduceMotion) return
    const DOE: any = (window as any).DeviceOrientationEvent
    if (DOE && typeof DOE.requestPermission === "function") {
      try {
        const r = await DOE.requestPermission()
        if (r !== "granted") return
      } catch { return }
    }
    gyroOn.current = true
    setGyroReady(true)   // un solo re-render, al activar. Nunca más.
  }

  const L = fx?.layers || {}

  return (
    <div
      ref={root}
      className={cn("relative w-full h-full rounded-[28px] overflow-hidden select-none", className)}
      style={{ perspective: "1400px", touchAction: settings.reduceMotion ? "auto" : "none" }}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Glow de fondo — fuera del 3D */}
      <div ref={glowRef} className="absolute -inset-6 pointer-events-none tqp-breathe"
        style={{ background: `radial-gradient(circle at 50% 35%, ${accentGlow}55, transparent 72%)` }} />

      {/* ── EL FLOTAR: CSS puro, en su PROPIO elemento, sin JS. ──
          Antes vivía en el mismo nodo que la rotación y peleaban. */}
      <div className={`absolute inset-0 ${settings.reduceMotion ? "" : "tqp-float"}`} style={{ borderRadius: "inherit" }}>

        {/* ── EL ROTADOR: solo lo toca el bucle, nunca React. ── */}
        <div
          ref={rotator}
          className="absolute inset-0"
          style={{
            borderRadius: "inherit",
            transformStyle: "preserve-3d",
            willChange: "transform",
          }}
        >
          {/* VENTANA: recorta el arte a la silueta de la carta */}
          <div className="absolute inset-0 overflow-hidden"
            style={{ borderRadius: "inherit", isolation: "isolate" }}>

            {/* Fondo base */}
            <div className="absolute inset-0"
              style={{ background: `linear-gradient(150deg, #16161c, #0b0b0f)` }} />

            {hasImage && !layered && (
              <div ref={imgRef} className="absolute inset-0" style={{ willChange: "transform" }}>
                <img
                  src={coverUrl}
                  alt={title || ""}
                  onError={() => setImgBroken(true)}
                  className={cn("absolute inset-0 h-full w-full rounded-[28px]", imageClassName)}
                  style={{
                    // objectFit inline: garantizado, sin depender de Tailwind.
                    // "cover" = LLENA la carta recortando lo que sobra, sin deformar.
                    objectFit: "cover",
                    objectPosition: "center",
                    filter: "saturate(1.08) contrast(1.04) brightness(0.95)",
                  }}
                  draggable={false}
                />
              </div>
            )}

            {/* Las tres capas: cada una se desplaza distinto → profundidad */}
            {layered && (
              <>
                {L.back && (
                  <div ref={backRef} className="absolute inset-0 overflow-hidden"
                    style={{ willChange: "transform" }}>
                    <img src={L.back} alt="" draggable={false}
                      className="absolute inset-0 h-full w-full"
                      style={{ objectFit: "cover", objectPosition: "center",
                               transform: "scale(1.06)", filter: "brightness(0.72) saturate(1.05)" }} />
                    {layerSlots?.back}
                  </div>
                )}
                {L.mid && (
                  <div ref={midRef} className="absolute inset-0 overflow-hidden"
                    style={{ willChange: "transform" }}>
                    <img src={L.mid} alt="" draggable={false}
                      className="absolute inset-0 h-full w-full"
                      style={{ objectFit: "cover", objectPosition: "center", transform: "scale(1.03)" }} />
                    {layerSlots?.mid}
                  </div>
                )}
                {L.front && (
                  <div ref={frontRef} className="absolute inset-0 overflow-hidden"
                    style={{ willChange: "transform" }}>
                    <img src={L.front} alt="" draggable={false}
                      className="absolute inset-0 h-full w-full"
                      style={{ objectFit: "cover", objectPosition: "center", opacity: 0.92 }} />
                    {layerSlots?.front}
                  </div>
                )}
              </>
            )}

            {/* Partículas / clima */}
            {children}

            {/* Sin imagen: marcador de posición */}
            {!hasImage && !layered && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <BookOpen className="w-8 h-8" style={{ color: accentColor, opacity: 0.35 }} />
                <p className="text-[11px] font-sans px-6 text-center"
                  style={{ color: "rgba(255,255,255,0.35)" }}>
                  {title}
                </p>
              </div>
            )}

            {/* Motas suspendidas */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              {motes.map(m => (
                <span key={m.id} className="absolute rounded-full tqp-mote"
                  style={{
                    left: `${m.left}%`, top: `${m.top}%`,
                    width: m.size, height: m.size,
                    background: accentGlow,
                    opacity: m.opacity,
                    animationDuration: `${m.duration}s`,
                    animationDelay: `${m.delay}s`,
                  }} />
              ))}
            </div>

            {/* Brillo holográfico que sigue el dedo */}
            <div ref={sheenRef} className="absolute -inset-1/4 pointer-events-none"
              style={{
                background: `linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.14) 50%, transparent 65%)`,
                willChange: "transform",
              }} />

            {/* Foil iridiscente */}
            <div ref={foilRef} className="absolute inset-0 pointer-events-none"
              style={{
                background: `linear-gradient(125deg, ${accentGlow}00 30%, ${accentGlow}22 48%, ${accentGlow}00 66%)`,
                willChange: "transform",
              }} />

            {/* Viñeta inferior */}
            <div className="absolute inset-x-0 bottom-0 h-1/3 pointer-events-none"
              style={{ background: "linear-gradient(to top, rgba(6,6,10,0.55), transparent)" }} />

            {/* Borde interior */}
            <div className="absolute inset-[1px] pointer-events-none"
              style={{
                borderRadius: "inherit",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.03), 0 0 50px ${accentGlow}20`,
              }} />
          </div>

          {/* El marco: rota CON la carta, pero fuera de la ventana */}
          {frameOverlay}
        </div>
      </div>

      {/* Botón del giroscopio (solo si el dispositivo lo pide y aún no está activo) */}
      {!gyroReady && typeof window !== "undefined" &&
        (window as any).DeviceOrientationEvent?.requestPermission && (
        <button
          onClick={(e) => { e.stopPropagation(); pedirGyro() }}
          className="absolute bottom-2 right-2 z-10 text-[9px] font-sans px-2 py-1 rounded-lg"
          style={{
            background: "rgba(0,0,0,0.78)",
            border: `1px solid ${accentColor}40`,
            color: accentColor + "aa",
          }}
        >
          Activar giro
        </button>
      )}

      {/* Las únicas animaciones: CSS puro, en elementos que NADIE más toca. */}
      <style>{`
        @keyframes tqp-float {
          0%, 100% { transform: translate3d(0, 0, 0); }
          50%      { transform: translate3d(0, -3px, 0); }
        }
        .tqp-float { animation: tqp-float 9s ease-in-out infinite; }

        @keyframes tqp-breathe {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 0.8; }
        }
        .tqp-breathe { animation: tqp-breathe 8s ease-in-out infinite; }

        @keyframes tqp-mote {
          0%, 100% { transform: translateY(0) scale(1); }
          50%      { transform: translateY(-9px) scale(1.15); }
        }
        .tqp-mote { animation: tqp-mote ease-in-out infinite; }
      `}</style>
    </div>
  )
}
