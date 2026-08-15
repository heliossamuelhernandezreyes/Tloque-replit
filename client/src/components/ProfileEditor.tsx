import { useState, useRef } from "react"
import { motion } from "framer-motion"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Instagram, Twitter, Youtube, Globe, Send, Music2, Coffee, Heart, X, Loader2, Check, Image as ImageIcon, BookOpen, Upload, Lock } from "lucide-react"
import { compressImage } from "@/lib/image"
import { FRAMES } from "@/lib/frames"
import FrameRenderer from "@/components/FrameRenderer"
import { useFrames } from "@/hooks/useFrames"
import { useSettings } from "@/context/SettingsContext"

const NETWORKS = [
  { key: "instagram", label: "Instagram", Icon: Instagram, hint: "usuario o enlace" },
  { key: "x",         label: "X",         Icon: Twitter,   hint: "usuario o enlace" },
  { key: "telegram",  label: "Telegram",  Icon: Send,      hint: "usuario o enlace" },
  { key: "youtube",   label: "YouTube",   Icon: Youtube,   hint: "canal o enlace" },
  { key: "tiktok",    label: "TikTok",    Icon: Music2,    hint: "usuario o enlace" },
  { key: "wikipedia", label: "Wikipedia", Icon: BookOpen,  hint: "enlace de Wikipedia" },
  { key: "website",   label: "Sitio web", Icon: Globe,     hint: "https://…" },
  { key: "patreon",   label: "Patreon",   Icon: Heart,     hint: "usuario o enlace" },
  { key: "kofi",      label: "Ko-fi",     Icon: Coffee,    hint: "usuario o enlace" },
] as const

interface Props {
  authorName:    string
  initialBio:    string
  initialLinks:  Record<string, string>
  initialAvatar?: string
  initialBanner?: string
  initialFrame?: string
  isClassic?:    boolean        // true = autor clásico (admin edita vía endpoint admin)
  isAdmin?:      boolean        // admins tienen todos los marcos
  accentColor:   string
  accentGlow:    string
  onClose:       () => void
}

export default function ProfileEditor({
  authorName, initialBio, initialLinks, initialAvatar = "", initialFrame = "", initialBanner = "",
  isClassic = false, isAdmin = false,
  accentColor, accentGlow, onClose,
}: Props) {
  const queryClient = useQueryClient()
  const { usable } = useFrames()
  const galleryFrames = usable("profile")
  const { t } = useSettings()
  const [bio, setBio]       = useState(initialBio || "")
  const [links, setLinks]   = useState<Record<string, string>>({ ...initialLinks })
  const [avatar, setAvatar] = useState(initialAvatar || "")
  const [banner, setBanner] = useState(initialBanner || "")
  const [frame, setFrame]   = useState(initialFrame || "")
  const [uploadingBanner, setUploadingBanner] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [showAvatarUrl, setShowAvatarUrl]   = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const bannerRef = useRef<HTMLInputElement>(null)

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingPhoto(true)
    try {
      const compressed = await compressImage(file, 400, 0.82)  // avatar pequeño
      setAvatar(compressed)
    } catch { /* ignorar */ }
    finally {
      setUploadingPhoto(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  async function handleBanner(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingBanner(true)
    try {
      const compressed = await compressImage(file, 1200, 0.82)  // banner ancho
      setBanner(compressed)
    } catch { /* ignorar */ }
    finally {
      setUploadingBanner(false)
      if (bannerRef.current) bannerRef.current.value = ""
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      const url  = isClassic
        ? `/api/admin/authors/${encodeURIComponent(authorName)}`
        : "/api/profile"
      // Tanto el autor (su cuenta) como el clásico (admin) guardan foto y marco.
      const body: any = { bio, socialLinks: links, avatar, banner, frame }
      const res = await fetch(url, {
        method:      "PATCH",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify(body),
      })
      if (!res.ok) throw new Error(t("saveErr"))
      return res.json()
    },
    onSuccess: () => {
      setSaved(true)
      queryClient.invalidateQueries({ queryKey: [`/api/authors/${encodeURIComponent(authorName)}`] })
      queryClient.invalidateQueries({ queryKey: [`/api/authors/${encodeURIComponent(authorName)}/card`] })
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] })
      setTimeout(onClose, 900)
    },
  })

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[450] flex items-end sm:items-center justify-center p-3 sm:p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
    >
      <motion.div
        initial={{ y: 40, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl overflow-hidden max-h-[88vh] flex flex-col"
        style={{ background: "rgba(18,18,24,0.99)", border: "1px solid rgba(255,255,255,0.1)" }}
      >
        {/* Encabezado */}
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <h2 className="text-base font-display font-bold text-white">{t("editProfile")}</h2>
          <button onClick={onClose} className="p-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
            <X className="w-4 h-4 text-white/60" />
          </button>
        </div>

        {/* Contenido desplazable */}
        <div className="overflow-y-auto px-5 py-5 space-y-5">
          {/* Banner — portada del perfil */}
          <div>
            <label className="text-xs font-sans font-semibold block mb-2" style={{ color: "rgba(255,255,255,0.7)" }}>
              {t("profileBanner")}
            </label>
            <input
              ref={bannerRef}
              type="file"
              accept="image/*"
              onChange={handleBanner}
              className="hidden"
            />
            <div
              onClick={() => !uploadingBanner && bannerRef.current?.click()}
              className="relative w-full rounded-2xl overflow-hidden cursor-pointer"
              style={{
                aspectRatio: "3 / 1",
                background: banner.trim()
                  ? "transparent"
                  : `linear-gradient(135deg, ${accentGlow}22, rgba(255,255,255,0.03))`,
                border: `1px solid ${accentColor}25`,
              }}
            >
              {banner.trim() && (
                <img src={banner} alt="" className="absolute inset-0 w-full h-full object-cover" />
              )}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1"
                style={{ background: banner.trim() ? "rgba(0,0,0,0.35)" : "transparent" }}>
                {uploadingBanner ? (
                  <Loader2 className="w-5 h-5 animate-spin text-white/70" />
                ) : (
                  <>
                    <ImageIcon className="w-5 h-5" style={{ color: banner.trim() ? "rgba(255,255,255,0.9)" : accentColor }} />
                    <span className="text-[10px] font-sans" style={{ color: banner.trim() ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.55)" }}>
                      {banner.trim() ? t("changeBanner") : t("uploadBanner")}
                    </span>
                  </>
                )}
              </div>
            </div>
            {banner.trim() && (
              <button
                onClick={() => setBanner("")}
                className="text-[10px] font-sans mt-1.5"
                style={{ color: "rgba(255,120,120,0.7)" }}
              >
                {t("removeBanner")}
              </button>
            )}
          </div>

          {/* Foto de perfil — subir foto directa (todos) */}
          {(
            <div>
              <label className="text-xs font-sans font-semibold block mb-2" style={{ color: "rgba(255,255,255,0.7)" }}>
                {t("profilePhoto")}
              </label>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handlePhoto}
                className="hidden"
              />
              <div className="flex items-center gap-4">
                {/* Círculo tocable que abre la galería */}
                <button
                  onClick={() => fileRef.current?.click()}
                  className="relative w-20 h-20 rounded-full overflow-hidden flex-shrink-0 group"
                  style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${accentColor}40` }}
                >
                  {avatar.trim() ? (
                    <img src={avatar} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-6 h-6" style={{ color: "rgba(255,255,255,0.3)" }} />
                    </div>
                  )}
                  {/* Capa de subir */}
                  <div className="absolute inset-0 flex items-center justify-center transition-opacity"
                    style={{ background: "rgba(0,0,0,0.55)", opacity: avatar.trim() ? 0 : 1 }}>
                    {uploadingPhoto
                      ? <Loader2 className="w-5 h-5 animate-spin text-white" />
                      : <Upload className="w-5 h-5 text-white/80" />}
                  </div>
                </button>

                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={uploadingPhoto}
                    className="text-sm font-sans px-3.5 py-2 rounded-xl disabled:opacity-50"
                    style={{ background: `${accentColor}20`, color: accentColor, border: `1px solid ${accentColor}40` }}
                  >
                    {uploadingPhoto ? t("processing") : avatar.trim() ? t("changePhoto") : t("uploadPhoto")}
                  </button>
                  {avatar.trim() && (
                    <button
                      onClick={() => setAvatar("")}
                      className="block text-[11px] font-sans mt-2 ml-1"
                      style={{ color: "rgba(255,255,255,0.45)" }}
                    >
                      {t("removePhoto")}
                    </button>
                  )}
                </div>
              </div>

              {/* Opción avanzada: pegar enlace */}
              <button
                onClick={() => setShowAvatarUrl(v => !v)}
                className="text-[11px] font-sans mt-3"
                style={{ color: "rgba(255,255,255,0.4)" }}
              >
                {showAvatarUrl ? t("hideWord") : t("pasteImageLink")}
              </button>
              {showAvatarUrl && (
                <input
                  value={avatar.startsWith("data:") ? "" : avatar}
                  onChange={e => setAvatar(e.target.value)}
                  placeholder="https://… (ej. retrato de Wikipedia)"
                  className="w-full mt-2 rounded-lg px-3 py-2 text-[13px] font-sans outline-none text-white"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
                />
              )}
            </div>
          )}

          {/* Marco del avatar */}
          <div>
            <label className="text-xs font-sans font-semibold block mb-1" style={{ color: "rgba(255,255,255,0.7)" }}>
              {t("frameLabel")}
            </label>
            <p className="text-[11px] font-sans mb-3" style={{ color: "rgba(255,255,255,0.4)" }}>
              {isAdmin ? t("frameHintAdmin") : t("frameHint")}
            </p>
            <div className="flex flex-wrap gap-3">
              {FRAMES.map(fr => {
                const locked = fr.group === "special" && !isAdmin && fr.id !== initialFrame
                const selected = frame === fr.id
                return (
                  <button
                    key={fr.id || "none"}
                    onClick={() => { if (!locked) setFrame(fr.id) }}
                    disabled={locked}
                    className="flex flex-col items-center gap-1"
                    style={{ opacity: locked ? 0.35 : 1 }}
                  >
                    {/* Vista previa del marco */}
                    <div
                      className="rounded-full flex items-center justify-center"
                      style={{
                        width: 46, height: 46, padding: fr.id ? 3 : 1.5,
                        background: fr.id ? fr.ring : "rgba(255,255,255,0.12)",
                        boxShadow: selected
                          ? `0 0 0 2px ${accentColor}, 0 0 12px ${fr.glow || accentColor}`
                          : fr.glow ? `0 0 8px ${fr.glow}` : undefined,
                      }}
                    >
                      <div className="rounded-full" style={{ width: "100%", height: "100%", padding: 1.5, background: "rgba(15,15,20,0.9)" }}>
                        <div className="w-full h-full rounded-full flex items-center justify-center"
                          style={{ background: "rgba(255,255,255,0.06)" }}>
                          {fr.id === "" && <span className="text-[9px] font-sans" style={{ color: "rgba(255,255,255,0.4)" }}>—</span>}
                          {locked && <Lock className="w-3 h-3" style={{ color: "rgba(255,255,255,0.5)" }} />}
                        </div>
                      </div>
                    </div>
                    <span className="text-[9px] font-sans" style={{ color: selected ? accentColor : "rgba(255,255,255,0.5)" }}>
                      {t(fr.id ? `frame_${fr.id}` : "frame_none")}
                    </span>
                  </button>
                )
              })}
            </div>
            {galleryFrames.length > 0 && (
              <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-white/10">
                {galleryFrames.map(fr => {
                  const value = `gallery:${fr.id}`
                  const selected = frame === value
                  return (
                    <button key={fr.id} onClick={() => setFrame(value)} className="flex flex-col items-center gap-1">
                      <div className="w-12 h-12 rounded-full" style={{ opacity: selected ? 1 : 0.72 }}>
                        <FrameRenderer preset={fr.pkg} shape="profile" className="w-full h-full">
                          <div className="w-full h-full rounded-full bg-zinc-800" />
                        </FrameRenderer>
                      </div>
                      <span className="text-[8px] max-w-14 truncate" style={{ color: selected ? accentColor : "rgba(255,255,255,0.4)" }}>{fr.name}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Bio */}
          <div>
            <label className="text-xs font-sans font-semibold block mb-2" style={{ color: "rgba(255,255,255,0.7)" }}>
              {t("bioLabel")}
            </label>
            <textarea
              value={bio}
              onChange={e => setBio(e.target.value.slice(0, 500))}
              placeholder={t("bioPh")}
              rows={3}
              className="w-full rounded-xl px-3.5 py-3 text-sm font-sans resize-none outline-none text-white"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
            />
            <p className="text-[10px] font-sans mt-1 text-right" style={{ color: "rgba(255,255,255,0.35)" }}>
              {bio.length}/500
            </p>
          </div>

          {/* Enlaces */}
          <div>
            <label className="text-xs font-sans font-semibold block mb-1" style={{ color: "rgba(255,255,255,0.7)" }}>
              {t("linksLabel")}
            </label>
            <p className="text-[11px] font-sans mb-3" style={{ color: "rgba(255,255,255,0.4)" }}>
              {t("linksHint")}
            </p>
            <div className="space-y-2.5">
              {NETWORKS.map(n => (
                <div key={n.key} className="flex items-center gap-2.5">
                  <div className="flex-shrink-0 w-8 flex justify-center" style={{ color: "rgba(255,255,255,0.5)" }}>
                    <n.Icon className="w-[18px] h-[18px]" strokeWidth={1.6} />
                  </div>
                  <input
                    value={links[n.key] || ""}
                    onChange={e => setLinks(prev => ({ ...prev, [n.key]: e.target.value }))}
                    placeholder={`${n.key === "website" ? t("websiteWord") : n.label} · ${n.key === "website" ? "https://…" : n.key === "youtube" ? t("linkHintChannel") : n.key === "wikipedia" ? t("linkHintWiki") : t("linkHintUser")}`}
                    className="flex-1 rounded-lg px-3 py-2 text-[13px] font-sans outline-none text-white min-w-0"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Pie con guardar */}
        <div className="px-5 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          {save.isError && (
            <p className="text-[11px] font-sans mb-2" style={{ color: "#e8a0a0" }}>
              {(save.error as Error)?.message || t("saveErr")}
            </p>
          )}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => save.mutate()}
            disabled={save.isPending || saved}
            className="w-full py-3 rounded-xl text-sm font-sans font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: `linear-gradient(135deg, ${accentGlow}cc, ${accentColor})`, color: "rgba(0,0,0,0.85)" }}
          >
            {saved
              ? <><Check className="w-4 h-4" /> {t("savedWord")}</>
              : save.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("savingWord")}</>
                : t("saveProfile")}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  )
}
