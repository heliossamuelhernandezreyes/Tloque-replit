import { ReactNode, useMemo } from "react"
import { useSettings } from "@/context/SettingsContext"

// ─────────────────────────────────────────────────────────────
// FrameRenderer v2 — dibuja un marco del Taller (runtimePreset 1.0.0)
//
// v2 aprovecha la física que el taller ya exportaba y estaba dormida:
//   · Material: metalness, roughness, polish, contrast, patina, wear
//   · Iluminación: lightPrimary/Rim/Ambient/Sparkle, lightSweepAngle, sceneKeyColor
//   · Bisel: bevelLight, edgeLight, edgeShadow, cornerSpecular, edgeDoubleHighlight
//   · Vidrio: reflection, tint, edgeGlow, dispersion (el reflejo que faltaba)
//   · Ornamentos: esquinas y figuras del pincel
//   · El reflejo del vidrio SIGUE la inclinación de la carta (vars --tq-tx/--tq-ty)
// Sin framer-motion: CSS puro, ligero para móvil.
// ─────────────────────────────────────────────────────────────

const MATERIALS: Record<string, { light: string; dark: string; stops: string[] }> = {
  gold:     { light: "#f8ecb0", dark: "#6e5416", stops: ["#fff4c6", "#e4c76e", "#8b681d", "#d5aa45", "#fff0ad"] },
  silver:   { light: "#f4f8fc", dark: "#565e6b", stops: ["#ffffff", "#d8e0e9", "#68717d", "#b8c2d0", "#f7fbff"] },
  copper:   { light: "#f0b98a", dark: "#5e3218", stops: ["#ffd0a4", "#d48b55", "#6d371c", "#b86435", "#f1a774"] },
  diamond:  { light: "#ffffff", dark: "#6a95ab", stops: ["#ffffff", "#d7f4ff", "#8cb8d0", "#e6d7ff", "#ffffff"] },
  steel:    { light: "#dce2e7", dark: "#2f353b", stops: ["#e9eef2", "#9aa5af", "#3d444b", "#737f8a", "#d2d9df"] },
  titanium: { light: "#b8bec9", dark: "#20232a", stops: ["#c7ccd5", "#747a86", "#272b32", "#565c67", "#adb4c0"] },
  obsidian: { light: "#5a6074", dark: "#05060a", stops: ["#4d5367", "#202431", "#06070c", "#151824", "#3b4152"] },
}

const clamp = (v: any, d = 0.5) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : d
}
const bounded = (v: any, fallback: number, min: number, max: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}
const safeColor = (value: any, fallback: string) =>
  typeof value === "string" && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value) ? value : fallback
function hexToRgb(hex: string): [number, number, number] {
  const h = (hex || "").replace("#", "")
  const v = h.length === 3 ? h.split("").map(c => c + c).join("") : h
  return [parseInt(v.slice(0, 2), 16) || 0, parseInt(v.slice(2, 4), 16) || 0, parseInt(v.slice(4, 6), 16) || 0]
}
function mix(hex: string, target: number, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  const f = (c: number) => Math.round(c + (target - c) * amount).toString(16).padStart(2, "0")
  return `#${f(r)}${f(g)}${f(b)}`
}
const alpha = (hex: string, a: number) => {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`
}

// Los stops del material, modulados por su FÍSICA (lo que estaba dormido).
function physicalMaterial(m: any) {
  const preset = m?.preset && MATERIALS[m.preset] ? m.preset : null
  const base = preset
    ? MATERIALS[preset]
    : (() => {
        const c = safeColor(m?.baseColor, "#c9a84c")
        return {
          light: mix(c, 255, 0.55), dark: mix(c, 0, 0.55),
          stops: [mix(c, 255, 0.62), mix(c, 255, 0.18), mix(c, 0, 0.5), c, mix(c, 255, 0.5)],
        }
      })()

  const contrast  = clamp(m?.contrast, 0.7)     // separa luces y sombras
  const polish    = clamp(m?.polish, 0.8)       // nitidez del reflejo
  const roughness = clamp(m?.roughness, 0.25)   // difumina
  const metalness = clamp(m?.metalness, 0.9)    // satura el metal
  const patina    = clamp(m?.patina, 0)
  const wear      = clamp(m?.wear, 0)

  // Contraste: empujar claros hacia la luz y oscuros hacia la sombra.
  // Rugosidad: acercarlos de nuevo (superficie mate).
  const push = contrast * 0.5 * (1 - roughness * 0.6)
  let stops = base.stops.map((c, i) => {
    const isLight = i === 0 || i === 1 || i === 4
    let out = isLight ? mix(c, 255, push * 0.55) : mix(c, 0, push * 0.45)
    if (metalness < 0.5) out = mix(out, 128, (0.5 - metalness) * 0.5)  // menos metal = más plano
    if (patina > 0) out = mix(out, hexToRgb(m?.patinaColor || "#4c7f6b")[1], patina * 0.35)
    if (wear > 0) out = mix(out, 90, wear * 0.3)
    return out
  })

  // Pulido alto → banda especular estrecha y marcada.
  const narrow = 0.5 - polish * 0.22
  const offsets = [0, 50 - narrow * 100 * 0.5, 50, 50 + narrow * 100 * 0.5, 100]
    .map(o => Math.max(0, Math.min(100, o)))

  return {
    light: mix(base.light, 255, contrast * 0.3),
    dark:  mix(base.dark, 0, contrast * 0.3),
    stops, offsets,
    sparkle: clamp(m?.lightSparkle, 0.12),
    sparkleColor: safeColor(m?.lightSparkleColor, "#ffffff"),
    keyColor: safeColor(m?.sceneKeyColor, "#fff4d6"),
  }
}

function rrect(x: number, y: number, w: number, h: number,
               tl: number, tr: number, br: number, bl: number) {
  const cap = (r: number) => Math.max(0, Math.min(r, w / 2, h / 2))
  tl = cap(tl); tr = cap(tr); br = cap(br); bl = cap(bl)
  return `M${x + tl} ${y}H${x + w - tr}A${tr} ${tr} 0 0 1 ${x + w} ${y + tr}` +
         `V${y + h - br}A${br} ${br} 0 0 1 ${x + w - br} ${y + h}` +
         `H${x + bl}A${bl} ${bl} 0 0 1 ${x} ${y + h - bl}` +
         `V${y + tl}A${tl} ${tl} 0 0 1 ${x + tl} ${y}Z`
}
const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`

// Figuras estampadas del pincel del taller
function stampPath(shape: string, cx: number, cy: number, size: number) {
  const r = size / 2
  if (shape === "circle") return circle(cx, cy, r)
  if (shape === "square")  return `M${cx - r} ${cy - r}h${r * 2}v${r * 2}h${-r * 2}Z`
  if (shape === "triangle") return `M${cx} ${cy - r}L${cx + r} ${cy + r}L${cx - r} ${cy + r}Z`
  if (shape === "rombo" || shape === "diamond") return `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`
  if (shape === "star") {
    let d = ""
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.42 : r
      const a = -Math.PI / 2 + i * Math.PI / 5
      d += (i ? "L" : "M") + (cx + rr * Math.cos(a)).toFixed(1) + " " + (cy + rr * Math.sin(a)).toFixed(1)
    }
    return d + "Z"
  }
  if (shape === "hex") {
    let d = ""
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 3
      d += (i ? "L" : "M") + (cx + r * Math.cos(a)).toFixed(1) + " " + (cy + r * Math.sin(a)).toFixed(1)
    }
    return d + "Z"
  }
  return ""
}

interface FrameRendererProps {
  preset: any
  shape?: "card" | "profile"
  className?: string
  nameText?: string
  children?: ReactNode
  asOverlay?: boolean
}

let uid = 0

export default function FrameRenderer({ preset, shape, className, nameText, children, asOverlay }: FrameRendererProps) {
  const { settings } = useSettings()
  const rp  = preset?.runtimePreset ?? preset ?? {}
  const ap  = rp.appearance ?? {}
  const geo = ap.geometry ?? {}
  const m   = ap.material ?? {}
  const halo = ap.halo ?? {}
  const glass = ap.glass ?? {}
  const edge = ap.edgeStyle ?? {}
  const orn = ap.ornaments ?? {}

  const resolvedShape: "card" | "profile" = shape ?? (rp.target === "profile" ? "profile" : "card")
  const isCard = resolvedShape === "card"
  const id = useMemo(() => `tqf${++uid}`, [])
  const mat = useMemo(() => physicalMaterial(m), [preset])

  const CW = 500, CH = isCard ? 700 : 500
  const th = {
    top:    bounded(geo.thickness?.top, 38, 4, 200),
    right:  bounded(geo.thickness?.right, 38, 4, 200),
    bottom: bounded(geo.thickness?.bottom, 38, 4, 200),
    left:   bounded(geo.thickness?.left, 38, 4, 200),
  }
  const co = {
    tl: bounded(geo.corners?.tl, 44, 0, 250), tr: bounded(geo.corners?.tr, 44, 0, 250),
    br: bounded(geo.corners?.br, 44, 0, 250), bl: bounded(geo.corners?.bl, 44, 0, 250),
  }
  const thAvg = (th.top + th.right + th.bottom + th.left) / 4

  const outer = isCard
    ? rrect(2, 2, CW - 4, CH - 4, co.tl, co.tr, co.br, co.bl)
    : circle(CW / 2, CH / 2, CW / 2 - 2)
  const inner = isCard
    ? rrect(th.left, th.top, CW - th.left - th.right, CH - th.top - th.bottom,
        Math.max(0, co.tl - Math.max(th.top, th.left) * 0.45),
        Math.max(0, co.tr - Math.max(th.top, th.right) * 0.45),
        Math.max(0, co.br - Math.max(th.bottom, th.right) * 0.45),
        Math.max(0, co.bl - Math.max(th.bottom, th.left) * 0.45))
    : circle(CW / 2, CH / 2, CW / 2 - 2 - thAvg)
  const mid = isCard
    ? rrect(th.left * 0.5, th.top * 0.5, CW - (th.left + th.right) * 0.5, CH - (th.top + th.bottom) * 0.5,
        Math.max(0, co.tl - th.top * 0.28), Math.max(0, co.tr - th.top * 0.28),
        Math.max(0, co.br - th.bottom * 0.28), Math.max(0, co.bl - th.bottom * 0.28))
    : circle(CW / 2, CH / 2, CW / 2 - 2 - thAvg * 0.5)

  // ── Iluminación (lo que estaba dormido) ──
  const edgeLight  = clamp(m.edgeLight, 0.72)
  const edgeShadow = clamp(m.edgeShadow, 0.44)
  const bevelLight = clamp(m.bevelLight, 0.62)
  const cornerSpec = clamp(m.cornerSpecular, 0.58)
  const dblHi      = m.edgeDoubleHighlight !== false
  const sweepDeg   = bounded(m.lightSweepAngle, -14, -360, 360)

  // ── Destello del metal ──
  const shimmerOn  = m.shimmer !== false && !settings.reduceMotion
  const reflInt    = clamp(m.reflectionIntensity, 0.82)
  const shimmerDur = 6 - 3.5 * clamp(m.reflectionSpeed, 0.55)
  const shimmerW   = CW * (0.28 + 0.4 * clamp(m.reflectionWidth, 0.42))

  // ── Vidrio (nunca se usaba) ──
  const glassOn   = glass && glass.mode !== "none" && clamp(glass.reflection, 0) > 0.02
  const glassRefl = clamp(glass.reflection, 0.34)
  const glassTint = safeColor(glass.tint, "#dceeff")
  const edgeGlow  = clamp(glass.edgeGlow, 0.24)
  const dispersion = clamp(glass.dispersion, 0.04)
  const dispColor = safeColor(glass.dispersionColor, "#b8a7ff")

  // ── Halo (¡ahora también en las cartas!) ──
  const haloOn = halo.enabled !== false
  const haloColor = safeColor(halo.color, mat.light)
  const haloInt = clamp(halo.intensity, 0.42)
  const haloShadow = haloOn
    ? `0 0 ${Math.round(bounded(halo.spread, 36, 0, 200) * 0.8)}px ${Math.round(bounded(halo.softness, 24, 0, 200) * 0.2)}px ${alpha(haloColor, haloInt * 0.75)}`
    : undefined

  // ── Canto (edgeStyle) ──
  const edgeAccent = safeColor(edge.accentColor, mat.light)

  const nameSlot = isCard && geo.nameSlot === true
  const holeStyle = isCard
    ? {
        top: `${(th.top / CH) * 100}%`, bottom: `${(th.bottom / CH) * 100}%`,
        left: `${(th.left / CW) * 100}%`, right: `${(th.right / CW) * 100}%`,
        borderRadius: `${(Math.max(0, co.tl - Math.max(th.top, th.left) * 0.45) / CW) * 100}%`,
      }
    : { top: `${(thAvg / CH) * 100}%`, bottom: `${(thAvg / CH) * 100}%`,
        left: `${(thAvg / CW) * 100}%`, right: `${(thAvg / CW) * 100}%`, borderRadius: "50%" }

  const rootStyle = asOverlay
    ? (haloShadow ? { boxShadow: haloShadow, borderRadius: "inherit" as const } : undefined)
    : {
        aspectRatio: isCard ? "5 / 7" : "1 / 1",
        boxShadow: haloShadow,
        borderRadius: isCard ? `${(co.tl / CW) * 100}%` : "50%",
      }

  return (
    <div
      className={asOverlay
        ? `absolute inset-0 pointer-events-none ${className || ""}`
        : `relative ${className || ""}`}
      style={rootStyle}>

      {!asOverlay && (
        <div className="absolute overflow-hidden" style={holeStyle}>{children}</div>
      )}

      <svg viewBox={`0 0 ${CW} ${CH}`} className="absolute inset-0 w-full h-full pointer-events-none"
        preserveAspectRatio="none" aria-hidden="true">
        <defs>
          {/* Metal con su física */}
          <linearGradient id={`${id}-mat`} x1="0%" y1="0%" x2="100%" y2="100%">
            {mat.stops.map((c, i) => (
              <stop key={i} offset={`${mat.offsets[i]}%`} stopColor={c} />
            ))}
          </linearGradient>

          {/* Destello del metal, en el ángulo de la luz del taller */}
          <linearGradient id={`${id}-shine`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="rgba(255,255,255,0)" />
            <stop offset="45%"  stopColor={alpha(mat.keyColor, reflInt * 0.55)} />
            <stop offset="50%"  stopColor={alpha(m.preset === "diamond" ? "#e6d7ff" : "#ffffff", reflInt * 0.9)} />
            <stop offset="55%"  stopColor={alpha(mat.keyColor, reflInt * 0.55)} />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>

          {/* Vidrio: reflejo especular sobre el marco (doble banda, como cristal real) */}
          <linearGradient id={`${id}-glass`} x1="0%" y1="0%" x2="70%" y2="100%">
            <stop offset="0%"   stopColor={alpha("#ffffff", glassRefl * 1.1)} />
            <stop offset="22%"  stopColor={alpha(glassTint, glassRefl * 0.55)} />
            <stop offset="38%"  stopColor="rgba(255,255,255,0)" />
            <stop offset="58%"  stopColor={alpha("#ffffff", glassRefl * 0.4)} />
            <stop offset="70%"  stopColor="rgba(255,255,255,0)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>

          {/* Dispersión (arcoíris sutil del cristal) */}
          {dispersion > 0.01 && (
            <linearGradient id={`${id}-disp`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"   stopColor={alpha(dispColor, dispersion * 3)} />
              <stop offset="50%"  stopColor="rgba(255,255,255,0)" />
              <stop offset="100%" stopColor={alpha(glassTint, dispersion * 2.4)} />
            </linearGradient>
          )}

          <clipPath id={`${id}-clip`}>
            <path d={`${outer} ${inner}`} fillRule="evenodd" clipRule="evenodd" />
          </clipPath>
        </defs>

        {/* Cuerpo del marco */}
        <path d={`${outer} ${inner}`} fillRule="evenodd" fill={`url(#${id}-mat)`} />

        {/* BISEL con la física del taller */}
        <path d={outer} fill="none" stroke={mat.light} strokeWidth={2.6} strokeOpacity={edgeLight} />
        <path d={inner} fill="none" stroke={mat.dark}  strokeWidth={3}   strokeOpacity={edgeShadow + 0.3} />
        <path d={mid}   fill="none" stroke={mat.light} strokeWidth={1.6} strokeOpacity={bevelLight * 0.8} />
        {dblHi && (
          <path d={isCard
            ? rrect(th.left * 0.22, th.top * 0.22, CW - (th.left + th.right) * 0.22, CH - (th.top + th.bottom) * 0.22,
                co.tl * 0.9, co.tr * 0.9, co.br * 0.9, co.bl * 0.9)
            : circle(CW / 2, CH / 2, CW / 2 - 2 - thAvg * 0.22)}
            fill="none" stroke={edgeAccent} strokeWidth={1} strokeOpacity={edgeLight * 0.45} />
        )}

        {/* ORNAMENTOS del taller (esquinas y figuras del pincel) */}
        {isCard && orn.cornerStyle && orn.cornerStyle !== "plain" && (
          [[th.left, th.top, 0], [CW - th.right, th.top, 90],
           [CW - th.right, CH - th.bottom, 180], [th.left, CH - th.bottom, 270]].map(([x, y, rot], i) => (
            <g key={i} transform={`translate(${x} ${y}) rotate(${rot})`}>
              {orn.cornerStyle === "rombos" && (
                <>
                  <path d={`M0 ${-thAvg * 0.55}L${thAvg * 0.55} 0L0 ${thAvg * 0.55}L${-thAvg * 0.55} 0Z`}
                    fill={`url(#${id}-mat)`} stroke={mat.dark} strokeWidth={1.5} />
                  <path d={`M0 ${-thAvg * 0.55}L${thAvg * 0.55} 0L0 0Z`} fill={mat.light} fillOpacity={0.45} />
                </>
              )}
              {orn.cornerStyle === "nouveau" && (
                <>
                  <path d={`M${thAvg * 0.2} ${thAvg * 1.3}Q${thAvg * 0.2} ${thAvg * 0.2} ${thAvg * 1.3} ${thAvg * 0.2}`}
                    fill="none" stroke={`url(#${id}-mat)`} strokeWidth={thAvg * 0.32} strokeLinecap="round" />
                  <circle cx={thAvg * 0.62} cy={thAvg * 0.62} r={thAvg * 0.15}
                    fill={`url(#${id}-mat)`} stroke={mat.dark} strokeWidth={1} />
                </>
              )}
              {orn.cornerStyle === "estrella" && (
                <path d={stampPath("star", 0, 0, thAvg * 1.2)} fill={`url(#${id}-mat)`}
                  stroke={mat.dark} strokeWidth={1} />
              )}
            </g>
          ))
        )}
        {Array.isArray(orn.shapes) && orn.shapes.slice(0, 40).map((sh: any, i: number) => {
          const d = stampPath(String(sh?.shape || "circle"), bounded(sh?.x, 0, -1000, 1500), bounded(sh?.y, 0, -1000, 1500), bounded(sh?.size, 30, 1, 500))
          return d ? <path key={`s${i}`} d={d} fill={`url(#${id}-mat)`} stroke={mat.dark} strokeWidth={1.2} /> : null
        })}
        {Array.isArray(orn.actions) && orn.actions.slice(0, 60).map((a: any, i: number) => {
          const pts = Array.isArray(a?.pts) ? a.pts : []
          if (pts.length < 2) return null
          const d = "M" + pts.slice(0, 500).map((p: any) => `${bounded(p?.x, 0, -1000, 1500)} ${bounded(p?.y, 0, -1000, 1500)}`).join("L")
          return <path key={`a${i}`} d={d} fill="none" stroke={`url(#${id}-mat)`}
            strokeWidth={bounded(a?.size, 12, 0.1, 200)} strokeLinecap="round" strokeLinejoin="round" />
        })}

        {/* Chispazos en las esquinas (cornerSpecular) */}
        {cornerSpec > 0.05 && isCard && (
          [[th.left * 1.1, th.top * 1.1], [CW - th.right * 1.1, th.top * 1.1]].map(([x, y], i) => (
            <circle key={`sp${i}`} cx={x} cy={y} r={thAvg * 0.14}
              fill={mat.sparkle > 0 ? mat.sparkleColor : "#fff"} opacity={cornerSpec * 0.35} />
          ))
        )}

        {/* DESTELLO del metal — recortado a la banda del marco */}
        {shimmerOn && (
          <g clipPath={`url(#${id}-clip)`}>
            <rect x={-shimmerW} y={-CH * 0.2} width={shimmerW} height={CH * 1.4}
              fill={`url(#${id}-shine)`}
              transform={`rotate(${sweepDeg} ${CW / 2} ${CH / 2})`}
              style={{ animation: `${id}-sweep ${shimmerDur.toFixed(2)}s ease-in-out infinite` }} />
          </g>
        )}

        {/* VIDRIO: el reflejo que faltaba, recortado al marco */}
        {glassOn && (
          <g clipPath={`url(#${id}-clip)`} className="tqf-glass">
            <path d={`${outer} ${inner}`} fillRule="evenodd" fill={`url(#${id}-glass)`} />
            {dispersion > 0.01 && (
              <path d={`${outer} ${inner}`} fillRule="evenodd" fill={`url(#${id}-disp)`}
                opacity={0.85} />
            )}
          </g>
        )}
        {/* Resplandor del canto del cristal */}
        {glassOn && edgeGlow > 0.02 && (
          <path d={outer} fill="none" stroke={glassTint} strokeWidth={2.2}
            strokeOpacity={Math.min(0.9, edgeGlow * 2)} />
        )}

        {/* Hueco del nombre, grabado en el metal */}
        {nameSlot && nameText && (
          <text x={th.left * 1.2} y={th.top * 0.68} fill={mat.dark}
            fontSize={th.top * 0.42} fontFamily="Georgia, serif"
            style={{ fontVariant: "small-caps", letterSpacing: 2 }}>
            {nameText}
          </text>
        )}
      </svg>

      {/* Animación única por instancia (antes todas compartían nombre y se pisaban).
          El reflejo del vidrio sigue la inclinación de la carta si ParallaxCover
          publica --tq-tx / --tq-ty; si no, queda quieto. */}
      <style>{`
        @keyframes ${id}-sweep {
          0%   { transform: rotate(${sweepDeg}deg) translateX(0); }
          70%,
          100% { transform: rotate(${sweepDeg}deg) translateX(${(CW + shimmerW * 2).toFixed(0)}px); }
        }
        .tqf-glass {
          /* El transform lo escribe ParallaxCover DIRECTO en este nodo.
             Antes venía de una variable CSS y eso recalculaba el estilo de
             todo el SVG en cada cuadro: ESE era el parpadeo con marco. */
          will-change: transform;
        }
      `}</style>
    </div>
  )
}
