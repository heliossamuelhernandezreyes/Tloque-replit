import { createHash } from "node:crypto"
import type { Client } from "@replit/object-storage"
import express, { type Express } from "express"
import { CURATED_SAMPLE_PACKS } from "../shared/curated-sample-packs"
import { CURATED_RAW_WAV_PACKS } from "../shared/curated-raw-wav-packs"
import { requireAdmin } from "./auth"
import { audioStorage } from "./audioStorage"
import { curatedSamplePackSource, downloadCuratedSamplePack } from "./audioModuleInstaller"
import { rateLimit } from "./rateLimit"
import { compileSfzBundleToTloqueSamplePack } from "./sfzSamplePackCompiler"

function safeModuleId(value: string) {
  return /^[a-z0-9][a-z0-9._-]{0,79}$/.test(value)
}

function readableInstallerError(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error || "Error desconocido")
  const lowered = detail.toLowerCase()
  if (lowered.includes("object storage") || lowered.includes("bucket") || lowered.includes("storage")) {
    return { status: 503, message: "App Storage no está disponible. Conecta o reactiva el bucket de Replit y vuelve a intentar la instalación." }
  }
  if (lowered.includes("redirigida") || lowered.includes("fuente respondió") || lowered.includes("fetch") || lowered.includes("network")) {
    return { status: 502, message: `No se pudo descargar la fuente curada desde GitHub: ${detail}` }
  }
  if (lowered.includes("wav") || lowered.includes("sfz") || lowered.includes("muestra") || lowered.includes("paquete")) {
    return { status: 502, message: `La fuente descargó, pero no pasó la validación acústica: ${detail}` }
  }
  return { status: 502, message: `No se pudo instalar el banco acústico: ${detail}` }
}

async function probeAudioStorage() {
  let storage: Client | undefined
  try {
    storage = audioStorage.get()
    const probe = await storage.list({ maxResults: 1, prefix: "audio/sample-packs/" })
    if (!probe.ok) throw probe.error
    return { ready: true as const, storage }
  } catch (error) {
    audioStorage.reset(storage)
    return { ready: false as const, error }
  }
}

const NATIVE_SAMPLE_PACK_CATALOG = [...CURATED_SAMPLE_PACKS, ...CURATED_RAW_WAV_PACKS] as const

/**
 * Registered before the legacy upload router. This endpoint is the canonical
 * installer for native TloqueSamplePack libraries; the old inline handler is
 * kept temporarily for backwards-compatible server structure but is shadowed.
 */
export function registerNativeSamplePackRoutes(app: Express) {
  app.get("/api/admin/audio/sample-pack-catalog", requireAdmin, (_req, res) => {
    res.json({ packs: NATIVE_SAMPLE_PACK_CATALOG })
  })

  app.get("/api/admin/audio/sample-pack-storage-status", requireAdmin, async (_req, res) => {
    const probe = await probeAudioStorage()
    if (probe.ready) return res.json({ ready: true })
    res.locals.publicErrorMessage = true
    return res.status(503).json({
      ready: false,
      message: "App Storage no está disponible. Conecta o reactiva el bucket de Replit antes de instalar bancos acústicos.",
    })
  })

  app.post(
    "/api/admin/audio/sample-pack-catalog/:sourceId/install",
    requireAdmin,
    // El instalador es una herramienta exclusiva de administración y los bundles
    // premium pueden requerir más de diez bancos consecutivos. Mantener un límite
    // compartido de 2/10 min hacía que la propia UI se bloqueara durante una
    // instalación legítima. Seguimos limitando abusos, pero permitimos una sesión
    // completa de aprovisionamiento acústico.
    rateLimit(10 * 60_000, 24, "native-sample-pack-install"),
    express.json({ limit: "8kb" }),
    async (req, res) => {
      const sourceId = Array.isArray(req.params.sourceId) ? req.params.sourceId[0] : req.params.sourceId
      const source = curatedSamplePackSource(sourceId || "")
      if (!source) return res.status(404).json({ message: "El paquete de muestras no está disponible para instalación" })
      if (req.body?.acknowledgement !== source.acknowledgement) {
        return res.status(400).json({ message: "Debes aceptar la licencia y procedencia del paquete" })
      }
      if (!safeModuleId(source.moduleId)) return res.status(500).json({ message: "El id curado del módulo es inválido" })

      let storage: Client | undefined
      try {
        // Falla rápido si App Storage no está operativo: evita gastar datos y tiempo
        // descargando decenas de WAV que luego no podrían publicarse.
        const storageProbe = await probeAudioStorage()
        if (!storageProbe.ready) throw storageProbe.error
        storage = storageProbe.storage

        const downloaded = await downloadCuratedSamplePack(source)
        const sampleUrlByPath = new Map<string, string>()
        const sampleShaByPath = new Map<string, string>()
        let bytes = 0
        let uploadedSamples = 0

        for (const sample of downloaded.samples) {
          const objectName = `audio/sample-packs/samples/${sample.sha256}.wav`
          const exists = await storage.exists(objectName)
          if (!exists.ok) throw exists.error
          if (!exists.value) {
            const uploaded = await storage.uploadFromBytes(objectName, sample.bytes, { compress: false })
            if (!uploaded.ok) throw uploaded.error
            uploadedSamples += 1
          }
          bytes += sample.bytes.length
          const normalizedPath = sample.sourcePath.replace(/\\/g, "/")
          sampleUrlByPath.set(normalizedPath, `/api/audio/sample-packs/samples/${sample.sha256}.wav`)
          sampleShaByPath.set(normalizedPath, sample.sha256)
        }

        const pack = compileSfzBundleToTloqueSamplePack(downloaded.sfzSources.map(item => item.text), {
          id: source.moduleId,
          name: `${source.libraryName} · ${source.displayName}`,
          instrumentManifestId: source.manifestId,
          license: source.license,
          sourceName: source.libraryName,
          sourceUrl: source.repositoryUrl,
          sourceCommit: source.pinnedCommit,
          sampleUrlForPath: path => {
            const url = sampleUrlByPath.get(path.replace(/\\/g, "/"))
            if (!url) throw new Error(`Muestra no instalada: ${path}`)
            return url
          },
          sampleSha256ForPath: path => sampleShaByPath.get(path.replace(/\\/g, "/")),
        })

        const packBytes = Buffer.from(JSON.stringify(pack))
        const packSha256 = createHash("sha256").update(packBytes).digest("hex")
        const immutableObjectName = `audio/sample-packs/manifests/${packSha256}.json`
        const moduleObjectName = `audio/sample-packs/modules/${source.moduleId}.json`
        const packExists = await storage.exists(immutableObjectName)
        if (!packExists.ok) throw packExists.error
        if (!packExists.value) {
          const uploaded = await storage.uploadFromBytes(immutableObjectName, packBytes, { compress: false })
          if (!uploaded.ok) throw uploaded.error
        }
        const aliasUploaded = await storage.uploadFromBytes(moduleObjectName, packBytes, { compress: false })
        if (!aliasUploaded.ok) throw aliasUploaded.error

        res.status(201).json({
          url: `/api/audio/sample-packs/modules/${source.moduleId}.json`,
          immutableUrl: `/api/audio/sample-packs/manifests/${packSha256}.json`,
          sha256: packSha256,
          bytes,
          sampleCount: downloaded.samples.length,
          uploadedSamples,
          deduplicated: packExists.value && uploadedSamples === 0,
          manifestId: source.manifestId,
          moduleId: source.moduleId,
          version: source.version,
          displayName: source.displayName,
          instrumentId: source.instrumentId,
          source: {
            id: source.id,
            name: source.libraryName,
            displayName: source.displayName,
            license: source.license,
            repositoryUrl: source.repositoryUrl,
            pinnedCommit: source.pinnedCommit,
            sfzPath: source.sfzPath,
            sfzPaths: source.sfzPaths,
            sfzSha256: downloaded.sfzSha256,
            sfzSources: downloaded.sfzSources.map(item => ({ path: item.path, sha256: item.sha256 })),
            tags: source.tags,
          },
        })
      } catch (error) {
        audioStorage.reset(storage)
        console.error(`Curated sample-pack installation failed (${source.id}):`, error)
        const failure = readableInstallerError(error)
        res.locals.publicErrorMessage = true
        res.status(failure.status).json({ message: failure.message })
      }
    },
  )
}
