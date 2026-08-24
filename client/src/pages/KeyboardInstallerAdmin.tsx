import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, CheckCircle2, Download, ExternalLink, Loader2, Music2, ShieldCheck, Sparkles } from "lucide-react"
import { useLocation } from "wouter"
import { CURATED_RAW_WAV_PACKS, type CuratedRawWavPackSource } from "@shared/curated-raw-wav-packs"
import { CURATED_SAMPLE_PACKS, type CuratedSamplePackSource } from "@shared/curated-sample-packs"

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
  displayName: string
  instrumentId: string
}

const BAROQUE_MODULE_IDS = [
  "vsco2-ce-solo-violin",
  "vsco2-ce-viola-section",
  "vsco2-ce-cello-section",
  "vcsl-italian-harpsichord-stop1",
] as const

const ALL_CURATED_PACKS: readonly CuratedSamplePackSource[] = [
  ...CURATED_SAMPLE_PACKS,
  ...CURATED_RAW_WAV_PACKS,
]

const BAROQUE_PACKS = BAROQUE_MODULE_IDS.map(moduleId =>
  ALL_CURATED_PACKS.find(pack => pack.moduleId === moduleId),
).filter((pack): pack is CuratedSamplePackSource => Boolean(pack))

function capabilityCopy(pack: CuratedRawWavPackSource) {
  if (pack.id === "vcsl-estuary-grand-piano") {
    return "Grand Piano: sustain grabado con micrófono close y tres capas físicas de velocidad. Este módulo no afirma pedal, resonancia simpática, release samples ni true legato porque esas capacidades no están presentes en la selección curada."
  }
  if (pack.id === "vcsl-estuary-pipe-organ") {
    return "Pipe Organ: selección Rode Man3 Open. Es un color físico de órgano de tubos, no una emulación General MIDI. Los registros/stops y pedal independiente se mantendrán como una ampliación posterior cuando estén modelados explícitamente."
  }
  return "Italian Harpsichord · Stop 1: ataques acústicos y key-off/release samples físicos separados. Es el continuo barroco nativo recomendado para pruebas como Vivaldi; no se inventan capas dinámicas que el instrumento no contiene."
}

function sourceKindCopy(pack: CuratedRawWavPackSource) {
  return pack.sourceKind === "raw-wav-index" ? "RAW WAV index" : "RAW WAV pinned list"
}

async function packIsPublished(moduleId: string) {
  try {
    const response = await fetch(`/api/audio/sample-packs/modules/${encodeURIComponent(moduleId)}.json`, {
      method: "HEAD",
      credentials: "include",
      cache: "no-store",
    })
    return response.ok
  } catch {
    return false
  }
}

export default function KeyboardInstallerAdmin() {
  const [, setLocation] = useLocation()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bundleBusy, setBundleBusy] = useState(false)
  const [bundleProgress, setBundleProgress] = useState("")
  const [results, setResults] = useState<Record<string, InstallResult>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [installed, setInstalled] = useState<Record<string, boolean>>({})

  const statusPacks = useMemo(() => {
    const unique = new Map<string, CuratedSamplePackSource>()
    for (const pack of [...BAROQUE_PACKS, ...CURATED_RAW_WAV_PACKS]) unique.set(pack.moduleId, pack)
    return [...unique.values()]
  }, [])

  async function refreshInstalled() {
    const entries = await Promise.all(statusPacks.map(async pack => [pack.moduleId, await packIsPublished(pack.moduleId)] as const))
    setInstalled(Object.fromEntries(entries))
  }

  useEffect(() => {
    void refreshInstalled()
  }, [])

  async function installPackRequest(pack: CuratedSamplePackSource) {
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
    if (busyId || bundleBusy) return
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

  async function installBaroqueBundle() {
    if (busyId || bundleBusy) return
    const missing = BAROQUE_PACKS.filter(pack => !installed[pack.moduleId])
    if (!missing.length) return
    const estimatedMb = missing.reduce((total, pack) => total + pack.estimatedMegabytes, 0)
    const accepted = window.confirm(
      `Tloque instalará el set Barroco Premium necesario para la prueba Vivaldi: violín solista, viola, cello y clave italiano.\n\n` +
      `Faltan ${missing.length} módulos (~${estimatedMb} MB estimados). Todos son paquetes curados CC0, fijados a commits concretos, verificados por SHA-256 y copiados a App Storage. La instalación puede tardar varios minutos.\n\n¿Continuar?`,
    )
    if (!accepted) return

    setBundleBusy(true)
    setBundleProgress(`Preparando ${missing.length} módulos…`)
    try {
      for (let index = 0; index < missing.length; index += 1) {
        const pack = missing[index]
        setBusyId(pack.id)
        setBundleProgress(`${index + 1}/${missing.length} · Instalando ${pack.displayName}…`)
        try {
          await installPackRequest(pack)
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : `No se pudo instalar ${pack.displayName}`
          setErrors(current => ({ ...current, [pack.id]: message }))
          throw new Error(`${pack.displayName}: ${message}`)
        }
      }
      setBundleProgress("Barroco Premium instalado · native-auto ya puede usar las muestras reales.")
    } catch (reason) {
      setBundleProgress(reason instanceof Error ? `Instalación detenida · ${reason.message}` : "Instalación detenida")
    } finally {
      setBusyId(null)
      setBundleBusy(false)
      await refreshInstalled()
    }
  }

  const baroqueReady = BAROQUE_PACKS.length === BAROQUE_MODULE_IDS.length
    && BAROQUE_PACKS.every(pack => installed[pack.moduleId])
  const baroqueInstalledCount = BAROQUE_PACKS.filter(pack => installed[pack.moduleId]).length
  const baroqueTotalMb = BAROQUE_PACKS.reduce((total, pack) => total + pack.estimatedMegabytes, 0)

  return (
    <main className="min-h-screen bg-zinc-950 pb-12 text-zinc-200">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/10 bg-zinc-950/95 px-4 py-3">
        <button aria-label="Volver" onClick={() => setLocation("/admin/fonoteca")}><ArrowLeft className="h-4 w-4" /></button>
        <Music2 className="h-4 w-4 text-amber-300" />
        <div><h1 className="font-semibold">Instrumentos acústicos premium</h1><p className="text-[10px] text-zinc-500">Barroco · piano · órgano · clavecín · CC0</p></div>
      </header>

      <section className="mx-auto max-w-4xl space-y-4 p-4">
        <div className="rounded-2xl border border-amber-300/25 bg-amber-300/[0.055] p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-amber-300/10 p-3"><Sparkles className="h-6 w-6 text-amber-200" /></div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-amber-100">Barroco Premium · Vivaldi</p>
              <p className="mt-1 text-xs leading-5 text-zinc-400">Set acústico completo para <code>module native-auto</code>: VSCO 2 CE Solo Violin + Viola Section + Cello Section, y VCSL Italian Harpsichord Stop 1. Con los cuatro publicados, escuchar y exportar usan muestras reales en lugar del fallback sintetizado.</p>
              <p className="mt-2 text-[10px] text-zinc-500">{baroqueInstalledCount}/{BAROQUE_PACKS.length} módulos disponibles · ~{baroqueTotalMb} MB estimados en origen · App Storage deduplica WAV repetidos.</p>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {BAROQUE_PACKS.map(pack => (
              <div key={pack.moduleId} className="flex items-center gap-2 rounded-xl bg-black/25 px-3 py-2 text-[11px]">
                {installed[pack.moduleId]
                  ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />
                  : busyId === pack.id
                    ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-200" />
                    : <Download className="h-4 w-4 shrink-0 text-zinc-500" />}
                <span className="min-w-0 flex-1 truncate">{pack.displayName}</span>
                <span className={installed[pack.moduleId] ? "text-emerald-300" : "text-zinc-600"}>{installed[pack.moduleId] ? "listo" : "falta"}</span>
              </div>
            ))}
          </div>

          <button
            disabled={bundleBusy || Boolean(busyId) || baroqueReady || BAROQUE_PACKS.length !== BAROQUE_MODULE_IDS.length}
            onClick={installBaroqueBundle}
            className="mt-4 min-h-12 w-full rounded-xl bg-amber-300 px-4 py-3 text-sm font-semibold text-black disabled:opacity-50"
          >
            {bundleBusy
              ? <><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Instalando Barroco Premium…</>
              : baroqueReady
                ? <><CheckCircle2 className="mr-2 inline h-4 w-4" /> Barroco Premium listo</>
                : <><Download className="mr-2 inline h-4 w-4" /> Instalar set Barroco Premium</>}
          </button>
          {bundleProgress && <p className={`mt-3 rounded-xl px-3 py-2 text-xs ${baroqueReady ? "bg-emerald-400/5 text-emerald-200" : "bg-white/[0.035] text-zinc-400"}`}>{bundleProgress}</p>}
          {BAROQUE_PACKS.length !== BAROQUE_MODULE_IDS.length && <p role="alert" className="mt-3 rounded-xl border border-red-400/20 bg-red-950/30 p-3 text-xs text-red-200">El catálogo Barroco Premium está incompleto en esta compilación. No se permitirá una instalación parcial silenciosa.</p>}
        </div>

        <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.035] p-4 text-xs leading-5 text-zinc-400">
          <p className="flex items-center gap-2 font-medium text-emerald-200"><ShieldCheck className="h-4 w-4" /> WAV curados, fijados y verificados</p>
          <p className="mt-1">Tloque usa únicamente listas o índices fijados a commits concretos, valida cada archivo RIFF/WAVE, calcula SHA-256 y copia las muestras a App Storage. El navegador nunca reproduce directamente desde GitHub.</p>
          <p className="mt-2 text-zinc-500">El importador genera un SFZ inerte interno sólo para reutilizar el mismo TloqueSamplePack y el mismo Performance Engine de la orquesta.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {CURATED_RAW_WAV_PACKS.map(pack => {
            const result = results[pack.id]
            const error = errors[pack.id]
            const busy = busyId === pack.id
            const published = installed[pack.moduleId]
            return (
              <article key={pack.id} className="space-y-4 rounded-2xl border border-amber-300/20 bg-amber-300/[0.04] p-4">
                <div className="flex gap-3">
                  <div className="rounded-xl bg-amber-300/10 p-3"><Music2 className="h-6 w-6 text-amber-200" /></div>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">{pack.displayName}</h2>
                    <p className="mt-1 text-[11px] text-zinc-500">{pack.instrumentId} · {sourceKindCopy(pack)}</p>
                  </div>
                </div>

                <p className="text-[11px] leading-5 text-zinc-400">{capabilityCopy(pack)}</p>

                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-zinc-500">Licencia</p><p className="mt-1 text-zinc-200">{pack.license}</p></div>
                  <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-zinc-500">Estimado</p><p className="mt-1 text-zinc-200">~{pack.estimatedMegabytes} MB</p></div>
                  <div className="col-span-2 rounded-xl bg-white/[0.04] p-3"><p className="text-zinc-500">Módulo Tloque</p><code className="mt-1 block truncate text-zinc-200">{pack.moduleId}</code></div>
                </div>

                {!published ? (
                  <button disabled={Boolean(busyId) || bundleBusy} onClick={() => installPack(pack)} className="min-h-12 w-full rounded-xl bg-amber-300 px-4 py-3 text-sm font-semibold text-black disabled:opacity-50">
                    {busy ? <><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Instalando y verificando…</> : <><Download className="mr-2 inline h-4 w-4" /> Instalar {pack.displayName}</>}
                  </button>
                ) : (
                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-3 text-emerald-100">
                    <p className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-5 w-5" /> Publicado en App Storage</p>
                    {result && <>
                      <p className="mt-2 text-[11px] leading-5 text-emerald-100/75">{result.sampleCount} muestras verificadas · {result.uploadedSamples} nuevas · {(result.bytes / 1024 / 1024).toFixed(1)} MB</p>
                      <p className="mt-1 text-[10px] text-zinc-400">SHA {result.sha256.slice(0, 12)}…</p>
                    </>}
                    <code className="mt-2 block rounded bg-black/30 px-2 py-1.5 text-[10px]">module {pack.moduleId}</code>
                  </div>
                )}

                {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-950/30 p-3 text-xs text-red-200">{error}</p>}
                <a href={pack.repositoryUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[10px] text-sky-300">Procedencia <ExternalLink className="h-3.5 w-3.5" /></a>
              </article>
            )
          })}
        </div>

        <button onClick={() => setLocation("/admin/fonoteca")} className="rounded-lg bg-white/10 px-4 py-2 text-xs">Ir al compositor</button>
      </section>
    </main>
  )
}