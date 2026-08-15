import { motion, AnimatePresence } from "framer-motion"
import { X, User, BookOpen, Volume2, Palette, Shield, Info, ChevronRight, Check, LogOut, Globe, Star } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useGenre } from "@/context/GenreContext"
import { useSettings, FONT_SIZE_LABELS, LANGUAGE_LABELS, type ReadingMode, type FontSize, type AppLanguage } from "@/context/SettingsContext"
import { useState } from "react"

interface Props {
  open:    boolean
  onClose: () => void
}

// ── Niveles de suscripción ────────────────────────────────
// PLANS generados dentro del componente para usar t()

// ── Sección colapsable ────────────────────────────────────
function Section({ icon: Icon, title, children, onOpen }: {
  icon: any; title: string; children: React.ReactNode; onOpen?: () => void
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="border-b border-white/5 last:border-0">
      <button
        onClick={() => { setOpen(o => !o); if (!open && onOpen) onOpen() }}
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
      >
        <Icon className="w-4 h-4 text-zinc-500 shrink-0" />
        <span className="flex-1 text-sm font-medium text-zinc-300 font-sans">{title}</span>
        <motion.div animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Toggle ────────────────────────────────────────────────
function Toggle({ value, onChange, label, sublabel }: {
  value: boolean; onChange: (v: boolean) => void; label: string; sublabel?: string
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm text-zinc-300 font-sans">{label}</p>
        {sublabel && <p className="text-xs text-zinc-600 font-sans mt-0.5">{sublabel}</p>}
      </div>
      <motion.button
        onClick={() => onChange(!value)}
        className="relative shrink-0 rounded-full"
        style={{
          width: 44, height: 24,
          background: value ? "rgba(160,160,255,0.3)" : "rgba(255,255,255,0.08)",
          border:     value ? "1px solid rgba(160,160,255,0.5)" : "1px solid rgba(255,255,255,0.12)",
          transition: "background 0.3s, border-color 0.3s",
        }}
        whileTap={{ scale: 0.95 }}
      >
        <motion.div
          animate={{ x: value ? 20 : 2 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
          className="absolute top-1 rounded-full"
          style={{
            width: 18, height: 18,
            background: value ? "#d0d0ff" : "rgba(255,255,255,0.35)",
          }}
        />
      </motion.button>
    </div>
  )
}

// ── Slider ────────────────────────────────────────────────
function Slider({ value, onChange, label, min = 0, max = 1, step = 0.05 }: {
  value: number; onChange: (v: number) => void; label: string
  min?: number; max?: number; step?: number
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <p className="text-sm text-zinc-300 font-sans">{label}</p>
        <p className="text-xs text-zinc-500 font-sans">{Math.round(value * 100)}%</p>
      </div>
      <div className="relative h-1.5 rounded-full bg-white/8">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-all"
          style={{
            width: `${((value - min) / (max - min)) * 100}%`,
            background: "linear-gradient(to right, rgba(160,160,255,0.6), #d0d0ff)",
          }}
        />
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
        />
      </div>
    </div>
  )
}

// ── Panel principal ───────────────────────────────────────
export default function ConfigPanel({ open, onClose }: Props) {
  const { user, logout, isAdmin } = useAuth()
  const { cfg }                = useGenre()
  const { settings, updateSetting, t } = useSettings()

  const PLANS = [
    {
      key:   "free",
      name:  t("planFree"),
      price: t("planFreePrice"),
      color: "rgba(255,255,255,0.5)",
      glow:  "rgba(255,255,255,0.1)",
      perks: [t("perkUnlimited"), t("perkBasicVoice"), t("perkSearch")],
    },
    {
      key:   "estetic",
      name:  t("planEstetic"),
      price: "$20 MXN/mes",
      color: "#d0d0ff",
      glow:  "rgba(112,112,238,0.25)",
      perks: [t("perkPrevious"), t("perkOracle"), t("perkAmbient"), t("perkThemes")],
      badge: t("perkPopular"),
    },
    {
      key:   "audio",
      name:  t("planAudio"),
      price: "$59 MXN/mes",
      color: "#ffe090",
      glow:  "rgba(204,136,0,0.25)",
      perks: [t("perkPrevious"), t("perkElevenLabs"), t("perkDownloads"), t("perkVoices")],
      badge: t("perkPremium"),
    },
  ]
  const [adminList,    setAdminList]    = useState<{id:number,email:string,addedBy:string}[]>([])
  const [adminLoaded,  setAdminLoaded]  = useState(false)
  const [newAdminEmail,setNewAdminEmail]= useState("")
  const [adminWorking, setAdminWorking] = useState(false)
  // Cargar lista de admins cuando se abre la sección
  async function loadAdmins() {
    if (adminLoaded) return
    try {
      const res = await fetch("/api/admin/admins", { credentials: "include" })
      if (res.ok) {
        setAdminList(await res.json())
        setAdminLoaded(true)
      }
    } catch {}
  }

  async function addAdmin() {
    const email = newAdminEmail.trim()
    if (!email || !email.includes("@")) return
    setAdminWorking(true)
    try {
      const res = await fetch("/api/admin/admins", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      })
      if (res.ok) {
        const row = await res.json()
        setAdminList(prev => [...prev, row])
        setNewAdminEmail("")
      }
    } catch {} finally { setAdminWorking(false) }
  }

  async function removeAdmin(email: string) {
    setAdminWorking(true)
    try {
      const res = await fetch(`/api/admin/admins/${encodeURIComponent(email)}`, {
        method: "DELETE", credentials: "include",
      })
      if (res.ok) setAdminList(prev => prev.filter(a => a.email !== email))
    } catch {} finally { setAdminWorking(false) }
  }


  const [activePlan]           = useState("free") // TODO: conectar a backend
  const [showPlans, setShowPlans] = useState(false)

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[200]"
            style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ y: "100%", opacity: 0.8 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 36 }}
            className="fixed bottom-0 left-0 right-0 z-[210] rounded-t-3xl overflow-hidden"
            style={{
              background:  "rgba(8,8,12,0.98)",
              border:      `1px solid ${cfg.color}20`,
              borderBottom: "none",
              boxShadow:   `0 -8px 64px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04)`,
              maxHeight:   "88vh",
            }}
          >
            {/* Indicador de arrastre */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-white/15" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3">
              <h2 className="text-base font-display font-bold text-white tracking-wide">
                Configuración
              </h2>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={onClose}
                className="p-2 rounded-full"
                style={{ background: "rgba(255,255,255,0.06)" }}
              >
                <X className="w-4 h-4 text-zinc-400" />
              </motion.button>
            </div>

            {/* Contenido scrollable */}
            <div className="overflow-y-auto" style={{ maxHeight: "calc(88vh - 80px)" }}>

              {/* ── CUENTA ── */}
              <Section icon={User} title={t("sectionAccount")}>
                {/* Perfil */}
                <div className="flex items-center gap-3 p-3 rounded-2xl"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  {user?.avatar ? (
                    <img loading="lazy" src={user.avatar} className="w-12 h-12 rounded-full object-cover shrink-0"
                      alt={user.name} />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
                      <User className="w-5 h-5 text-zinc-500" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium font-sans truncate">{user?.name}</p>
                    <p className="text-zinc-500 text-xs font-sans truncate">{user?.email}</p>
                  </div>
                </div>

                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={logout}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-sans"
                  style={{
                    background: "rgba(255,60,60,0.08)",
                    border:     "1px solid rgba(255,60,60,0.2)",
                    color:      "rgba(255,100,100,0.9)",
                  }}
                >
                  <LogOut className="w-4 h-4" />
                  Cerrar sesión
                </motion.button>
              </Section>

              {/* ── SUSCRIPCIÓN ── */}
              <Section icon={ChevronRight} title={t("sectionSubscription")}>
                {/* Plan actual */}
                {!showPlans ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 rounded-xl"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <div>
                        <p className="text-white text-sm font-medium font-sans">Plan Lector</p>
                        <p className="text-zinc-500 text-xs font-sans">Gratuito</p>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-sans uppercase tracking-wide"
                        style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>
                        Activo
                      </span>
                    </div>
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={() => setShowPlans(true)}
                      className="w-full py-3 rounded-xl text-sm font-sans font-medium"
                      style={{
                        background: `linear-gradient(135deg, ${cfg.bg}, rgba(0,0,0,0.5))`,
                        border:     `1px solid ${cfg.color}40`,
                        color:      cfg.color,
                      }}
                    >
                      Ver planes disponibles ✦
                    </motion.button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {PLANS.map(plan => (
                      <motion.div
                        key={plan.key}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="relative p-4 rounded-2xl"
                        style={{
                          background: plan.key === activePlan
                            ? plan.glow : "rgba(255,255,255,0.03)",
                          border: `1px solid ${plan.key === activePlan ? plan.color + "60" : "rgba(255,255,255,0.07)"}`,
                        }}
                      >
                        {plan.badge && (
                          <span className="absolute -top-2.5 right-4 text-[9px] px-2 py-0.5 rounded-full font-sans uppercase tracking-wide"
                            style={{ background: plan.color, color: "black", fontWeight: 700 }}>
                            {plan.badge}
                          </span>
                        )}
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <p className="font-display text-sm font-bold" style={{ color: plan.color }}>
                              {plan.name}
                            </p>
                            <p className="text-xs font-sans mt-0.5" style={{ color: plan.color + "99" }}>
                              {plan.price}
                            </p>
                          </div>
                          {plan.key === activePlan && (
                            <div className="w-5 h-5 rounded-full flex items-center justify-center"
                              style={{ background: plan.color }}>
                              <Check className="w-3 h-3 text-black" />
                            </div>
                          )}
                        </div>
                        <ul className="space-y-1.5 mb-3">
                          {plan.perks.map(perk => (
                            <li key={perk} className="flex items-center gap-2 text-xs text-zinc-400 font-sans">
                              <span style={{ color: plan.color + "99" }}>✦</span>
                              {perk}
                            </li>
                          ))}
                        </ul>
                        {plan.key !== activePlan && (
                          <motion.button
                            whileTap={{ scale: 0.97 }}
                            className="w-full py-2.5 rounded-xl text-xs font-sans font-medium"
                            style={{
                              background: plan.glow,
                              border:     `1px solid ${plan.color}40`,
                              color:      plan.color,
                            }}
                          >
                            Cambiar a {plan.name}
                          </motion.button>
                        )}
                      </motion.div>
                    ))}
                    <button onClick={() => setShowPlans(false)}
                      className="w-full text-xs text-zinc-600 font-sans py-1">
                      Ocultar planes
                    </button>
                  </div>
                )}
              </Section>

              {/* ── LECTOR ── */}
              <Section icon={BookOpen} title={t("sectionReading")}>
                {/* Modo de lectura */}
                <div className="space-y-2">
                  <p className="text-xs text-zinc-500 font-sans uppercase tracking-widest">Fondo</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(["night", "twilight", "dawn"] as ReadingMode[]).map(mode => {
                      const colors = {
                        night:   { bg: "#000",    text: "#d4d4d8", label: t("readingNight")    },
                        twilight:{ bg: "#0d0a08", text: "#c9b99a", label: t("readingTwilight") },
                        dawn:    { bg: "#f5f0e8", text: "#3d3320", label: t("readingDawn")     },
                      }
                      const c = colors[mode]
                      const active = settings.readingMode === mode
                      return (
                        <motion.button
                          key={mode}
                          whileTap={{ scale: 0.93 }}
                          onClick={() => updateSetting("readingMode", mode)}
                          className="flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all"
                          style={{
                            background:   c.bg,
                            borderColor:  active ? cfg.color + "80" : "rgba(255,255,255,0.1)",
                            boxShadow:    active ? `0 0 12px ${cfg.glow}40` : "none",
                          }}
                        >
                          <span className="text-[11px] font-sans" style={{ color: c.text }}>
                            Aa
                          </span>
                          <span className="text-[9px] font-sans tracking-wide"
                            style={{ color: active ? cfg.color : "rgba(255,255,255,0.35)" }}>
                            {c.label}
                          </span>
                        </motion.button>
                      )
                    })}
                  </div>
                </div>

                {/* Tamaño de fuente */}
                <div className="space-y-2">
                  <p className="text-xs text-zinc-500 font-sans uppercase tracking-widest">{t("textSize")}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(["small", "medium", "large"] as FontSize[]).map(size => {
                      const active = settings.fontSize === size
                      const sizes = { small: "text-xs", medium: "text-sm", large: "text-base" }
                      return (
                        <motion.button
                          key={size}
                          whileTap={{ scale: 0.93 }}
                          onClick={() => updateSetting("fontSize", size)}
                          className="flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all"
                          style={{
                            background:  active ? cfg.bg : "rgba(255,255,255,0.03)",
                            borderColor: active ? cfg.color + "80" : "rgba(255,255,255,0.08)",
                            boxShadow:   active ? `0 0 12px ${cfg.glow}30` : "none",
                          }}
                        >
                          <span className={`${sizes[size]} text-zinc-300 font-serif`}>Aa</span>
                          <span className="text-[9px] font-sans tracking-wide"
                            style={{ color: active ? cfg.color : "rgba(255,255,255,0.35)" }}>
                            {FONT_SIZE_LABELS[size]}
                          </span>
                        </motion.button>
                      )
                    })}
                  </div>
                </div>

                {/* Espaciado */}
                <div className="space-y-2">
                  <p className="text-xs text-zinc-500 font-sans uppercase tracking-widest">Espaciado</p>
                  <div className="flex gap-2">
                    {(["compact", "normal", "relaxed"] as const).map(sp => {
                      const labels = { compact: "Compacto", normal: "Normal", relaxed: "Amplio" }
                      const active = settings.lineSpacing === sp
                      return (
                        <motion.button key={sp} whileTap={{ scale: 0.93 }}
                          onClick={() => updateSetting("lineSpacing", sp)}
                          className="flex-1 py-2 rounded-lg text-[11px] font-sans border transition-all"
                          style={{
                            background:  active ? cfg.bg : "rgba(255,255,255,0.03)",
                            borderColor: active ? cfg.color + "70" : "rgba(255,255,255,0.08)",
                            color:       active ? cfg.color : "rgba(255,255,255,0.4)",
                          }}>
                          {labels[sp]}
                        </motion.button>
                      )
                    })}
                  </div>
                </div>
              </Section>

              {/* ── SONIDOS ── */}
              <Section icon={Volume2} title={t("sectionSounds")}>
                <Toggle
                  value={settings.orbSounds}
                  onChange={v => updateSetting("orbSounds", v)}
                  label="Efectos de orbes"
                  sublabel={t("orbSoundsSub")}
                />
                {settings.orbSounds && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <Slider
                      value={settings.soundVolume}
                      onChange={v => updateSetting("soundVolume", v)}
                      label={t("orbSoundsLabel")}
                    />
                  </motion.div>
                )}
              </Section>

              {/* ── IDIOMA ── */}
              <Section icon={Globe} title={t("sectionLanguage")}>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.entries(LANGUAGE_LABELS) as [AppLanguage, string][]).map(([code, label]) => (
                    <motion.button
                      key={code}
                      whileTap={{ scale: 0.94 }}
                      onClick={() => updateSetting("language", code)}
                      className="flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl text-xs font-sans transition-all"
                      style={settings.language === code ? {
                        background: `${cfg.bg}`,
                        border:     `1px solid ${cfg.color}50`,
                        color:      cfg.color,
                        boxShadow:  `0 0 12px ${cfg.glow}25`,
                      } : {
                        background: "rgba(255,255,255,0.03)",
                        border:     "1px solid rgba(255,255,255,0.07)",
                        color:      "rgba(255,255,255,0.35)",
                      }}
                    >
                      {settings.language === code && (
                        <Check className="w-2.5 h-2.5" style={{ color: cfg.color }} />
                      )}
                      <span className="truncate w-full text-center leading-tight">{label}</span>
                    </motion.button>
                  ))}
                </div>
                <p className="text-[10px] text-zinc-700 font-sans mt-2 leading-relaxed">
                  {t("languageNote")}
                </p>
              </Section>

              {/* ── APARIENCIA ── */}
              <Section icon={Palette} title={t("sectionAppearance")}>
                <Slider
                  value={settings.cosmicIntensity}
                  onChange={v => updateSetting("cosmicIntensity", v)}
                  label={t("cosmicIntensity")}
                />
              </Section>

              {/* ── PRIVACIDAD ── */}
              <Section icon={Shield} title={t("sectionPrivacy")}>
                <div className="space-y-3">
                  <motion.button whileTap={{ scale: 0.97 }}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-sans"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.6)" }}>
                    Exportar mis datos
                    <ChevronRight className="w-4 h-4 text-zinc-600" />
                  </motion.button>
                  <motion.button whileTap={{ scale: 0.97 }}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-sans"
                    style={{ background: "rgba(255,60,60,0.06)", border: "1px solid rgba(255,60,60,0.15)", color: "rgba(255,100,100,0.7)" }}>
                    Eliminar cuenta
                    <ChevronRight className="w-4 h-4" />
                  </motion.button>
                  <p className="text-[10px] text-zinc-700 font-sans leading-relaxed">
                    La exportación incluye únicamente tu perfil, preferencias e historial de lectura.
                    El contenido de autores no puede exportarse.
                  </p>
                </div>
              </Section>

              {/* ── SOBRE TLOQUE ── */}
              {/* ── ADMINISTRADORES — solo visible para admin ── */}
              {user && isAdmin && (
                <Section
                  icon={Star}
                  title={t("adminSection")}
                  onOpen={loadAdmins}
                >
                  <div className="space-y-3">
                    {/* Switch modo admin */}
                    <div
                      className="flex items-center justify-between p-3 rounded-xl"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
                    >
                      <div className="flex-1 mr-3">
                        <p className="text-xs font-sans text-white/70">{t("adminModeLabel")}</p>
                        <p className="text-[10px] font-sans text-zinc-600 mt-0.5">{t("adminModeSub")}</p>
                      </div>
                      <motion.button
                        whileTap={{ scale: 0.92 }}
                        onClick={() => updateSetting("adminMode", !settings.adminMode)}
                        className="relative w-11 h-6 rounded-full transition-colors duration-300 shrink-0"
                        style={{
                          background: settings.adminMode
                            ? `linear-gradient(135deg, ${cfg.color}, ${cfg.glow})`
                            : "rgba(255,255,255,0.1)",
                          boxShadow: settings.adminMode ? `0 0 12px ${cfg.glow}50` : "none",
                        }}
                      >
                        <motion.div
                          animate={{ x: settings.adminMode ? 20 : 2 }}
                          transition={{ type: "spring", stiffness: 400, damping: 25 }}
                          className="absolute top-1 w-4 h-4 rounded-full"
                          style={{ background: settings.adminMode ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.4)" }}
                        />
                      </motion.button>
                    </div>
                    {/* Lista de admins */}
                    <div className="space-y-1.5">
                      {adminList.map(admin => (
                        <div key={admin.id}
                          className="flex items-center gap-2 px-3 py-2 rounded-xl"
                          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-sans text-white/80 truncate">{admin.email}</p>
                            <p className="text-[9px] font-sans text-zinc-700">
                              {admin.addedBy === "system" ? "Fundador" : `Por ${admin.addedBy}`}
                            </p>
                          </div>
                          {admin.addedBy !== "system" && (
                            <motion.button
                              whileTap={{ scale: 0.9 }}
                              disabled={adminWorking}
                              onClick={() => removeAdmin(admin.email)}
                              className="p-1.5 rounded-lg"
                              style={{ background: "rgba(255,60,60,0.1)", color: "rgba(255,80,80,0.7)" }}
                            >
                              <X className="w-3 h-3" />
                            </motion.button>
                          )}
                        </div>
                      ))}
                      {adminList.length === 0 && !adminLoaded && (
                        <p className="text-xs text-zinc-700 font-sans text-center py-2">Cargando...</p>
                      )}
                    </div>
                    {/* Agregar admin */}
                    <div className="flex gap-2">
                      <input
                        value={newAdminEmail}
                        onChange={e => setNewAdminEmail(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && addAdmin()}
                        placeholder="nuevo@email.com"
                        className="flex-1 text-xs font-sans outline-none rounded-xl px-3 py-2"
                        style={{
                          background: "rgba(255,255,255,0.04)",
                          border:     `1px solid ${cfg.color}30`,
                          color:      "white",
                          caretColor: cfg.color,
                        }}
                      />
                      <motion.button
                        whileTap={{ scale: 0.93 }}
                        disabled={adminWorking || !newAdminEmail.includes("@")}
                        onClick={addAdmin}
                        className="px-3 py-2 rounded-xl text-xs font-sans font-medium"
                        style={{
                          background: `${cfg.bg}`,
                          color:      cfg.color,
                          border:     `1px solid ${cfg.color}40`,
                          opacity:    adminWorking ? 0.5 : 1,
                        }}
                      >
                        + Agregar
                      </motion.button>
                    </div>
                    <p className="text-[9px] text-zinc-700 font-sans leading-relaxed">
                      Los administradores pueden importar y borrar clásicos del catálogo.
                    </p>
                  </div>
                </Section>
              )}

              <Section icon={Info} title={t("sectionAbout")}>
                <div className="space-y-3 pb-2">
                  <div className="flex justify-between text-sm font-sans">
                    <span className="text-zinc-500">{t("versionLabel")}</span>
                    <span className="text-zinc-400">0.1.0 Alpha</span>
                  </div>
                  <div className="flex justify-between text-sm font-sans">
                    <span className="text-zinc-500">{t("platformLabel")}</span>
                    <span className="text-zinc-400">Web · Replit</span>
                  </div>
                  <div
                    className="p-3 rounded-xl text-center"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
                  >
                    <p className="text-[11px] text-zinc-600 font-sans leading-relaxed italic">
                      {t("tagline")}
                    </p>
                    <p className="text-[10px] text-zinc-700 font-sans mt-1">
                      {t("madeBy")}
                    </p>
                  </div>
                </div>
              </Section>

              {/* Espacio inferior para los orbes */}
              <div className="h-32" />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
