import { useState, useRef, useEffect } from "react"
import { useLocation } from "wouter"
import { ArrowLeft, Activity } from "lucide-react"
import CollectibleCard from "@/components/CollectibleCard"
import { useAuth } from "@/hooks/useAuth"

// ─────────────────────────────────────────────────────────────
// LABORATORIO DEL PARPADEO — v2, ahora MIDE en vez de adivinar.
//
// Ya descartamos: las capas de composición, el 3D, los filtros, la GPU.
// (12 cartas con 300 capas corren lisas fuera de la app.)
//
// Lo que este panel mide, en vivo, sobre una carta REAL de Tloque:
//   · Renders de React por segundo  → si son ~60, algo re-renderiza en cada frame
//   · Remontajes                    → si sube, React está recreando el componente
//   · Peso de las imágenes en memoria → si es enorme, el navegador las descarta y recarga
//   · Recargas de imagen            → la prueba directa: ¿la imagen se está re-pidiendo?
//   · fps
// ─────────────────────────────────────────────────────────────

export default function FlickerLab() {
  const [, setLocation] = useLocation()
  const { isAdmin } = useAuth()
  const [cards, setCards] = useState<any[]>([])
  const [sel, setSel] = useState(0)

  // ── Los medidores ──
  const renders = useRef(0)
  const mounts = useRef(0)
  const imgLoads = useRef(0)
  const [stats, setStats] = useState({
    rps: 0, fps: 0, mounts: 0, imgLoads: 0, imgMem: 0, imgs: [] as string[],
  })

  renders.current++   // cada render de ESTE componente

  // Cargar una carta real del catálogo
  useEffect(() => {
    fetch("/api/cards/collection", { credentials: "include" })
      .then(r => r.ok ? r.json() : { cards: [] })
      .then(d => setCards(d.cards || d || []))
      .catch(() => {})
  }, [])

  // Medidor: renders/s, fps, y el PESO REAL de las imágenes en memoria
  useEffect(() => {
    let frames = 0
    let r0 = renders.current
    let t0 = performance.now()
    let raf = 0
    const tick = () => {
      frames++
      const now = performance.now()
      if (now - t0 >= 1000) {
        // Pesar las imágenes cargadas: ancho × alto × 4 bytes (RGBA descomprimido)
        const imgs = Array.from(document.querySelectorAll("img")) as HTMLImageElement[]
        let bytes = 0
        const desc: string[] = []
        for (const im of imgs) {
          if (im.naturalWidth) {
            bytes += im.naturalWidth * im.naturalHeight * 4
            desc.push(`${im.naturalWidth}×${im.naturalHeight}`)
          }
        }
        setStats({
          rps: renders.current - r0,
          fps: frames,
          mounts: mounts.current,
          imgLoads: imgLoads.current,
          imgMem: bytes,
          imgs: desc.slice(0, 6),
        })
        r0 = renders.current
        frames = 0
        t0 = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    // Espiar las recargas de imagen: si una imagen se re-pide, aquí se cuenta
    const obs = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === "attributes" && m.attributeName === "src") imgLoads.current++
        if (m.type === "childList") {
          m.addedNodes.forEach(n => {
            if (n instanceof HTMLImageElement) { mounts.current++; imgLoads.current++ }
          })
        }
      }
    })
    obs.observe(document.body, {
      subtree: true, childList: true, attributes: true, attributeFilter: ["src"],
    })
    return () => { cancelAnimationFrame(raf); obs.disconnect() }
  }, [])

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <p className="text-zinc-500 text-sm font-sans">Solo administradores.</p>
      </div>
    )
  }

  const card = cards[sel]
  const mb = (stats.imgMem / 1024 / 1024).toFixed(1)
  const memAlta = stats.imgMem > 60 * 1024 * 1024
  const rpsAlto = stats.rps > 10

  return (
    <div className="min-h-screen bg-zinc-950 pb-10">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
        <button onClick={() => setLocation("/library")}
          className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-sm font-semibold text-zinc-200" style={{ fontVariant: "small-caps" }}>
          Laboratorio · v2
        </h1>
        <Activity className="w-4 h-4 ml-auto text-amber-400/60" />
      </div>

      <p className="px-4 pt-3 text-[11px] text-zinc-500 font-sans leading-relaxed">
        Inclina el teléfono sobre la carta de abajo (una carta <b className="text-zinc-300">real</b> de
        tu colección) y mira los números en vivo.
      </p>

      {/* LOS MEDIDORES */}
      <div className="px-4 pt-4 grid grid-cols-2 gap-2">
        <Metric label="Renders / seg" value={stats.rps}
          danger={rpsAlto}
          hint={rpsAlto ? "¡ALTO! React re-renderiza mientras mueves" : "normal (React está quieto)"} />
        <Metric label="Cuadros / seg" value={stats.fps}
          danger={stats.fps < 40 && stats.fps > 0}
          hint={stats.fps < 40 ? "está perdiendo cuadros" : "fluido"} />
        <Metric label="Imágenes en memoria" value={`${mb} MB`}
          danger={memAlta}
          hint={memAlta ? "¡ENORME! El navegador las descartará" : "razonable"} />
        <Metric label="Recargas de imagen" value={stats.imgLoads}
          danger={stats.imgLoads > 20}
          hint={stats.imgLoads > 20 ? "¡se están recargando!" : "estables"} />
      </div>

      {stats.imgs.length > 0 && (
        <div className="px-4 pt-3">
          <p className="text-[9.5px] text-zinc-600 font-sans mb-1">Tamaño real de las imágenes cargadas:</p>
          <div className="flex flex-wrap gap-1.5">
            {stats.imgs.map((s, i) => {
              const [w, h] = s.split("×").map(Number)
              const grande = w * h > 4_000_000
              return (
                <span key={i} className="text-[10px] font-mono px-2 py-0.5 rounded"
                  style={{
                    background: grande ? "rgba(224,122,122,0.15)" : "rgba(255,255,255,0.05)",
                    color: grande ? "#e07a7a" : "#a1a1aa",
                  }}>
                  {s}{grande ? " ⚠" : ""}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* LA CARTA REAL */}
      <div className="px-10 py-6">
        {card ? (
          <CollectibleCard card={card} accentColor="#c9a84c" accentGlow="#c9a84c" zoomable={false} />
        ) : (
          <p className="text-[11px] text-zinc-600 font-sans text-center py-10">
            Cargando una carta de tu colección…
          </p>
        )}
      </div>

      {cards.length > 1 && (
        <div className="px-4 flex gap-1.5 flex-wrap">
          {cards.slice(0, 8).map((c, i) => (
            <button key={i} onClick={() => setSel(i)}
              className="text-[10px] px-2 py-1 rounded-lg font-sans"
              style={{
                background: i === sel ? "rgba(201,168,76,0.2)" : "rgba(255,255,255,0.04)",
                color: i === sel ? "#e6cd82" : "#71717a",
              }}>
              {c.name?.slice(0, 12) || `#${i + 1}`}
            </button>
          ))}
        </div>
      )}

      <div className="mx-4 mt-6 p-3 rounded-xl text-[10.5px] font-sans leading-relaxed"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
        <b className="text-zinc-400">Cómo leerlo:</b><br />
        <span className="text-zinc-500">
          · <b>Renders/seg alto</b> (más de 10) mientras inclinas → React re-renderiza en cada
          movimiento. Ese es el bug.<br />
          · <b>Imágenes en memoria enorme</b> (más de 60 MB) → el navegador las descarta y recarga.
          Ese es el parpadeo.<br />
          · <b>Recargas de imagen subiendo</b> → confirmación directa: la imagen se está re-pidiendo.<br />
          · <b>Todo normal y aun así parpadea</b> → el problema está fuera de la carta.
        </span>
      </div>
    </div>
  )
}

function Metric({ label, value, hint, danger }: {
  label: string; value: any; hint: string; danger?: boolean
}) {
  return (
    <div className="rounded-xl px-3 py-2.5"
      style={{
        background: danger ? "rgba(224,122,122,0.1)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${danger ? "rgba(224,122,122,0.3)" : "rgba(255,255,255,0.08)"}`,
      }}>
      <p className="text-[9.5px] text-zinc-500 font-sans">{label}</p>
      <p className="text-[20px] font-display font-bold tabular-nums"
        style={{ color: danger ? "#e07a7a" : "#e4e4e7" }}>
        {value}
      </p>
      <p className="text-[9px] font-sans" style={{ color: danger ? "#e07a7a" : "#52525b" }}>
        {hint}
      </p>
    </div>
  )
}
