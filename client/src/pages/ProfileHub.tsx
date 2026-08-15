import { useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { BookOpen, Check, Layers3, Pencil, ShieldCheck, Sparkles } from "lucide-react"
import { useLocation } from "wouter"
import { Layout } from "@/components/layout"
import ProfileEditor from "@/components/ProfileEditor"
import UserAvatar from "@/components/UserAvatar"
import { useAuth } from "@/hooks/useAuth"
import { useGenre } from "@/context/GenreContext"
import { useSettings } from "@/context/SettingsContext"
import { experienceText } from "@shared/experience-i18n"

export default function ProfileHub() {
  const { user, isAdmin } = useAuth()
  const { cfg } = useGenre()
  const { settings } = useSettings()
  const [, setLocation] = useLocation()
  const [editing, setEditing] = useState(false)
  const copy = (key: Parameters<typeof experienceText>[1]) => experienceText(settings.language, key)
  const completion = useMemo(() => {
    if (!user) return 0
    return (user.avatar ? 20 : 0) + (user.banner ? 20 : 0) + (user.bio?.trim().length >= 40 ? 30 : user.bio?.trim() ? 15 : 0)
      + (Object.values(user.socialLinks || {}).some(Boolean) ? 20 : 0) + (user.frame ? 10 : 0)
  }, [user])
  if (!user) return null

  const personaLabel = copy(user.persona === "admin" ? "administrator" : user.persona === "author" ? "author" : "reader")
  return (
    <Layout>
      <section className="mx-auto min-h-[70vh] w-full max-w-4xl px-4 pb-20 pt-6 sm:px-6">
        <div className="tloque-surface overflow-hidden">
          <div className="relative h-40 sm:h-52" style={{ background: `radial-gradient(circle at 18% 20%, ${cfg.glow}55, transparent 54%), #050507` }}>
            {user.banner && <img src={user.banner} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
          </div>
          <div className="relative -mt-14 px-5 pb-6 sm:px-8">
            <UserAvatar src={user.avatar} name={user.name} size={104} frame={user.frame} accentColor={cfg.color} />
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-[.22em] text-white/40">{copy("accountMode")} · {personaLabel}</p>
                <h1 className="text-2xl text-white">{user.name}</h1>
                <p className="mt-2 max-w-xl whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">{user.bio || copy("profileHint")}</p>
              </div>
              <button onClick={() => setEditing(true)} className="tloque-primary-button shrink-0" style={{ background: cfg.color }}>
                <Pencil className="h-4 w-4" /> {copy("editProfile")}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-[1.2fr_.8fr]">
          <div className="tloque-surface p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">{completion >= 100 ? copy("profileComplete") : copy("completeProfile")}</p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">{copy("profileHint")}</p>
              </div>
              <span className="text-lg font-semibold" style={{ color: cfg.color }}>{completion}%</span>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/5">
              <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${completion}%` }} style={{ background: cfg.color }} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-white/45">
              {[user.avatar, user.banner, user.bio?.trim().length >= 40, Object.values(user.socialLinks || {}).some(Boolean)].map((done, index) => (
                <span key={index} className="rounded-full border border-white/10 px-2.5 py-1">{done && <Check className="mr-1 inline h-3 w-3" />} {index === 0 ? "Avatar" : index === 1 ? "Banner" : index === 2 ? "Bio" : "Links"}</span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setLocation("/editor")} className="tloque-action-card">
              <BookOpen className="h-5 w-5" style={{ color: cfg.color }} /><span>{copy("startWriting")}</span>
            </button>
            <button onClick={() => setLocation("/editions")} className="tloque-action-card">
              <Layers3 className="h-5 w-5" style={{ color: cfg.color }} /><span>{copy("manageEditions")}</span>
            </button>
            {user.roles.author && <button onClick={() => setLocation(`/author/${encodeURIComponent(user.name)}`)} className="tloque-action-card"><Sparkles className="h-5 w-5" style={{ color: cfg.color }} /><span>{copy("profile")}</span></button>}
            {isAdmin && <button onClick={() => setLocation("/admin")} className="tloque-action-card"><ShieldCheck className="h-5 w-5" style={{ color: cfg.color }} /><span>{copy("adminCenter")}</span></button>}
          </div>
        </div>
      </section>
      <AnimatePresence>{editing && <ProfileEditor authorName={user.name} initialBio={user.bio} initialLinks={user.socialLinks} initialAvatar={user.avatar} initialBanner={user.banner} initialFrame={user.frame} isAdmin={isAdmin} accentColor={cfg.color} accentGlow={cfg.glow} onClose={() => setEditing(false)} />}</AnimatePresence>
    </Layout>
  )
}
