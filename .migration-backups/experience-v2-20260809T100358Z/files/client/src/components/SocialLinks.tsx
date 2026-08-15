import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Instagram, Twitter, Youtube, Globe, Send, Music2, Coffee, Heart, ExternalLink, X, BookOpen } from "lucide-react"
import { useSettings } from "@/context/SettingsContext"

// Redes permitidas, en dos grupos: seguir y apoyar.
const FOLLOW = [
  { key: "instagram", label: "Instagram", Icon: Instagram, base: "https://instagram.com/" },
  { key: "x",         label: "X",         Icon: Twitter,   base: "https://x.com/" },
  { key: "telegram",  label: "Telegram",  Icon: Send,      base: "https://t.me/" },
  { key: "youtube",   label: "YouTube",   Icon: Youtube,   base: "https://youtube.com/@" },
  { key: "tiktok",    label: "TikTok",    Icon: Music2,    base: "https://tiktok.com/@" },
  { key: "wikipedia", label: "Wikipedia", Icon: BookOpen,  base: "" },
  { key: "website",   label: "Sitio web", Icon: Globe,     base: "" },
] as const

const SUPPORT = [
  { key: "patreon", label: "Patreon", Icon: Heart,  base: "https://patreon.com/" },
  { key: "kofi",    label: "Ko-fi",   Icon: Coffee, base: "https://ko-fi.com/" },
] as const

// Convierte un valor guardado (handle o URL) en una URL completa
function buildUrl(base: string, value: string): string {
  const v = value.trim()
  if (/^https?:\/\//i.test(v)) return v
  if (base === "") return `https://${v.replace(/^\/+/, "")}`   // sitio web sin protocolo
  return base + v.replace(/^@+/, "")
}

interface Props {
  links:       Record<string, string>
  accentColor: string
  /** Color base de los iconos (texto). En el perfil oscuro, algo claro. */
  iconColor?:  string
}

export default function SocialLinks({ links, accentColor, iconColor = "rgba(255,255,255,0.55)" }: Props) {
  const { t } = useSettings()
  const [pending, setPending] = useState<{ url: string; label: string } | null>(null)

  const follow  = FOLLOW.filter(s => links[s.key]?.trim())
  const support = SUPPORT.filter(s => links[s.key]?.trim())

  if (follow.length === 0 && support.length === 0) return null

  const renderIcon = (s: any) => {
    const url = buildUrl(s.base, links[s.key])
    const label = s.key === "website" ? t("websiteWord") : s.label
    return (
      <motion.button
        key={s.key}
        whileTap={{ scale: 0.9 }}
        whileHover={{ scale: 1.08 }}
        onClick={() => setPending({ url, label })}
        className="p-2.5 rounded-full transition-colors duration-300"
        style={{ color: iconColor, background: "rgba(255,255,255,0.04)" }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = accentColor }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = iconColor }}
        aria-label={label}
      >
        <s.Icon className="w-[18px] h-[18px]" strokeWidth={1.6} />
      </motion.button>
    )
  }

  return (
    <>
      <div className="flex items-center justify-center gap-1 flex-wrap">
        {follow.map(renderIcon)}

        {/* Separador sutil entre seguir y apoyar */}
        {follow.length > 0 && support.length > 0 && (
          <div className="mx-1.5 w-px h-5 rounded-full" style={{ background: "rgba(255,255,255,0.12)" }} />
        )}

        {support.map(renderIcon)}
      </div>

      {/* Advertencia de salida de Tloque */}
      <AnimatePresence>
        {pending && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPending(null)}
            className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
          >
            <motion.div
              initial={{ y: 30, opacity: 0, scale: 0.96 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 30, opacity: 0 }}
              transition={{ type: "spring", stiffness: 280, damping: 24 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-sm rounded-3xl p-6"
              style={{ background: "rgba(20,20,26,0.98)", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="p-2 rounded-full" style={{ background: `${accentColor}20` }}>
                  <ExternalLink className="w-4 h-4" style={{ color: accentColor }} />
                </div>
                <span className="text-sm font-sans font-semibold text-white">{t("leaveTloque")}</span>
              </div>
              <p className="text-[13px] font-sans leading-relaxed mb-5" style={{ color: "rgba(255,255,255,0.6)" }}>
                {t("externalLinkBody").replace("{x}", pending.label)}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setPending(null)}
                  className="flex-1 py-3 rounded-xl text-sm font-sans"
                  style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)" }}
                >
                  {t("cancel")}
                </button>
                <button
                  onClick={() => {
                    window.open(pending.url, "_blank", "noopener,noreferrer")
                    setPending(null)
                  }}
                  className="flex-1 py-3 rounded-xl text-sm font-sans font-semibold"
                  style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)`, color: "rgba(0,0,0,0.85)" }}
                >
                  {t("continueWord")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
