import { useState } from "react"
import {
  ChevronRight,
  Banknote,
  FlaskConical,
  Headphones,
  Import,
  Loader2,
  MonitorCog,
  PackageCheck,
  RefreshCw,
  Shield,
  Sparkles,
  Ticket,
  Trash2,
  UserPlus,
} from "lucide-react"
import { useLocation } from "wouter"
import { Layout } from "@/components/layout"
import ImportPanel from "@/components/ImportPanel"
import { useAuth } from "@/hooks/useAuth"
import { useGenre } from "@/context/GenreContext"
import { useSettings } from "@/context/SettingsContext"
import { experienceText } from "@shared/experience-i18n"

type Admin = { id: number; email: string; addedBy: string }

export default function AdminHub() {
  const { isAdmin } = useAuth()
  const { cfg } = useGenre()
  const { settings, updateSetting, t } = useSettings()
  const [, setLocation] = useLocation()
  const [showImport, setShowImport] = useState(false)
  const [admins, setAdmins] = useState<Admin[]>([])
  const [loaded, setLoaded] = useState(false)
  const [email, setEmail] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const copy = (key: Parameters<typeof experienceText>[1]) => experienceText(settings.language, key)

  async function loadAdmins(force = false) {
    if (loaded && !force) return
    setWorking(true)
    setError("")
    try {
      const response = await fetch("/api/admin/admins", { credentials: "include" })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setAdmins(await response.json())
      setLoaded(true)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "HTTP")
    } finally {
      setWorking(false)
    }
  }

  async function addAdmin() {
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail.includes("@")) return
    setWorking(true)
    setError("")
    try {
      const response = await fetch("/api/admin/admins", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const row: Admin = await response.json()
      setAdmins(current => [...current.filter(admin => admin.email !== row.email), row])
      setEmail("")
      setLoaded(true)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "HTTP")
    } finally {
      setWorking(false)
    }
  }

  async function removeAdmin(value: string) {
    setWorking(true)
    setError("")
    try {
      const response = await fetch(`/api/admin/admins/${encodeURIComponent(value)}`, {
        method: "DELETE",
        credentials: "include",
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setAdmins(current => current.filter(admin => admin.email !== value))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "HTTP")
    } finally {
      setWorking(false)
    }
  }

  if (!isAdmin) {
    return (
      <Layout>
        <div className="mx-auto max-w-xl px-5 py-24 text-center">
          <Shield className="mx-auto h-8 w-8 text-white/20" />
          <h1 className="mt-4 text-xl text-white">{copy("noAccess")}</h1>
        </div>
      </Layout>
    )
  }

  const tools = [
    { label: copy("catalog"), Icon: Import, action: () => setShowImport(true) },
    { label: "Liquidaciones", Icon: Banknote, action: () => setLocation("/admin/liquidaciones") },
    { label: t("gachaTitle"), Icon: Ticket, action: () => setLocation("/sorteo") },
    { label: copy("frames"), Icon: Sparkles, action: () => setLocation("/admin/marcos") },
    { label: copy("phonotheque"), Icon: Headphones, action: () => setLocation("/admin/fonoteca") },
    { label: "Instrumentos premium", Icon: PackageCheck, action: () => setLocation("/admin/audio/keyboards") },
    { label: "Laboratorio acústico", Icon: FlaskConical, action: () => setLocation("/admin/audio/physical-models") },
    { label: copy("diagnostics"), Icon: MonitorCog, action: () => setLocation("/admin/diag") },
  ]

  return (
    <Layout>
      <section className="mx-auto w-full max-w-5xl px-4 pb-24 pt-8 sm:px-6">
        <p className="tloque-eyebrow">Tloque · Admin</p>
        <h1 className="mt-1 text-2xl text-white">{copy("adminCenter")}</h1>
        <p className="mt-2 text-sm text-zinc-500">{copy("adminCenterHint")}</p>

        <div className="my-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          {tools.map(({ label, Icon, action }) => (
            <button
              key={label}
              onClick={action}
              className="group flex min-h-20 items-center gap-3 rounded-2xl border border-white/[.07] bg-white/[.025] px-4 py-3 text-left transition-colors hover:bg-white/[.055]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[.04]">
                <Icon className="h-4 w-4" style={{ color: cfg.color }} />
              </span>
              <span className="min-w-0 flex-1 text-xs font-medium leading-snug text-white/70 group-hover:text-white">
                {label}
              </span>
              <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-white/15 xl:block" />
            </button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="tloque-surface p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-white">{copy("adminOverlay")}</p>
                <p className="mt-1 text-xs text-zinc-600">{copy("adminOverlayHint")}</p>
              </div>
              <button
                role="switch"
                aria-checked={settings.adminMode}
                onClick={() => updateSetting("adminMode", !settings.adminMode)}
                className={`relative h-7 w-12 shrink-0 rounded-full border transition ${settings.adminMode ? "border-violet-300/40 bg-violet-300/25" : "border-white/10 bg-white/5"}`}
              >
                <span className={`absolute top-1 h-5 w-5 rounded-full bg-white/70 transition-transform ${settings.adminMode ? "translate-x-5" : "translate-x-1"}`} />
              </button>
            </div>
          </div>

          <div className="tloque-surface p-5" aria-busy={working}>
            <div className="flex items-center justify-between gap-3">
              <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => loadAdmins()}>
                <span className="text-sm font-medium text-white">{copy("admins")}</span>
                {!loaded && <UserPlus className="h-4 w-4 text-white/35" />}
              </button>
              {loaded && (
                <button
                  onClick={() => loadAdmins(true)}
                  disabled={working}
                  aria-label={copy("admins")}
                  className="rounded-lg p-1.5 text-white/30 transition-colors hover:bg-white/5 hover:text-white/60 disabled:opacity-40"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${working ? "animate-spin" : ""}`} />
                </button>
              )}
            </div>

            {working && !loaded && (
              <div className="flex items-center gap-2 pt-4 text-xs text-white/35">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {copy("admins")}
              </div>
            )}

            {error && (
              <p role="alert" className="mt-3 rounded-xl border border-red-300/10 bg-red-300/[.04] px-3 py-2 text-xs text-red-200/65">
                {error}
              </p>
            )}

            {loaded && (
              <div className="mt-4 space-y-2">
                {admins.map(admin => (
                  <div key={admin.id} className="flex items-center gap-2 rounded-xl bg-white/[.03] px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-white/70">{admin.email}</p>
                      <p className="text-[10px] text-white/25">{admin.addedBy === "system" ? copy("founder") : admin.addedBy}</p>
                    </div>
                    {admin.addedBy !== "system" && (
                      <button
                        aria-label={`${copy("remove")} ${admin.email}`}
                        disabled={working}
                        onClick={() => removeAdmin(admin.email)}
                        className="rounded-lg p-1.5 transition-colors hover:bg-red-300/[.06] disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-300/45" />
                      </button>
                    )}
                  </div>
                ))}
                <div className="flex gap-2 pt-2">
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                    onKeyDown={event => event.key === "Enter" && addAdmin()}
                    placeholder="email@dominio.com"
                    className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-xs text-white outline-none focus:border-white/20"
                  />
                  <button
                    onClick={addAdmin}
                    disabled={working || !email.includes("@")} 
                    className="tloque-primary-button disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ background: cfg.color }}
                  >
                    {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : copy("addAdmin")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
      <ImportPanel open={showImport} onClose={() => setShowImport(false)} />
    </Layout>
  )
}
