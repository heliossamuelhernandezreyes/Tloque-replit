import { useMemo, useState } from "react"
import { ArrowLeft, CheckCircle2, Download, ExternalLink, Loader2, Music2, ShieldCheck } from "lucide-react"
import { useLocation } from "wouter"
import { AUDIO_MODULE_SOURCES } from "@shared/audio-module-sources"

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
}

export default function VscoInstallerAdmin() {
  const [, setLocation] = useLocation()
  const source = useMemo(() => AUDIO_MODULE_SOURCES.find(item => item.id === "vsco2-ce"), [])
  const install = source?.samplePackInstall
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<InstallResult | null>(null)
  const [error, setError] = useState("")

  async function installPack() {
    if (!source || !install || busy) return
    if (!window.confirm(`${install.acknowledgement}\n\n¿Instalar ahora el violín acústico VSCO en Tloque?`)) return
    setBusy(true)
    setError("")
    try {
      const response = await fetch(`/api/admin/audio/sample-pack-catalog/${source.id}/install`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledgement: install.acknowledgement }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || "No se pudo instalar VSCO Solo Violin")
      setResult(body as InstallResult)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo instalar VSCO Solo Violin")
    } finally {
      setBusy(false)
    }
  }

  if (!source || !install) return <main className="min-h-screen bg-zinc-950 p-6 text-zinc-300">Configuración VSCO no disponible.</main>

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-200 pb-12">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/10 bg-zinc-950/95 px-4 py-3">
        <button aria-label="Volver" onClick={() => setLocation("/admin/fonoteca")}><ArrowLeft className="h-4 w-4" /></button>
        <Music2 className="h-4 w-4 text-amber-300" />
        <div><h1 className="font-semibold">VSCO Solo Violin</h1><p className="text-[10px] text-zinc-500">Paquete acústico nativo de Tloque</p></div>
      </header>

      <section className="mx-auto max-w-2xl space-y-4 p-4">
        <article className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.04] p-4 space-y-4">
          <div className="flex gap-3">
            <div className="rounded-xl bg-amber-300/10 p-3"><Music2 className="h-6 w-6 text-amber-200" /></div>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">{source.name} · Solo Violin</h2>
              <p className="mt-1 text-xs leading-5 text-zinc-400">Sustain vibrato, tremolo, spiccato y pizzicato. Conserva capas dinámicas y round-robin del SFZ original en lugar de aplanarlos a un preset General MIDI.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
            <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-zinc-500">Licencia</p><p className="mt-1 text-zinc-200">{source.license}</p></div>
            <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-zinc-500">Commit</p><p className="mt-1 truncate text-zinc-200">{install.pinnedCommit.slice(0, 10)}</p></div>
            <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-zinc-500">Módulo</p><p className="mt-1 truncate text-zinc-200">{install.moduleId}</p></div>
            <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-zinc-500">Estimado</p><p className="mt-1 text-zinc-200">~{install.estimatedMegabytes} MB</p></div>
          </div>

          <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.035] p-3 text-[11px] leading-5 text-zinc-400">
            <p className="flex items-center gap-2 font-medium text-emerald-200"><ShieldCheck className="h-4 w-4" /> Instalación verificada</p>
            <p className="mt-1">Tloque descarga únicamente desde el commit fijado, compila el SFZ como datos inertes, valida cada archivo RIFF/WAVE, calcula SHA-256 y deduplica las muestras en App Storage.</p>
          </div>

          {!result && (
            <button disabled={busy} onClick={installPack} className="min-h-12 w-full rounded-xl bg-amber-300 px-4 py-3 text-sm font-semibold text-black disabled:opacity-50">
              {busy ? <><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Instalando y verificando…</> : <><Download className="mr-2 inline h-4 w-4" /> Instalar violín VSCO</>}
            </button>
          )}

          {result && (
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4 text-sm text-emerald-100">
              <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-5 w-5" /> Violín instalado</p>
              <p className="mt-2 text-xs leading-5 text-emerald-100/75">{result.sampleCount} muestras verificadas · {result.uploadedSamples} nuevas · {(result.bytes / 1024 / 1024).toFixed(1)} MB · SHA {result.sha256.slice(0, 12)}…</p>
              <p className="mt-2 text-xs leading-5 text-zinc-300">Ya puedes usar <code className="rounded bg-black/30 px-1.5 py-0.5">module {result.moduleId}</code> en TloqueScore. La preescucha nativa seleccionará velocity layers y round-robin reales.</p>
              <button onClick={() => setLocation("/admin/fonoteca")} className="mt-3 rounded-lg bg-white/10 px-3 py-2 text-xs">Ir al compositor</button>
            </div>
          )}

          {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-950/30 p-3 text-xs text-red-200">{error}</p>}
        </article>

        <a href={source.repositoryUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 text-xs text-sky-300">Ver repositorio y procedencia <ExternalLink className="h-3.5 w-3.5" /></a>
      </section>
    </main>
  )
}
