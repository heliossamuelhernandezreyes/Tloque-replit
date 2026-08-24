import { useState } from "react"
import { ArrowLeft, CheckCircle2, Download, ExternalLink, Loader2, Music2, ShieldCheck, Sparkles } from "lucide-react"
import { useLocation } from "wouter"
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

type InstallerFamily = "strings" | "woodwinds" | "brass" | "percussion" | "guitar"

const FAMILY_PRESENTATION: Record<InstallerFamily, { title: string; copy: string }> = {
  strings: {
    title: "VSCO Strings",
    copy: "La identidad refleja la grabación original: violín y contrabajo son solistas; viola y cello son secciones. Los colores grabados permanecen separados de las articulaciones y sólo se usan cuando el módulo realmente los contiene.",
  },
  woodwinds: {
    title: "VSCO Woodwinds",
    copy: "Flauta conserva sus colores KS; oboe y fagot integran sustain vibrato grabado además de sus ataques abiertos. TloqueScore usa timbre= para escoger el color físico sin convertir vibrato en una articulación falsa.",
  },
  brass: {
    title: "Metales Premium · VSCO",
    copy: "Trompeta integra natural, vibrato, straight mute y Harmon mute; Tenor Trombone integra vibrato y F Horn integra mute. Tuba completa el fondo. Cada color es una grabación física independiente y los staccatos/ataques conservan sus capas y round-robin reales.",
  },
  percussion: {
    title: "VSCO Percussion",
    copy: "Timbales conserva golpes con velocity layers y round-robin físicos, más rolls grabados como tremolo. Glockenspiel, marimba, xilófono y campanas tubulares son instrumentos afinados independientes. Orchestral Percussion publica caja, bombo, platos, triángulo y otros golpes mediante nombres semánticos del comando hit.",
  },
  guitar: {
    title: "Guitarra Premium",
    copy: "Emilyguitar es una guitarra eléctrica limpia grabada directamente: cuatro capas físicas de velocidad, tres round robins para notas y muestras de release/ruido. Tloque la usa como instrumento real, no como preset General MIDI. No se inventan rasgueos, bends ni técnicas que el banco no haya grabado.",
  },
}

export default function VscoInstallerAdmin() {
  const [location, setLocation] = useLocation()
  const family: InstallerFamily = location.includes("guitar")
    ? "guitar"
    : location.includes("woodwinds")
      ? "woodwinds"
      : location.includes("brass")
        ? "brass"
        : location.includes("percussion") ? "percussion" : "strings"
  const presentation = FAMILY_PRESENTATION[family]
  const packs = CURATED_SAMPLE_PACKS.filter(pack => {
    if (family === "guitar") return pack.instrumentId.startsWith("guitar.")
    return pack.libraryName === "VSCO 2 Community Edition" && pack.instrumentId.startsWith(`${family}.`)
  })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bundleBusy, setBundleBusy] = useState(false)
  const [bundleMessage, setBundleMessage] = useState("")
  const [results, setResults] = useState<Record<string, InstallResult>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

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
    }
  }

  async function installBrassBundle() {
    if (family !== "brass" || busyId || bundleBusy || !packs.length) return
    const estimatedMb = packs.reduce((total, pack) => total + pack.estimatedMegabytes, 0)
    if (!window.confirm(`Instalar Metales Premium completos: trompeta, trombón tenor, corno en Fa y tuba (~${estimatedMb} MB estimados en origen). Tloque descargará y verificará los WAV en el servidor/App Storage. ¿Continuar?`)) return
    setBundleBusy(true)
    setBundleMessage(`Preparando ${packs.length} bancos de metales…`)
    try {
      for (let index = 0; index < packs.length; index += 1) {
        const pack = packs[index]
        setBusyId(pack.id)
        setBundleMessage(`${index + 1}/${packs.length} · ${pack.displayName}`)
        await installPackRequest(pack)
      }
      setBundleMessage("Metales Premium listos · native-auto puede orquestarlos por instrumento.")
    } catch (reason) {
      setBundleMessage(reason instanceof Error ? `Instalación detenida · ${reason.message}` : "Instalación detenida")
    } finally {
      setBusyId(null)
      setBundleBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 pb-12 text-zinc-200">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/10 bg-zinc-950/95 px-4 py-3">
        <button aria-label="Volver" onClick={() => setLocation("/admin/audio/keyboards")}><ArrowLeft className="h-4 w-4" /></button>
        <Music2 className="h-4 w-4 text-amber-300" />
        <div><h1 className="font-semibold">{presentation.title}</h1><p className="text-[10px] text-zinc-500">Familia acústica nativa de Tloque</p></div>
      </header>

      <section className="mx-auto max-w-3xl space-y-4 p-4">
        <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.035] p-4 text-xs leading-5 text-zinc-400">
          <p className="flex items-center gap-2 font-medium text-emerald-200"><ShieldCheck className="h-4 w-4" /> Paquetes independientes y verificados</p>
          <p className="mt-1">Cada instrumento se descarga sólo cuando lo necesitas. Tloque usa una revisión fijada de la biblioteca, interpreta el SFZ como datos inertes, valida RIFF/WAVE, calcula SHA-256 y deduplica las muestras en App Storage.</p>
          <p className="mt-2 text-zinc-500">{presentation.copy}</p>
        </div>

        {family === "brass" && (
          <div className="rounded-2xl border border-amber-300/25 bg-amber-300/[0.055] p-4">
            <p className="flex items-center gap-2 font-semibold text-amber-100"><Sparkles className="h-4 w-4" /> Metales Premium completos</p>
            <p className="mt-1 text-xs leading-5 text-zinc-400">Instala de una vez trompeta, trombón tenor, corno en Fa y tuba. La trompeta conserva además vibrato y sordinas físicas; el corno conserva su mute grabado.</p>
            <button disabled={bundleBusy || Boolean(busyId)} onClick={installBrassBundle} className="mt-3 min-h-12 w-full rounded-xl bg-amber-300 px-4 py-3 text-sm font-semibold text-black disabled:opacity-50">
              {bundleBusy ? <><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Instalando metales…</> : <><Download className="mr-2 inline h-4 w-4" /> Instalar Metales Premium</>}
            </button>
            {bundleMessage && <p className="mt-2 text-xs text-zinc-400">{bundleMessage}</p>}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {packs.map(pack => {
            const result = results[pack.id]
            const error = errors[pack.id]
            const busy = busyId === pack.id
            return (
              <article key={pack.id} className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.04] p-4 space-y-4">
                <div className="flex gap-3">
                  <div className="rounded-xl bg-amber-300/10 p-3"><Music2 className="h-6 w-6 text-amber-200" /></div>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">{pack.displayName}</h2>
                    <p className="mt-1 text-[11px] text-zinc-500">{pack.instrumentId} · {pack.sfzPaths.length > 1 ? `${pack.sfzPaths.length} SFZ` : pack.sfzPath}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-zinc-500">Licencia</p><p className="mt-1 text-zinc-200">{pack.license}</p></div>
                  <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-zinc-500">Estimado</p><p className="mt-1 text-zinc-200">~{pack.estimatedMegabytes} MB</p></div>
                  <div className="col-span-2 rounded-xl bg-white/[0.04] p-3"><p className="text-zinc-500">Módulo Tloque</p><code className="mt-1 block truncate text-zinc-200">{pack.moduleId}</code></div>
                </div>

                {!result ? (
                  <button disabled={Boolean(busyId) || bundleBusy} onClick={() => installPack(pack)} className="min-h-12 w-full rounded-xl bg-amber-300 px-4 py-3 text-sm font-semibold text-black disabled:opacity-50">
                    {busy ? <><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Instalando y verificando…</> : <><Download className="mr-2 inline h-4 w-4" /> Instalar {pack.displayName}</>}
                  </button>
                ) : (
                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-3 text-emerald-100">
                    <p className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-5 w-5" /> Instalado</p>
                    <p className="mt-2 text-[11px] leading-5 text-emerald-100/75">{result.sampleCount} muestras verificadas · {result.uploadedSamples} nuevas · {(result.bytes / 1024 / 1024).toFixed(1)} MB</p>
                    <p className="mt-1 text-[10px] text-zinc-400">SHA {result.sha256.slice(0, 12)}…</p>
                    <code className="mt-2 block rounded bg-black/30 px-2 py-1.5 text-[10px]">module {result.moduleId}</code>
                  </div>
                )}

                {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-950/30 p-3 text-xs text-red-200">{error}</p>}
              </article>
            )
          })}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <button onClick={() => setLocation("/admin/fonoteca")} className="rounded-lg bg-white/10 px-4 py-2 text-xs">Ir al compositor</button>
          <a href={family === "guitar" ? "https://github.com/sfzinstruments/karoryfer.emilyguitar" : "https://github.com/sgossner/VSCO-2-CE"} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 px-3 py-2 text-xs text-sky-300">Ver repositorio y procedencia <ExternalLink className="h-3.5 w-3.5" /></a>
        </div>
      </section>
    </main>
  )
}
