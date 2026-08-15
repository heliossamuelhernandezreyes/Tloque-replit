import { useState } from "react"
import { Headphones, Import, MonitorCog, Shield, Sparkles, Trash2, UserPlus } from "lucide-react"
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
  const { settings, updateSetting } = useSettings()
  const [, setLocation] = useLocation()
  const [showImport, setShowImport] = useState(false)
  const [admins, setAdmins] = useState<Admin[]>([])
  const [loaded, setLoaded] = useState(false)
  const [email, setEmail] = useState("")
  const [working, setWorking] = useState(false)
  const copy = (key: Parameters<typeof experienceText>[1]) => experienceText(settings.language, key)

  async function loadAdmins() { if (loaded) return; const response = await fetch("/api/admin/admins", { credentials: "include" }); if (response.ok) { setAdmins(await response.json()); setLoaded(true) } }
  async function addAdmin() { if (!email.includes("@")) return; setWorking(true); const response = await fetch("/api/admin/admins", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) }); if (response.ok) { const row = await response.json(); setAdmins(current => [...current, row]); setEmail(""); setLoaded(true) } setWorking(false) }
  async function removeAdmin(value: string) { setWorking(true); const response = await fetch(`/api/admin/admins/${encodeURIComponent(value)}`, { method: "DELETE", credentials: "include" }); if (response.ok) setAdmins(current => current.filter(admin => admin.email !== value)); setWorking(false) }
  if (!isAdmin) return <Layout><div className="mx-auto max-w-xl px-5 py-24 text-center"><Shield className="mx-auto h-8 w-8 text-white/20" /><h1 className="mt-4 text-xl text-white">{copy("noAccess")}</h1></div></Layout>
  const tools = [
    { label: copy("catalog"), Icon: Import, action: () => setShowImport(true) },
    { label: copy("phonotheque"), Icon: Headphones, action: () => setLocation("/admin/fonoteca") },
    { label: copy("frames"), Icon: Sparkles, action: () => setLocation("/admin/marcos") },
    { label: copy("diagnostics"), Icon: MonitorCog, action: () => setLocation("/admin/diag") },
  ]
  return <Layout><section className="mx-auto w-full max-w-5xl px-4 pb-24 pt-8 sm:px-6"><p className="tloque-eyebrow">Tloque · Admin</p><h1 className="mt-1 text-2xl text-white">{copy("adminCenter")}</h1><p className="mt-2 text-sm text-zinc-500">{copy("adminCenterHint")}</p><div className="my-6 grid grid-cols-2 gap-3 sm:grid-cols-4">{tools.map(({ label, Icon, action }) => <button key={label} onClick={action} className="tloque-action-card min-h-28"><Icon className="h-5 w-5" style={{ color: cfg.color }} /><span>{label}</span></button>)}</div><div className="grid gap-4 md:grid-cols-2"><div className="tloque-surface p-5"><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium text-white">{copy("adminOverlay")}</p><p className="mt-1 text-xs text-zinc-600">{copy("adminOverlayHint")}</p></div><button role="switch" aria-checked={settings.adminMode} onClick={() => updateSetting("adminMode", !settings.adminMode)} className={`relative h-7 w-12 rounded-full border transition ${settings.adminMode ? "border-violet-300/40 bg-violet-300/25" : "border-white/10 bg-white/5"}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white/70 transition-transform ${settings.adminMode ? "translate-x-5" : "translate-x-1"}`} /></button></div></div><div className="tloque-surface p-5"><button className="flex w-full items-center justify-between" onClick={loadAdmins}><span className="text-sm font-medium text-white">{copy("admins")}</span><UserPlus className="h-4 w-4 text-white/35" /></button>{loaded && <div className="mt-4 space-y-2">{admins.map(admin => <div key={admin.id} className="flex items-center gap-2 rounded-xl bg-white/[.03] px-3 py-2"><div className="min-w-0 flex-1"><p className="truncate text-xs text-white/70">{admin.email}</p><p className="text-[10px] text-white/25">{admin.addedBy === "system" ? copy("founder") : admin.addedBy}</p></div>{admin.addedBy !== "system" && <button aria-label={copy("remove")} disabled={working} onClick={() => removeAdmin(admin.email)}><Trash2 className="h-3.5 w-3.5 text-red-300/45" /></button>}</div>)}<div className="flex gap-2 pt-2"><input value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && addAdmin()} placeholder="email@dominio.com" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-xs text-white outline-none" /><button onClick={addAdmin} disabled={working || !email.includes("@")} className="tloque-primary-button" style={{ background: cfg.color }}>{copy("addAdmin")}</button></div></div>}</div></div></section><ImportPanel open={showImport} onClose={() => setShowImport(false)} /></Layout>
}
