import { getFrame } from "@/lib/frames"

interface Props {
  src?:         string | null
  name?:        string
  size?:        number          // diámetro en px
  frame?:       string | null
  accentColor?: string          // color del monograma de respaldo
  className?:   string
}

// Avatar consistente en toda la app: foto (o inicial) + marco opcional.
export default function UserAvatar({
  src, name, size = 40, frame, accentColor = "rgba(255,255,255,0.6)", className = "",
}: Props) {
  const f = getFrame(frame)
  const ringWidth = Math.max(2, Math.round(size * 0.065))
  const initial = (name || "?").charAt(0).toUpperCase()

  const inner = (
    <div
      className="rounded-full overflow-hidden flex items-center justify-center"
      style={{
        width: "100%", height: "100%",
        background: src ? "rgba(255,255,255,0.05)" : `${accentColor}22`,
      }}
    >
      {src ? (
        <img src={src} alt={name || ""} loading="lazy" className="w-full h-full object-cover" />
      ) : (
        <span className="font-semibold" style={{ color: accentColor, fontSize: size * 0.4 }}>
          {initial}
        </span>
      )}
    </div>
  )

  // Sin marco: solo un borde sutil
  if (!f || f.id === "") {
    return (
      <div
        className={className}
        style={{
          width: size, height: size, borderRadius: "50%",
          padding: 1.5, background: "rgba(255,255,255,0.12)",
        }}
      >
        {inner}
      </div>
    )
  }

  // Con marco: aro de degradado + resplandor
  return (
    <div
      className={className}
      style={{
        width: size, height: size, borderRadius: "50%",
        padding: ringWidth,
        background: f.ring,
        boxShadow: f.glow ? `0 0 ${size * 0.35}px ${f.glow}` : undefined,
      }}
    >
      <div
        className="rounded-full"
        style={{ width: "100%", height: "100%", padding: 1.5, background: "rgba(15,15,20,0.9)" }}
      >
        {inner}
      </div>
    </div>
  )
}
