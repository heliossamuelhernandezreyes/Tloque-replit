import { useState, useRef, useEffect } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { useLocation } from "wouter"
import { Search, X } from "lucide-react"
import useOrbGestures from "../hooks/useOrbGestures"
import { useGenre } from "@/context/GenreContext"
import { useSettings } from "@/context/SettingsContext"
import { useSoundFX } from "@/hooks/useSoundFX"
import ConfigPanel from "./ConfigPanel"
import PulsoPanel  from "./PulsoPanel"
import { queryClient } from "@/lib/queryClient"

function storedList(key: string): any[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]")
    return Array.isArray(value) ? value : []
  } catch { return [] }
}

function storedValue(key: string): string | null {
  try { return localStorage.getItem(key) }
  catch { return null }
}

type BookSuggestion = {
  id: string | number
  title?: string
  author?: string
  genre?: string
  coverUrl?: string
}

// ─────────────────────────────────────────────────────────
// OJO CÓSMICO — orbe central (sin íconos, puro ojo)
// ─────────────────────────────────────────────────────────
function CosmicEye({
  color, glow, pulse, searchMode, animated,
}: {
  color: string; glow: string; pulse: boolean; searchMode: boolean; animated: boolean
}) {
  const cx = 38; const cy = 38

  const pupilPath = `
    M ${cx} ${cy - 13}
    C ${cx + 9} ${cy - 5}, ${cx + 9} ${cy + 5}, ${cx} ${cy + 13}
    C ${cx - 9} ${cy + 5}, ${cx - 9} ${cy - 5}, ${cx} ${cy - 13}
    Z
  `

  return (
    <svg
      width="76" height="76" viewBox="0 0 76 76"
      className="absolute inset-0 pointer-events-none"
      style={{ overflow: "visible" }}
    >
      <defs>
        <radialGradient id="iris-grad" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor={color} stopOpacity="0.04" />
          <stop offset="40%"  stopColor={color} stopOpacity="0.28" />
          <stop offset="72%"  stopColor={glow}  stopOpacity="0.50" />
          <stop offset="100%" stopColor={glow}  stopOpacity="0.10" />
        </radialGradient>
        {/* Gradiente tornasol para modo búsqueda */}
        <radialGradient id="iris-search" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#88ccff" stopOpacity="0.08" />
          <stop offset="35%"  stopColor="#bb88ff" stopOpacity="0.45" />
          <stop offset="70%"  stopColor="#66dddd" stopOpacity="0.60" />
          <stop offset="100%" stopColor="#aabbff" stopOpacity="0.15" />
        </radialGradient>
        <radialGradient id="eye-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor={glow} stopOpacity="0.0"  />
          <stop offset="55%"  stopColor={glow} stopOpacity="0.10" />
          <stop offset="100%" stopColor={glow} stopOpacity="0.0"  />
        </radialGradient>
        <radialGradient id="pupil-grad" cx="38%" cy="32%" r="58%">
          <stop offset="0%"   stopColor="rgba(8,4,16,0.75)"  />
          <stop offset="100%" stopColor="rgba(0,0,0,0.97)"   />
        </radialGradient>
        <radialGradient id="iris-light" cx="32%" cy="28%" r="52%">
          <stop offset="0%"   stopColor={color} stopOpacity="0.50" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0"  />
        </radialGradient>
        <filter id="eye-glow">   <feGaussianBlur stdDeviation="2.2" /></filter>
        <filter id="iris-blur">  <feGaussianBlur stdDeviation="0.7" /></filter>
        <filter id="pupil-glow"> <feGaussianBlur stdDeviation="1.0" /></filter>
        <clipPath id="iris-clip"><circle cx={cx} cy={cy} r="26.5" /></clipPath>
      </defs>

      {/* Halo pulsante exterior */}
      <motion.circle cx={cx} cy={cy} r="44"
        fill="url(#eye-halo)"
        animate={animated ? { opacity: [0.45, 0.95, 0.45] } : { opacity: 0.62 }}
        transition={{ duration: 4.5, repeat: animated ? Infinity : 0, ease: "easeInOut" }}
      />

      {/* Halo adicional tornasol en modo búsqueda */}
      {searchMode && (
        <motion.circle cx={cx} cy={cy} r="36"
          fill="none"
          strokeWidth="1.5"
          initial={{ r: 30, strokeOpacity: 0 }}
          animate={animated ? {
            r: [30, 40, 30],
            strokeOpacity: [0.0, 0.5, 0.0],
            stroke: ["#88ccff", "#bb88ff", "#66dddd", "#88ccff"],
          } : { r: 34, strokeOpacity: 0.35, stroke: "#88ccff" }}
          transition={{ duration: 2.2, repeat: animated ? Infinity : 0, ease: "easeInOut" }}
        />
      )}

      {/* Iris base — tornasol en modo búsqueda */}
      <motion.circle cx={cx} cy={cy} r="28"
        fill={searchMode ? "url(#iris-search)" : "url(#iris-grad)"}
        stroke={searchMode ? "#bb88ff" : color}
        strokeOpacity={searchMode ? 0.7 : 0.35} strokeWidth="0.8"
        animate={searchMode && animated ? { strokeOpacity: [0.5, 0.9, 0.5] } : { strokeOpacity: searchMode ? 0.7 : 0.35 }}
        transition={{ duration: 1.8, repeat: animated ? Infinity : 0, ease: "easeInOut" }}
      />

      {/* Iris borde luminoso — más brillante en búsqueda */}
      <motion.circle cx={cx} cy={cy} r="28"
        fill="none"
        stroke={searchMode ? "#88ccff" : color}
        strokeOpacity={searchMode ? 0.50 : 0.20}
        strokeWidth={searchMode ? 5 : 3.5}
        filter="url(#eye-glow)"
        animate={searchMode && animated ? {
          stroke: ["#88ccff", "#bb88ff", "#66dddd", "#aabbff", "#88ccff"],
          strokeOpacity: [0.4, 0.7, 0.5, 0.8, 0.4],
        } : { stroke: searchMode ? "#88ccff" : color, strokeOpacity: searchMode ? 0.55 : 0.2 }}
        transition={{ duration: 3, repeat: animated ? Infinity : 0, ease: "easeInOut" }}
      />

      {/* Líneas del iris — rotación lenta */}
      <motion.g
        animate={{ rotate: animated ? 360 : 0 }}
        transition={{ duration: 45, repeat: animated ? Infinity : 0, ease: "linear" }}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
        clipPath="url(#iris-clip)"
      >
        {Array.from({ length: 14 }, (_, i) => {
          const a = (i * (360 / 14) * Math.PI) / 180
          return (
            <line key={i}
              x1={cx + 8 * Math.cos(a)}  y1={cy + 8 * Math.sin(a)}
              x2={cx + 27 * Math.cos(a)} y2={cy + 27 * Math.sin(a)}
              stroke={color} strokeOpacity="0.15" strokeWidth="0.5"
            />
          )
        })}
      </motion.g>

      {/* Contra-rotación — capa interior */}
      <motion.g
        animate={{ rotate: animated ? -360 : 0 }}
        transition={{ duration: 32, repeat: animated ? Infinity : 0, ease: "linear" }}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
        clipPath="url(#iris-clip)"
      >
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * 45 * Math.PI) / 180
          return (
            <line key={i}
              x1={cx + 14 * Math.cos(a)} y1={cy + 14 * Math.sin(a)}
              x2={cx + 27 * Math.cos(a)} y2={cy + 27 * Math.sin(a)}
              stroke={color} strokeOpacity="0.10" strokeWidth="0.4"
            />
          )
        })}
      </motion.g>

      {/* Luz interna del iris */}
      <ellipse cx={cx - 7} cy={cy - 9} rx="11" ry="15"
        fill="url(#iris-light)"
        filter="url(#iris-blur)"
        clipPath="url(#iris-clip)"
      />

      {/* Pupila vertical — se dilata suavemente */}
      <motion.path
        d={pupilPath}
        fill="url(#pupil-grad)"
        animate={animated ? { scaleY: [1, 1.10, 0.90, 1.05, 1] } : { scaleY: 1 }}
        transition={{
          duration: 6,
          repeat: animated ? Infinity : 0,
          ease: "easeInOut",
          times: [0, 0.25, 0.6, 0.8, 1]
        }}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      />

      {/* Borde de la pupila */}
      <path d={pupilPath}
        fill="none"
        stroke={color} strokeOpacity="0.25" strokeWidth="0.7"
        filter="url(#pupil-glow)"
      />

      {/* Reflejo en la pupila */}
      <motion.ellipse
        cx={cx - 3.5} cy={cy - 5} rx="2.2" ry="3.2"
        fill="rgba(255,255,255,0.50)"
        filter="url(#iris-blur)"
        animate={animated ? { opacity: [0.35, 0.65, 0.35] } : { opacity: 0.48 }}
        transition={{ duration: 3.5, repeat: animated ? Infinity : 0, ease: "easeInOut" }}
      />

      {/* Destello al tocar */}
      <AnimatePresence>
        {pulse && (
          <motion.circle cx={cx} cy={cy} r="28"
            fill="none"
            stroke={color} strokeWidth="2.5"
            initial={{ r: 28, strokeOpacity: 0.9 }}
            animate={{ r: 56,  strokeOpacity: 0   }}
            exit={{ strokeOpacity: 0 }}
            transition={{ duration: 0.42, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>

      {/* Parpadeo — breve y ocasional */}
      <motion.ellipse
        cx={cx} cy={cy} rx="27" ry="27"
        fill="rgba(2,2,8,0.97)"
        clipPath="url(#iris-clip)"
        animate={animated ? { scaleY: [0, 0, 1, 0, 0] } : { scaleY: 0 }}
        transition={{ duration: 7, repeat: animated ? Infinity : 0, ease: "easeInOut", times: [0, 0.90, 0.945, 0.99, 1] }}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────
// SELLO RÚNICO — orbe izquierdo (sin cambios)
// ─────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────
// SIGILOS DE GÉNERO — un símbolo sutil por género, centrado en (17,17)
// ─────────────────────────────────────────────────────────
function GenreSigil({ genre, color, active }: { genre: string; color: string; active: boolean }) {
  const op   = active ? 0.95 : 0.5
  const fop  = active ? 0.8  : 0.4
  switch (genre) {
    case "melancolico":
      return (
        <path d="M17 11 C 19.4 14.5, 19.4 18, 17 20 C 14.6 18, 14.6 14.5, 17 11 Z"
          fill={color} fillOpacity={fop} stroke={color} strokeOpacity={op} strokeWidth="0.6" />
      )
    case "terror":
      return (
        <path d="M17 10.5 L 15 13.5 L 18 15.5 L 15.3 18 L 17.6 21.5"
          fill="none" stroke={color} strokeOpacity={op} strokeWidth="1.3"
          strokeLinecap="round" strokeLinejoin="round" />
      )
    case "fantasia":
      return (
        <path d="M17 9.8 L 18.2 15.8 L 24.2 17 L 18.2 18.2 L 17 24.2 L 15.8 18.2 L 9.8 17 L 15.8 15.8 Z"
          fill={color} fillOpacity={fop} stroke={color} strokeOpacity={op} strokeWidth="0.5"
          strokeLinejoin="round" />
      )
    case "misterio":
      return (
        <g fill={color} fillOpacity={fop} stroke={color} strokeOpacity={op} strokeWidth="0.5">
          <circle cx="17" cy="15" r="2.4" />
          <path d="M15.4 16.6 L 14.5 21 L 19.5 21 L 18.6 16.6 Z" strokeLinejoin="round" />
        </g>
      )
    case "romance":
      return (
        <path d="M13 21 C 15 14.5, 17 12.2, 17 12.2 C 17 12.2, 19 14.5, 21 21"
          fill="none" stroke={color} strokeOpacity={op} strokeWidth="1.2"
          strokeLinecap="round" strokeLinejoin="round" />
      )
    default:
      return null
  }
}

function RunicSeal({ color, glow, active, genre = "todos", animated }: { color: string; glow: string; active: boolean; genre?: string; animated: boolean }) {
  const hex = (r: number, cx = 17, cy = 17) =>
    Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 6
      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`
    }).join(" ")
  const tri1 = (r: number, cx = 17, cy = 17) =>
    Array.from({ length: 3 }, (_, i) => {
      const a = (Math.PI * 2 / 3) * i - Math.PI / 2
      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`
    }).join(" ")
  const tri2 = (r: number, cx = 17, cy = 17) =>
    Array.from({ length: 3 }, (_, i) => {
      const a = (Math.PI * 2 / 3) * i + Math.PI / 2
      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`
    }).join(" ")
  return (
    <svg width="34" height="34" viewBox="0 0 34 34"
      className="pointer-events-none" style={{ overflow: "visible" }}>
      <defs>
        <radialGradient id="runeglow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor={glow} stopOpacity="0.5" />
          <stop offset="100%" stopColor={glow} stopOpacity="0.0" />
        </radialGradient>
        <filter id="runeblur"><feGaussianBlur stdDeviation="1.5" /></filter>
      </defs>
      <circle cx="17" cy="17" r="22" fill="url(#runeglow)" />
      <polygon points={hex(15)} fill="rgba(0,0,0,0.82)"
        stroke={color} strokeOpacity={active ? 0.7 : 0.3} strokeWidth="1" />
      <polygon points={hex(15)} fill="none"
        stroke={color} strokeOpacity={active ? 0.4 : 0.1} strokeWidth="2.5"
        filter="url(#runeblur)" />
      <motion.g
        animate={{ rotate: active ? 360 : 0 }}
        transition={{ duration: 12, repeat: active && animated ? Infinity : 0, ease: "linear" }}
        style={{ transformOrigin: "17px 17px" }}>
        <polygon points={tri1(10)} fill="none"
          stroke={color} strokeOpacity={active ? 0.6 : 0.25} strokeWidth="0.8" />
        <polygon points={tri2(10)} fill="none"
          stroke={color} strokeOpacity={active ? 0.6 : 0.25} strokeWidth="0.8" />
      </motion.g>
      <circle cx="17" cy="17" r="5.5" fill="none"
        stroke={color} strokeOpacity={active ? 0.6 : 0.28} strokeWidth="0.7" />

      <AnimatePresence mode="wait">
        <motion.g key={genre}
          initial={{ opacity: 0, scale: 0.3 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.3 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          style={{ transformOrigin: "17px 17px" }}>
          {genre === "todos" ? (
            <motion.circle cx="17" cy="17" r="2" fill={color}
              fillOpacity={active ? 0.9 : 0.5}
              animate={{ r: [1.5, 2.5, 1.5], fillOpacity: active ? [0.7, 1, 0.7] : [0.3, 0.5, 0.3] }}
              transition={{ duration: 2.5, repeat: animated ? Infinity : 0, ease: "easeInOut" }} />
          ) : (
            <GenreSigil genre={genre} color={color} active={active} />
          )}
        </motion.g>
      </AnimatePresence>
      {Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 6
        return (
          <motion.circle key={i}
            cx={17 + 15 * Math.cos(a)} cy={17 + 15 * Math.sin(a)} r="1.2"
            fill={color} fillOpacity={active ? 0.8 : 0.3}
            animate={{ fillOpacity: active ? [0.4, 0.9, 0.4] : [0.2, 0.4, 0.2] }}
            transition={{ duration: 2 + i * 0.3, repeat: animated ? Infinity : 0, ease: "easeInOut", delay: i * 0.15 }} />
        )
      })}
    </svg>
  )
}

// ─────────────────────────────────────────────────────────
// PRISMA DE LUZ — orbe derecho (sin cambios)
// ─────────────────────────────────────────────────────────
function PrismOrb({ color, glow, active, animated }: { color: string; glow: string; active: boolean; animated: boolean }) {
  const size = 34; const cx = size / 2; const cy = size / 2 + 1
  const v = [
    { x: cx,      y: cy - 14 },
    { x: cx - 13, y: cy + 8  },
    { x: cx + 13, y: cy + 8  },
  ]
  const pts = v.map(p => `${p.x},${p.y}`).join(" ")
  const mid = (a: {x:number,y:number}, b: {x:number,y:number}) =>
    ({ x: (a.x+b.x)/2, y: (a.y+b.y)/2 })
  const m01 = mid(v[0], v[1]); const m12 = mid(v[1], v[2]); const m20 = mid(v[2], v[0])
  const innerPts = `${m01.x},${m01.y} ${m12.x},${m12.y} ${m20.x},${m20.y}`
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      className="pointer-events-none" style={{ overflow: "visible" }}>
      <defs>
        <radialGradient id="prismglow" cx="50%" cy="60%" r="50%">
          <stop offset="0%"   stopColor={glow} stopOpacity="0.5" />
          <stop offset="100%" stopColor={glow} stopOpacity="0.0" />
        </radialGradient>
        <filter id="prismblur"><feGaussianBlur stdDeviation="1.5" /></filter>
        <linearGradient id="prismface" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor={color} stopOpacity={active ? "0.25" : "0.08"} />
          <stop offset="100%" stopColor="black" stopOpacity="0.8" />
        </linearGradient>
      </defs>
      <polygon points={pts} fill="url(#prismglow)"
        transform={`scale(1.6) translate(-${cx*0.3},-${cy*0.3})`} />
      <polygon points={pts} fill="none"
        stroke={color} strokeOpacity={active ? 0.45 : 0.12} strokeWidth="3"
        filter="url(#prismblur)" />
      <polygon points={pts} fill="url(#prismface)"
        stroke={color} strokeOpacity={active ? 0.75 : 0.3} strokeWidth="1" />
      <polygon points={innerPts} fill="none"
        stroke={color} strokeOpacity={active ? 0.55 : 0.2} strokeWidth="0.7" />
      {v.map((vtx, i) => (
        <motion.line key={i} x1={cx} y1={cy+1} x2={vtx.x} y2={vtx.y}
          stroke={color} strokeOpacity={active ? 0.35 : 0.1}
          strokeWidth="0.6" strokeDasharray="1.5 2"
          animate={{ strokeOpacity: active ? [0.2, 0.45, 0.2] : [0.05, 0.15, 0.05] }}
          transition={{ duration: 2 + i * 0.4, repeat: animated ? Infinity : 0, ease: "easeInOut", delay: i * 0.3 }} />
      ))}
      <motion.circle cx={cx} cy={cy+1} r={active ? 2.5 : 1.8}
        fill={color} fillOpacity={active ? 0.95 : 0.45}
        animate={{ r: active ? [2, 3.2, 2] : [1.5, 2, 1.5],
                   fillOpacity: active ? [0.7, 1, 0.7] : [0.3, 0.5, 0.3] }}
        transition={{ duration: 2, repeat: animated ? Infinity : 0, ease: "easeInOut" }} />
      {v.map((vtx, i) => (
        <motion.circle key={i} cx={vtx.x} cy={vtx.y} r="1.3"
          fill={color} fillOpacity={active ? 0.8 : 0.3}
          animate={{ fillOpacity: active ? [0.5, 0.9, 0.5] : [0.15, 0.35, 0.15] }}
          transition={{ duration: 1.8 + i * 0.35, repeat: animated ? Infinity : 0, ease: "easeInOut", delay: i * 0.2 }} />
      ))}
      <AnimatePresence>
        {active && (
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.line x1={cx} y1={cy+1} x2={cx} y2={cy+22}
              stroke={color} strokeWidth="1"
              animate={{ strokeOpacity: [0.0, 0.4, 0.0] }}
              transition={{ duration: 2.5, repeat: animated ? Infinity : 0, ease: "easeInOut" }} />
          </motion.g>
        )}
      </AnimatePresence>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────
// SISTEMA DE ORBES
// ─────────────────────────────────────────────────────────
export default function OrbSystem() {
  const [location, setLocation] = useLocation()
  const { activeGenre, lobbyFilter, cfg, cycleGenre, resetGenre, toggleFilter } = useGenre()
  const { t, settings } = useSettings()
  const { play } = useSoundFX()

  const [searchMode,      setSearchMode]      = useState(false)
  const [query,           setQuery]           = useState("")
  const [suggestions,     setSuggestions]     = useState<BookSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [showLabel,       setShowLabel]       = useState(false)
  const [orbPulse,        setOrbPulse]        = useState(false)
  const [showConfig,      setShowConfig]      = useState(false)
  const [showPulso,       setShowPulso]       = useState(false)
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden"
  )

  const labelTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pulseTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef      = useRef<HTMLInputElement>(null)

  // Para el hold largo del buscador: cuando searchMode está activo,
  // rastreamos un press prolongado directamente
  const searchHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchPressStart = useRef<number>(0)

  useEffect(() => {
    setSearchMode(false); setQuery(""); setSuggestions([]); setShowSuggestions(false)
  }, [location])

  useEffect(() => () => {
    if (labelTimer.current) clearTimeout(labelTimer.current)
    if (pulseTimer.current) clearTimeout(pulseTimer.current)
    if (focusTimer.current) clearTimeout(focusTimer.current)
    if (searchHoldTimer.current) clearTimeout(searchHoldTimer.current)
  }, [])

  useEffect(() => {
    const onVisibility = () => setDocumentVisible(document.visibilityState !== "hidden")
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [])

  // Sugerencias en tiempo real
  useEffect(() => {
    const q = query.toLowerCase().trim()
    if (!q || q.length < 2) { setSuggestions([]); setShowSuggestions(false); return }
    const authored = storedList("novareads_authored")
    const saved    = storedList("novareads_saved")
    const catalog  = queryClient.getQueryData<any[]>(["/api/books"]) || []
    const seenIds  = new Set<string>()
    const allLocal = [...authored, ...saved, ...catalog].filter((b: any) => {
      const key = String(b.id)
      if (seenIds.has(key)) return false
      seenIds.add(key); return true
    })
    const results = allLocal
      .filter((b: any) =>
        b.title?.toLowerCase().includes(q)  ||
        b.author?.toLowerCase().includes(q) ||
        b.genre?.toLowerCase().includes(q)
      ).slice(0, 5)
    setSuggestions(results)
    setShowSuggestions(results.length > 0)
  }, [query])

  function triggerLabel() {
    if (labelTimer.current) clearTimeout(labelTimer.current)
    setShowLabel(true)
    labelTimer.current = setTimeout(() => setShowLabel(false), 2000)
  }

  function flashOrb() {
    if (pulseTimer.current) clearTimeout(pulseTimer.current)
    setOrbPulse(true)
    pulseTimer.current = setTimeout(() => {
      setOrbPulse(false)
      pulseTimer.current = null
    }, 420)
  }

  function vibrate(pattern: number | number[]) {
    if (!settings.haptics || typeof navigator === "undefined" || !("vibrate" in navigator)) return
    navigator.vibrate(pattern)
  }

  function handleCycleGenre() {
    cycleGenre(); triggerLabel(); play("genre_cycle", activeGenre)
    if (location !== "/") setLocation("/")
  }

  function handleResetGenre() {
    resetGenre(); triggerLabel(); play("genre_reset")
    if (location !== "/") setLocation("/")
  }

  useEffect(() => {
    const patterns: Record<string, number[]> = {
      melancolico: [40, 60, 30],
      terror:      [15, 25, 15],
      fantasia:    [10, 20, 10, 20, 25],
      misterio:    [30, 50],
      romance:     [50],
      todos:       [],
    }
    const pat = patterns[activeGenre]
    if (pat && pat.length) vibrate(pat)
  }, [activeGenre, settings.haptics])

  function closeSearch() {
    setSearchMode(false); setQuery(""); setSuggestions([]); setShowSuggestions(false)
  }

  // Historia aleatoria — todos los libros disponibles
  // Incluye los del servidor desde el caché de React Query
  function goToRandomBook() {
    const authored = storedList("novareads_authored")
    const saved    = storedList("novareads_saved")
    const apiCache = queryClient.getQueryData<any[]>(["/api/books"]) || []
    const all      = [...authored, ...saved, ...apiCache]
    const seen     = new Set<string>()
    const unique   = all.filter((b: any) => {
      const k = String(b.id); if (seen.has(k)) return false; seen.add(k); return true
    })
    if (unique.length === 0) return
    const pick = unique[Math.floor(Math.random() * unique.length)]
    play("navigate")
    vibrate([18, 10, 18])
    flashOrb()
    closeSearch()
    setLocation(`/book/${pick.id}`)
  }

  // ── Gestos del orbe central ──────────────────────────────
  // Cuando el buscador ESTÁ arriba: presionar 1.4s = historia aleatoria.
  function onCentralDown() {
    if (!searchMode) return
    searchPressStart.current = Date.now()
    searchHoldTimer.current = setTimeout(() => {
      goToRandomBook()
    }, 1400)
  }

  function onCentralUp() {
    if (!searchMode) return
    if (searchHoldTimer.current) {
      clearTimeout(searchHoldTimer.current)
      searchHoldTimer.current = null
    }
    // Si el press fue corto y el buscador está arriba → cerrar buscador
    const dur = Date.now() - searchPressStart.current
    if (dur < 300) {
      closeSearch()
      play("navigate")
    }
  }

  const central = useOrbGestures({
    tap: () => {
      // Solo se activa cuando searchMode es false (el handler de onCentralDown/Up maneja el caso searchMode=true)
      if (searchMode) return
      flashOrb(); play("navigate")
      vibrate(10)
      setLocation(location === "/" ? "/library" : "/")
    },
    holdShort: () => {
      // Abrir buscador — el orbe sube
      play("orb_hold")
      vibrate([15, 10, 15])
      setSearchMode(true)
      if (focusTimer.current) clearTimeout(focusTimer.current)
      focusTimer.current = setTimeout(() => {
        inputRef.current?.focus()
        focusTimer.current = null
      }, 120)
    },
    holdLong: () => {
      // Historia aleatoria cuando el buscador NO está activo
      // (si está activo lo maneja onCentralDown)
      if (searchMode) return
      goToRandomBook()
    },
    doubleTap: () => {},
  })

  const diamond = useOrbGestures({
    tap:       handleCycleGenre,
    doubleTap: handleResetGenre,
    holdShort: () => {
      play("orb_hold")
      vibrate([12, 8, 12])
      setShowConfig(true)
    },
    holdLong: () => {},
  })

  const triangle = useOrbGestures({
    tap: () => {
      toggleFilter(); play("orb_tap")
      vibrate(8)
      if (location !== "/") setLocation("/")
    },
    doubleTap: () => {
      const last = storedValue("lastReading")
      if (last) { play("navigate"); setLocation(last) }
    },
    holdShort: () => {
      play("orb_tap")
      vibrate([12, 8, 12])
      setShowPulso(true)
    },
    holdLong: () => {},  // sin función por ahora
  })

  function doSearch() {
    if (!query.trim()) return
    play("navigate")
    setLocation(`/library?search=${encodeURIComponent(query.trim())}`)
    closeSearch()
  }

  function goToBook(id: string | number) {
    play("navigate"); setLocation(`/book/${id}`); closeSearch()
  }

  const filterActive = lobbyFilter === "short"
  const animated = documentVisible && !settings.reduceMotion

  // ── Merge gestures del orbe central con handlers de searchMode ──
  const centralProps = {
    ...central,
    onPointerDown: (e: React.PointerEvent) => {
      central.onPointerDown(e)
      onCentralDown()
    },
    onPointerMove: (e: React.PointerEvent) => {
      central.onPointerMove(e)
    },
    onPointerUp: () => {
      central.onPointerUp()
      onCentralUp()
    },
    onPointerLeave: () => {
      central.onPointerLeave()
      if (searchHoldTimer.current) { clearTimeout(searchHoldTimer.current); searchHoldTimer.current = null }
    },
    onPointerCancel: () => {
      central.onPointerCancel()
      if (searchHoldTimer.current) { clearTimeout(searchHoldTimer.current); searchHoldTimer.current = null }
    },
  }

  return (
    <>
    <div className="tloque-orb-dock fixed left-0 right-0 flex justify-center z-[120] select-none pointer-events-none">
      <div className="relative flex items-center justify-center pointer-events-auto">

        {/* ── ETIQUETA FLOTANTE ── */}
        <AnimatePresence mode="wait">
          {showLabel && (
            <motion.div key="genre-label"
              initial={{ opacity: 0, y: 12, scale: 0.8 }}
              animate={{ opacity: 1, y: 0,  scale: 1   }}
              exit={{    opacity: 0, y: -6,  scale: 0.9 }}
              transition={{ type: "spring", stiffness: 280, damping: 24 }}
              className="absolute -top-11 left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none"
            >
              <span className="inline-block px-3 py-1 rounded-full text-[10px] tracking-[0.2em] uppercase font-medium font-sans"
                style={{
                  background:     cfg.bg,
                  color:          cfg.color,
                  border:         `1px solid ${cfg.glow}50`,
                  boxShadow:      `0 0 16px ${cfg.glow}40`,
                  backdropFilter: "blur(12px)",
                }}>
                {t(cfg.tKey)}
              </span>
            </motion.div>
          )}
          {filterActive && !showLabel && (
            <motion.div key="filter-label"
              initial={{ opacity: 0, y: 12, scale: 0.8 }}
              animate={{ opacity: 1, y: 0,  scale: 1   }}
              exit={{    opacity: 0, y: -6,  scale: 0.9 }}
              transition={{ type: "spring", stiffness: 280, damping: 24 }}
              className="absolute -top-11 left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none"
            >
              <span className="inline-block px-3 py-1 rounded-full text-[10px] tracking-[0.2em] uppercase font-medium font-sans"
                style={{
                  background:     "rgba(255,255,255,0.07)",
                  color:          "rgba(255,255,255,0.55)",
                  border:         "1px solid rgba(255,255,255,0.18)",
                  backdropFilter: "blur(12px)",
                }}>
                {t("soloRelatos")}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── ORBE IZQUIERDO — SELLO RÚNICO ── */}
        <motion.button
          {...diamond}
          animate={{ x: -72, y: searchMode ? -85 : 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 26 }}
          whileHover={{ scale: 1.05 }}
          whileFocus={{ scale: 1.05 }}
          whileTap={{ scale: 0.78 }}
          className="absolute flex items-center justify-center rounded-full outline-none focus-visible:ring-1 focus-visible:ring-white/35"
          style={{ width: 48, height: 48, touchAction: "none", willChange: searchMode ? "transform" : "auto" }}
          aria-label={t("genre")}
          aria-pressed={activeGenre !== "todos"}
        >
          <RunicSeal color={cfg.color} glow={cfg.glow} active={activeGenre !== "todos"} genre={activeGenre} animated={animated} />
        </motion.button>

        {/* ── ORBE DERECHO — PRISMA ── */}
        <motion.button
          {...triangle}
          animate={{ x: 72, y: searchMode ? -85 : 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 26 }}
          whileHover={{ scale: 1.05 }}
          whileFocus={{ scale: 1.05 }}
          whileTap={{ scale: 0.78 }}
          className="absolute flex items-center justify-center rounded-full outline-none focus-visible:ring-1 focus-visible:ring-white/35"
          style={{ width: 48, height: 48, touchAction: "none", willChange: searchMode ? "transform" : "auto" }}
          aria-label={t("onlyStories")}
          aria-pressed={filterActive}
        >
          <PrismOrb color={cfg.color} glow={cfg.glow} active={filterActive} animated={animated} />
        </motion.button>

        {/* ── ORBE CENTRAL — OJO CÓSMICO ── */}
        <motion.button
          {...centralProps}
          animate={{ y: searchMode ? "-38vh" : 0, scale: searchMode ? 1.1 : 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 24 }}
          whileHover={{ scale: searchMode ? 1.12 : 1.04 }}
          whileFocus={{ scale: searchMode ? 1.12 : 1.04 }}
          whileTap={{ scale: searchMode ? 1.02 : 0.94 }}
          className="relative flex items-center justify-center rounded-full outline-none focus-visible:ring-1 focus-visible:ring-white/35"
          style={{ width: 76, height: 76, touchAction: "none", willChange: searchMode ? "transform" : "auto" }}
          aria-label={location === "/" ? t("library") : t("lobby")}
          aria-expanded={searchMode}
        >
          <CosmicEye color={cfg.color} glow={cfg.glow} pulse={orbPulse} searchMode={searchMode} animated={animated} />
        </motion.button>

        {/* ── BUSCADOR — portal al body, centrado con margin auto ── */}
        {searchMode && createPortal(
          <AnimatePresence>
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.92 }}
              animate={{ opacity: 1, y: 0,  scale: 1    }}
              exit={{    opacity: 0, y: 16,  scale: 0.92 }}
              transition={{ type: "spring", stiffness: 240, damping: 26 }}
              style={{
                position:       "fixed",
                bottom:         "17dvh",
                left:           0,
                right:          0,
                display:        "flex",
                justifyContent: "center",
                zIndex:         300,
                pointerEvents:  "none",
              }}
            >
              {/* El ancho y contenido real — pointer events activados solo aquí */}
              <div style={{ width: "min(88vw, 320px)", pointerEvents: "auto" }}>
                <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl"
                  style={{
                    background:     "rgba(6,6,10,0.92)",
                    border:         `1px solid ${cfg.color}45`,
                    boxShadow:      `0 4px 32px rgba(0,0,0,0.7), 0 0 24px ${cfg.glow}30`,
                    backdropFilter: "blur(16px)",
                  }}
                >
                  <Search className="w-3.5 h-3.5 shrink-0" style={{ color: cfg.color }} />
                  <input
                    ref={inputRef}
                    autoFocus
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter")  doSearch()
                      if (e.key === "Escape") closeSearch()
                    }}
                    placeholder={t("search")}
                    className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-zinc-600 font-sans"
                  />
                  <AnimatePresence>
                    {query.trim() ? (
                      <motion.button key="search-btn"
                        initial={{ opacity: 0, scale: 0.7 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.7 }}
                        onClick={doSearch}
                        className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full font-sans"
                        style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}40` }}
                      >
                        {t("searchAction")}
                      </motion.button>
                    ) : (
                      <motion.button key="close-btn"
                        initial={{ opacity: 0, scale: 0.7 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.7 }}
                        onClick={closeSearch}
                        className="shrink-0 p-1 rounded-full"
                        style={{ color: "rgba(255,255,255,0.25)" }}
                      >
                        <X className="w-3 h-3" />
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>

                {/* Sugerencias */}
                <AnimatePresence>
                  {showSuggestions && suggestions.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -4, scaleY: 0.92 }}
                      animate={{ opacity: 1, y: 0,  scaleY: 1    }}
                      exit={{    opacity: 0, y: -4,  scaleY: 0.92 }}
                      transition={{ duration: 0.15 }}
                      className="mt-1.5 rounded-xl overflow-hidden"
                      style={{
                        background:      "rgba(6,6,10,0.95)",
                        border:          `1px solid ${cfg.color}25`,
                        boxShadow:       "0 8px 32px rgba(0,0,0,0.6)",
                        backdropFilter:  "blur(16px)",
                        transformOrigin: "top",
                      }}
                    >
                      {suggestions.map((book, i) => (
                        <motion.button key={book.id}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0  }}
                          transition={{ delay: i * 0.04 }}
                          onClick={() => goToBook(book.id)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/5"
                          style={{ borderBottom: i < suggestions.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none" }}
                        >
                          <div className="shrink-0 w-7 h-10 rounded overflow-hidden"
                            style={{ background: cfg.bg }}>
                            {book.coverUrl && (
                              <img loading="lazy" src={book.coverUrl} alt="" className="w-full h-full object-cover" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-xs font-medium truncate font-sans">
                              {highlightMatch(book.title || "", query)}
                            </p>
                            <p className="text-zinc-600 text-[10px] truncate font-sans mt-0.5">
                              {book.author}
                            </p>
                          </div>
                          {book.genre && book.genre !== "todos" && (
                            <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-sans uppercase tracking-wide"
                              style={{ background: cfg.bg, color: cfg.color + "99" }}>
                              {book.genre}
                            </span>
                          )}
                        </motion.button>
                      ))}
                      <button onClick={doSearch}
                        className="w-full px-4 py-2.5 text-center text-[11px] font-sans transition-colors"
                        style={{ color: cfg.color + "88", borderTop: `1px solid ${cfg.color}15` }}
                      >
                        {t("seeAllResults")} →
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </AnimatePresence>,
          document.body
        )}

      </div>
    </div>

    {/* ── PANELES ── */}
    <ConfigPanel open={showConfig} onClose={() => setShowConfig(false)} />
    <PulsoPanel  open={showPulso}  onClose={() => setShowPulso(false)}  />
    </>
  )
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text
  const lower = text.toLowerCase()
  const q     = query.toLowerCase().trim()
  const idx   = lower.indexOf(q)
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ color: "#d0d0ff", fontWeight: 600 }}>
        {text.slice(idx, idx + q.length)}
      </span>
      {text.slice(idx + q.length)}
    </>
  )
}
