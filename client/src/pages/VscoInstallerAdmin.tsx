import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, CheckCircle2, Download, ExternalLink, Loader2, Music2, ShieldCheck, Sparkles } from "lucide-react"
import { useLocation } from "wouter"
import { CURATED_INSTALLABLE_SAMPLE_PACKS } from "@shared/curated-installable-sample-packs"
import type { CuratedSamplePackSource } from "@shared/curated-sample-packs"

interface InstallResult {
  url: string
  immutableUrl: string
  sha256: string
  bytes: number
  sampleCount: number
  uploadedSamples: number
  deduplicated: boolean
  manifestId: string
  moduleId: string
  version: string
  displayName?: string
  instrumentId?: string
}

type InstallerFamily = "strings" | "woodwinds" | "brass" | "percussion" | "guitar" | "keys"

const FAMILY_PRESENTATION: Record<InstallerFamily, { title: string; copy: string; bundleLabel: string }> = {
  strings: {
    title: "Cuerdas Premium",
    copy: "Combina fuentes físicas verificadas sin importar si vienen de SFZ, WAV directo o un adaptador institucional. Tloque conserva únicamente las articulaciones, capas y round robins que existen realmente en cada banco.",
    bundleLabel: "Instalar todas las cuerdas",
  },
  woodwinds: {
    title: "Maderas Premium",
    copy: "VSCO, VCSL e Iowa pueden convivir en una sola familia. Los instrumentos cromáticos de Iowa se normalizan a WAV y mantienen una grabación física por semitono dentro de su rango declarado.",
    bundleLabel: "Instalar todas las maderas",
  },
  brass: {
    title: "Metales Premium",
    copy: "La familia combina bancos con articulaciones profundas y fuentes cromáticas institucionales. El renderer no inventa capas, mutes, staccatos ni round robins ausentes.",
    bundleLabel: "Instalar todos los metales",
  },
  percussion: {
    title: "Percusión Premium",
    copy: "Timbales, percusión orquestal e instrumentos afinados se publican como módulos independientes con procedencia, hashes y capacidades físicas auditables.",
    bundleLabel: "Instalar toda la percusión",
  },
  guitar: {
    title: "Guitarras Premium",
    copy: "La biblioteca distingue instrumentos físicos reales en vez de reducir toda guitarra a un preset General MIDI. Steel, clean-electric y futuros bancos nylon pueden coexistir sin sustituirse silenciosamente.",
    bundleLabel: "Instalar todas las guitarras",
  },
  keys: {
    title: "Teclados Premium",
    copy: "Piano, órganos, clave y futuros teclados se instalan desde el mismo catálogo curado. Cada pack conserva su procedencia, rango y capacidades reales.",
    bundleLabel: "Instalar todos los teclados",
  },
}

function familyFromLocation(location: string): InstallerFamily {
  if (location.includes("guitar")) return "guitar"
  if (location.includes("woodwinds")) return "woodwinds"
  if (location.includes("brass")) return "brass"
  if (location.includes("percussion")) return "percussion"
  if (location.includes("keyboard") || location.includes("keys") || location.includes("piano")) return "keys"
  return "strings"
}

function packBelongsToFamily(pack: CuratedSamplePackSource, family: InstallerFamily) {
  if (family === "keys") return pack.instrumentId.startsWith("keys.") || pack.instrumentId.startsWith("piano.")
  return pack.instrumentId.startsWith(`${family}.`)
}

async function packIsPublished(moduleId: string) {
  try {
    const response = await fetch(`/api/audio/sample-packs/modules/${encodeURIComponent(moduleId)}.json`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    })
    if (!response.ok) return false
    const body = await response.json().catch(() => null)
    return Boolean(body && Array.isArray(body.zones) && body.zones.length)
  } catch {
    return false
  }
}

export default function VscoInstallerAdmin() {
  const [location, setLocation] = useLocation()
  const family = familyFromLocation(location)
  const presentation = FAMILY_PRESENTATION[family]
  const packs = useMemo(
    () => CURATED_INSTALLABLE_SAMPLE_PACKS.filter(pack => packBelongsToFamily(pack, family)),
    [family],
  )
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bundleBusy, setBundleBusy] = useState(false)
  const [bundleMessage, setBundleMessage] = useState("")
  const [results, setResults] = useState<Record<string, InstallResult>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [installed, setInstalled] = useState<Record<string, boolean>>({})
  const [checkingStatus, setCheckingStatus] = useState(true)

  async function refreshInstalled() {
    setCheckingStatus(true)
    const entries = await Promise.all(packs.map(async pack => [pack.moduleId, await packIsPublished(pack.moduleId)] as const))
    setInstalled(Object.fromEntries(entries))
    setCheckingStatus(false)
  }

  useEffect(() => {
    void refreshInstalled()
  }, [family, packs])

  async function installPackRequest(pack: CuratedSamplePackSource) {
    if (installed[pack.moduleId]) return null
    setErrors(current => ({ ...current, [pack.id]: "" }))
    const response = await fetch(`/api/admin/audio/sample-pack-catalog/${pack.id}/install`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acknowledgement: pack.acknowledgement }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.message || `No se pudo instalar ${pack.displayName}`)
    const result = body as InstallResult
    setResults(current => ({ ...current, [pack.id]: result }))
    setInstalled(current => ({ ...current, [pack.moduleId]: true }))
    return result
  }

  async function installPack(pack: CuratedSamplePackSource) {
    if (busyId || bundleBusy || installed[pack.moduleId]) return
    if (!window.confirm(`${pack.acknowledgement}\n\n¿Instalar ahora ${pack.displayName} en Tloque?`)) return
    setBusyId(pack.id)
    try {
      await installPackRequest(pack)
    } catch (reason) {
      setErrors(current => ({
        ...current,
        [pack.id]: reason instanceof Error ? reason.message : `No se pudo instalar ${pack.displayName}`,
      }))
    } finally {
      setBusyId(null)
      await refreshInstalled()
    }
  }

  async function installFamilyBundle() {
    if (busyId || bundleBusy || !packs.length) return
    const missing = packs.filter(pack => !installed[pack.moduleId])
    if (!missing.length) {
      setBundleMessage(`${presentation.title} ya está completamente instalado.`)
      return
    }
    const estimatedMb = missing.reduce((total, pack) => total + pack.estimatedMegabytes, 0)
    if (!window.confirm(`Instalar ${missing.length} bancos faltantes de ${presentation.title} (~${estimatedMb} MB estimados en origen). Los bancos ya publicados se omitirán automáticamente. ¿Continuar?`)) return
    setBundleBusy(true)
    setBundleMessage(`Preparando ${missing.length} bancos faltantes…`)
    try {
      for (let index = 0; index < missing.length; index += 1) {
        const pack = missing[index]
        setBusyId(pack.id)
        setBundleMessage(`${index + 1}/${missing.length} · ${pack.displayName}`)
        await installPackRequest(pack)
      }
      setBundleMessage(`${presentation.title} completo · todos los bancos están publicados en App Storage.`)
    } catch (reason) {
      setBundleMessage(reason instanceof Error ? `Instalación detenida · ${reason.message}` : "Instalación detenida")
    } finally {
      setBusyId(null)
      setBundleBusy(false)
      await refreshInstalled()
    }
  }

  const installedCount = packs.filter(pack => installed[pack.moduleId]).length
  const familyReady = packs.length > 0 && installedCount === packs.length
  const missingMb = packs.filter(pack => !installed[pack.moduleId]).reduce((total, pack) => total + pack.estimatedMegabytes, 0)

  return (
    <main className="min-h-screen bg-zinc-950 pb-12 text-zinc-200">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/10 bg-zinc-950/95 px-4 py-3">
        <button aria-label="Volver" onClick={() => setLocation("/admin/audio/keyboards")}><ArrowLeft className="h-4 w-4" /></button>
        <Music2 className="h-4 w-4 text-amber-300" />
        <div><h1 className="font-semibold">{presentation.title}</h1><p className="text-[10px] text-zinc-500">Biblioteca acústica nativa de Tloque</p></div>
      </header>

      <section className="mx-auto max-w-4xl space-y-4 p-4">
        <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.035] p-4 text-xs leading-5 text-zinc-400">
          <p className="flex items-center gap-2 font-medium text-emerald-200"><ShieldCheck className="h-4 w-4" /> Catálogo curado unificado</p>
          <p className="mt-1">La pantalla ya no depende de una biblioteca concreta. SFZ, WAV curado y PCM institucional pasan por el mismo contrato: procedencia fija, validación física, SHA-256, App Storage y manifest semántico antes de que `native-auto` pueda usarlos.</p>
          <p className="mt-2 text-zinc-500">{presentation.copy}</p>
        </div>

        <div className="rounded-2xl border border-amber-300/25 bg-amber-300/[0.055] p-4">
          <p className="flex items-center gap-2 font-semibold text-amber-100"><Sparkles className="h-4 w-4" /> Instalar familia completa</p>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            {checkingStatus ? "Comprobando App Storage…" : `${installedCount}/${packs.length} bancos instalados. ${familyReady ? "Esta familia ya está completa." : `Faltan ~${missingMb} MB estimados en origen.`}`}
          </p>
          <button disabled={bundleBusy || Boolean(busyId) || checkingStatus || familyReady || !packs.length} onClick={installFamilyBundle} className="mt-3 min-h-12 w-full rounded-xl bg-amber-300 px-4 py-3 text-sm font-semibold text-black disabled:opacity-50">
            {bundleBusy
              ? <><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Instalando familia…</>
              : familyReady
                ? <><CheckCircle2 className="mr-2 inline h-4 w-4" /> Familia completa</>
                : <><Download className="mr-2 inline h-4 w-4" /> {presentation.bundleLabel}</>}
          </button>
          {bundleMessage && <p className="mt-2 text-xs text-zinc-400">{bundleMessage}</p>}
        </div>

        {!packs.length && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-zinc-400">No hay bancos instalables registrados para esta familia todavía.</div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {packs.map(pack => {
            const result = results[pack.id]
            const error = errors[pack.id]
            const busy = busyId === pack.id
            const published = installed[pack.moduleId]
            return (
              <article key={pack.id} className={`space-y-4 rounded-2xl border p-4 ${published ? "border-emerald-400/20 bg-emerald-400/[0.035]" : "border-amber-300/20 bg-amber-300/[0.04]"}`}>
                <div className="flex gap-3">
                  <div className="rounded-xl bg-amber-300/10 p-3"><Music2 className="h-6 w-6 text-amber-200" /></div>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">{pack.displayName}</h2>
                    <p className="mt-1 text-[11px] text-zinc-500">{pack.instrumentId}</p>
                    <p className="mt-1 truncate text-[10px] text-zinc-600">{pack.libraryName}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-zinc-500">Licencia</p><p className="mt-1 break-words text-zinc-200">{pack.license}</p></div>
                  <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-zinc-500">Estimado</p><p className="mt-1 text-zinc-200">~{pack.estimatedMegabytes} MB</p></div>
                  <div className="col-span-2 rounded-xl bg-white/[0.04] p-3"><p className="text-zinc-500">Módulo Tloque</p><code className="mt-1 block truncate text-zinc-200">{pack.moduleId}</code></div>
                </div>

                {published ? (
                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-3 text-emerald-100">
                    <p className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-5 w-5" /> Publicado en App Storage</p>
                    {result ? (
                      <p className="mt-2 text-[11px] leading-5 text-emerald-100/75">{result.sampleCount} muestras verificadas · {result.uploadedSamples} nuevas · {(result.bytes / 1024 / 1024).toFixed(1)} MB</p>
                    ) : (
                      <p className="mt-2 text-[11px] leading-5 text-emerald-100/75">Tloque verificó que este módulo ya existe. No se descargará otra vez.</p>
                    )}
                  </div>
                ) : (
                  <button disabled={Boolean(busyId) || bundleBusy || checkingStatus} onClick={() => installPack(pack)} className="min-h-12 w-full rounded-xl bg-amber-300 px-4 py-3 text-sm font-semibold text-black disabled:opacity-50">
                    {busy ? <><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Instalando y verificando…</> : <><Download className="mr-2 inline h-4 w-4" /> Instalar {pack.displayName}</>}
                  </button>
                )}

                {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-950/30 p-3 text-xs text-red-200">{error}</p>}
                <a href={pack.repositoryUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs text-sky-300">Ver procedencia <ExternalLink className="h-3.5 w-3.5" /></a>
              </article>
            )
          })}
        </div>

        <button onClick={() => setLocation("/admin/fonoteca")} className="rounded-lg bg-white/10 px-4 py-2 text-xs">Ir al compositor</button>
      </section>
    </main>
  )
}
