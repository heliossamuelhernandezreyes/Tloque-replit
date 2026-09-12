import { useId, type ReactNode } from "react"
import type { FrameScene } from "@shared/frame-scene"

/** Lightweight essential/collection preview. The inspector uses the full shared 3D scene. */
export default function FramePoster({ scene, shape = "card", className = "", children, asOverlay = false }: {
  scene: FrameScene; shape?: "card" | "profile"; className?: string; children?: ReactNode; asOverlay?: boolean
}) {
  const id = useId().replace(/:/g, "")
  const profile = shape === "profile", height = profile ? 3.3 : 4.5
  const { color, accent } = scene.material
  return <div className={`tq-frame-poster ${className}`} data-frame-renderer="scene-v2-poster" style={{ position: asOverlay ? "absolute" : "relative", inset: asOverlay ? 0 : undefined, width: "100%", height: asOverlay ? "100%" : undefined, aspectRatio: asOverlay ? undefined : `3.3 / ${height}`, pointerEvents: "none" }}>
    {!asOverlay && <div style={{ position: "absolute", inset: profile ? "18%" : "16.7% 17.9%", overflow: "hidden", borderRadius: profile ? "50%" : "5%", background: scene.portal.enabled ? `radial-gradient(ellipse at 30% 20%, ${scene.portal.color}, #080b16 90%)` : "#080b16" }}>{children}</div>}
    <svg viewBox={`-1.65 ${-height / 2} 3.3 ${height}`} preserveAspectRatio={asOverlay ? "none" : "xMidYMid meet"} width="100%" height="100%" style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden="true">
      <defs><linearGradient id={`${id}m`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f6edda"/><stop offset=".24" stopColor={color}/><stop offset=".52" stopColor="#33323e"/><stop offset=".77" stopColor={color}/><stop offset="1" stopColor="#eee2c2"/></linearGradient></defs>
      {asOverlay && <path fill="#0c0e14" fillRule="evenodd" d={`M-1.65 ${-height / 2}h3.3v${height}h-3.3Z ${profile ? "M-1.05 0a1.05 1.05 0 1 0 2.1 0a1.05 1.05 0 1 0-2.1 0Z" : "M-.94-1.5H.94Q1.06-1.5 1.06-1.38V1.38Q1.06 1.5 .94 1.5H-.94Q-1.06 1.5-1.06 1.38V-1.38Q-1.06-1.5-.94-1.5Z"}`}/>}
      {profile ? <circle r={1.05 + scene.geometry.width / 2} fill="none" stroke={`url(#${id}m)`} strokeWidth={scene.geometry.width}/> : <rect x={-1.06 - scene.geometry.width / 2} y={-1.5 - scene.geometry.width / 2} width={2.12 + scene.geometry.width} height={3 + scene.geometry.width} rx={scene.geometry.radius} fill="none" stroke={`url(#${id}m)`} strokeWidth={scene.geometry.width}/>}
      {Array.from({ length: scene.geometry.ornaments }, (_, i) => {
        const angle = i / scene.geometry.ornaments * Math.PI * 2
        const edge = profile ? 1 : Math.max(Math.abs(Math.sin(angle)), Math.abs(Math.cos(angle)))
        return <g key={i} transform={`translate(${Math.sin(angle) / edge * 1.18} ${-Math.cos(angle) / edge * (profile ? 1.18 : 1.65)}) rotate(${angle * 180 / Math.PI})`}>
          {scene.style === "bloom" ? <path d="M0 .08Q-.43-.3-.2-.52Q0-.35 0 .08Q.43-.3.2-.52Q0-.35 0 .08" fill={`url(#${id}m)`}/> : <path d="M0-.37L.13-.03 0 .22-.13-.03ZM-.13 .1L-.21-.36-.06-.14M.13 .1L.21-.36.06-.14" fill={`url(#${id}m)`}/>}
          <circle r=".19" fill="none" stroke={accent} strokeWidth=".012" opacity=".6"/>
          <path d="M0-.22L.075-.1 0 .07-.075-.1Z" fill={accent}/>
        </g>
      })}
      <g transform={`translate(0 ${profile ? -1.2 : -1.67})`}><circle r=".29" fill="none" stroke={`url(#${id}m)`} strokeWidth=".025"/><ellipse rx=".34" ry=".12" fill="none" stroke={accent} strokeWidth=".012"/><path d="M0-.19L.12 0 0 .19-.12 0Z" fill={accent}/></g>
    </svg>
  </div>
}
