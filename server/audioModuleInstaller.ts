import { createHash } from "node:crypto"
import { AUDIO_MODULE_SOURCES, type AudioModuleSource } from "../shared/audio-module-sources"
import { compileSfzToTloqueSamplePack, samplePathsFromSfz } from "./sfzSamplePackCompiler"
import { detectSoundBankType } from "./soundBankDetection"

export const MAX_CURATED_MODULE_BYTES = 64 * 1024 * 1024
export const MAX_CURATED_SAMPLE_BYTES = 48 * 1024 * 1024
export const MAX_CURATED_SAMPLE_PACK_BYTES = 256 * 1024 * 1024

const RAW_GITHUB_ORIGIN = "https://raw.githubusercontent.com"

export function curatedAudioModuleSource(id: string): AudioModuleSource | null {
  return AUDIO_MODULE_SOURCES.find(source => source.id === id && source.install) || null
}

export function curatedSamplePackSource(id: string): AudioModuleSource | null {
  return AUDIO_MODULE_SOURCES.find(source => source.id === id && source.samplePackInstall) || null
}

export async function downloadCuratedAudioModule(
  source: AudioModuleSource,
  fetcher: typeof fetch = fetch,
) {
  if (!source.install) throw new Error("El módulo no tiene una descarga aprobada")
  const response = await fetcher(source.install.sourceUrl, {
    redirect: "error",
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "Tloque-Audio-Module-Installer/1.0",
    },
  })
  if (!response.ok) throw new Error(`La fuente respondió ${response.status}`)
  const declaredBytes = Number(response.headers.get("content-length") || 0)
  if (declaredBytes > MAX_CURATED_MODULE_BYTES) throw new Error("El módulo supera el límite de 64 MB")
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length) throw new Error("La descarga llegó vacía")
  if (bytes.length > MAX_CURATED_MODULE_BYTES) throw new Error("El módulo supera el límite de 64 MB")
  const detected = detectSoundBankType(bytes, source.install.fileName)
  if (!detected) throw new Error("La descarga fijada no contiene un banco SF2, SF3 o DLS válido")
  return {
    bytes,
    extension: detected.extension,
    mimeType: detected.mimeType,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
}

function rawGitHubUrl(repositoryUrl: string, commit: string, path: string) {
  const repository = new URL(repositoryUrl)
  if (repository.protocol !== "https:" || repository.hostname !== "github.com") throw new Error("Repositorio curado no permitido")
  const parts = repository.pathname.replace(/^\/+|\/+$/g, "").split("/")
  if (parts.length !== 2 || !/^[A-Za-z0-9_.-]+$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+$/.test(parts[1])) {
    throw new Error("Repositorio curado inválido")
  }
  const safePath = path.replace(/\\/g, "/").replace(/^\/+/, "")
  if (!safePath || safePath.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Ruta curada inválida")
  return `${RAW_GITHUB_ORIGIN}/${parts[0]}/${parts[1]}/${commit}/${safePath.split("/").map(encodeURIComponent).join("/")}`
}

function assertWav(bytes: Buffer) {
  const wav = bytes.length >= 44
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WAVE"
  if (!wav) throw new Error("La muestra fijada no es un WAV RIFF válido")
}

async function strictFetch(url: string, maxBytes: number, fetcher: typeof fetch) {
  const response = await fetcher(url, {
    redirect: "error",
    headers: {
      Accept: "application/octet-stream,text/plain;q=0.9",
      "User-Agent": "Tloque-Sample-Pack-Installer/1.0",
    },
  })
  if (!response.ok) throw new Error(`La fuente respondió ${response.status}`)
  const declaredBytes = Number(response.headers.get("content-length") || 0)
  if (declaredBytes > maxBytes) throw new Error("El archivo curado excede el tamaño permitido")
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length) throw new Error("La descarga curada llegó vacía")
  if (bytes.length > maxBytes) throw new Error("El archivo curado excede el tamaño permitido")
  return bytes
}

export interface DownloadedCuratedSample {
  sourcePath: string
  bytes: Buffer
  sha256: string
}

export interface DownloadedCuratedSamplePack {
  moduleId: string
  manifestId: string
  version: string
  pinnedCommit: string
  sfzSha256: string
  sfzText: string
  samples: readonly DownloadedCuratedSample[]
  source: AudioModuleSource
}

/**
 * Downloads a curated SFZ package strictly from its pinned GitHub commit.
 * The SFZ is parsed before any WAV is fetched, so arbitrary remote paths never
 * participate in installation. All samples are validated as RIFF/WAVE and the
 * complete package is bounded to protect Replit/mobile storage.
 */
export async function downloadCuratedSamplePack(
  source: AudioModuleSource,
  fetcher: typeof fetch = fetch,
): Promise<DownloadedCuratedSamplePack> {
  const install = source.samplePackInstall
  if (!install) throw new Error("La biblioteca no tiene un paquete de muestras aprobado")
  const sfzUrl = rawGitHubUrl(source.repositoryUrl, install.pinnedCommit, install.sfzPath)
  const sfzBytes = await strictFetch(sfzUrl, 2 * 1024 * 1024, fetcher)
  const sfzText = sfzBytes.toString("utf8")
  // Parse once before downloading. This validates preprocessor/traversal rules.
  compileSfzToTloqueSamplePack(sfzText, {
    id: install.moduleId,
    name: `${source.name} · Solo Violin`,
    instrument: "strings.violin",
    sourceName: source.name,
    sourceLicense: source.license,
    sourceCommit: install.pinnedCommit,
    sampleUrlForPath: path => `/api/audio/sample-packs/pending/${encodeURIComponent(path)}`,
  })
  const paths = samplePathsFromSfz(sfzText)
  if (!paths.length) throw new Error("El SFZ fijado no contiene muestras")
  if (paths.length > 256) throw new Error("El paquete curado contiene demasiadas muestras")

  const directory = install.sfzPath.includes("/") ? install.sfzPath.slice(0, install.sfzPath.lastIndexOf("/") + 1) : ""
  const samples: DownloadedCuratedSample[] = []
  let totalBytes = sfzBytes.length
  // Sequential by design: bounded memory and friendlier behavior on Replit.
  for (const sourcePath of paths) {
    const relative = sourcePath.replace(/\\/g, "/")
    const url = rawGitHubUrl(source.repositoryUrl, install.pinnedCommit, `${directory}${relative}`)
    const bytes = await strictFetch(url, MAX_CURATED_SAMPLE_BYTES, fetcher)
    assertWav(bytes)
    totalBytes += bytes.length
    if (totalBytes > MAX_CURATED_SAMPLE_PACK_BYTES) throw new Error("El paquete de muestras supera el límite seguro de 256 MB")
    samples.push({ sourcePath, bytes, sha256: createHash("sha256").update(bytes).digest("hex") })
  }

  return {
    moduleId: install.moduleId,
    manifestId: install.manifestId,
    version: install.version,
    pinnedCommit: install.pinnedCommit,
    sfzSha256: createHash("sha256").update(sfzBytes).digest("hex"),
    sfzText,
    samples,
    source,
  }
}
