import { createHash } from "node:crypto"
import { posix as pathPosix } from "node:path"
import { AUDIO_MODULE_SOURCES, type AudioModuleSource } from "../shared/audio-module-sources"
import { curatedSamplePackById, type CuratedSamplePackSource } from "../shared/curated-sample-packs"
import { compileSfzBundleToTloqueSamplePack, samplePathsFromSfz } from "./sfzSamplePackCompiler"
import { detectSoundBankType } from "./soundBankDetection"

export const MAX_CURATED_MODULE_BYTES = 64 * 1024 * 1024
export const MAX_CURATED_SAMPLE_BYTES = 48 * 1024 * 1024
export const MAX_CURATED_SAMPLE_PACK_BYTES = 256 * 1024 * 1024

const RAW_GITHUB_ORIGIN = "https://raw.githubusercontent.com"

export function curatedAudioModuleSource(id: string): AudioModuleSource | null {
  return AUDIO_MODULE_SOURCES.find(source => source.id === id && source.install) || null
}

export function curatedSamplePackSource(id: string): CuratedSamplePackSource | null {
  return curatedSamplePackById(id)
}

export async function downloadCuratedAudioModule(source: AudioModuleSource, fetcher: typeof fetch = fetch) {
  if (!source.install) throw new Error("El módulo no tiene una descarga aprobada")
  const response = await fetcher(source.install.sourceUrl, {
    redirect: "error",
    headers: { Accept: "application/octet-stream", "User-Agent": "Tloque-Audio-Module-Installer/1.0" },
  })
  if (!response.ok) throw new Error(`La fuente respondió ${response.status}`)
  const declaredBytes = Number(response.headers.get("content-length") || 0)
  if (declaredBytes > MAX_CURATED_MODULE_BYTES) throw new Error("El módulo supera el límite de 64 MB")
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length) throw new Error("La descarga llegó vacía")
  if (bytes.length > MAX_CURATED_MODULE_BYTES) throw new Error("El módulo supera el límite de 64 MB")
  const detected = detectSoundBankType(bytes, source.install.fileName)
  if (!detected) throw new Error("La descarga fijada no contiene un banco SF2, SF3 o DLS válido")
  return { bytes, extension: detected.extension, mimeType: detected.mimeType, sha256: createHash("sha256").update(bytes).digest("hex") }
}

function rawGitHubUrl(repositoryUrl: string, commit: string, path: string) {
  const repository = new URL(repositoryUrl)
  if (repository.protocol !== "https:" || repository.hostname !== "github.com") throw new Error("Repositorio curado no permitido")
  const parts = repository.pathname.replace(/^\/+|\/+$/g, "").split("/")
  if (parts.length !== 2 || !/^[A-Za-z0-9_.-]+$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+$/.test(parts[1])) throw new Error("Repositorio curado inválido")
  const safePath = path.replace(/\\/g, "/").replace(/^\/+/, "")
  if (!safePath || safePath.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Ruta curada inválida")
  return `${RAW_GITHUB_ORIGIN}/${parts[0]}/${parts[1]}/${commit}/${safePath.split("/").map(encodeURIComponent).join("/")}`
}

function assertWav(bytes: Buffer) {
  const wav = bytes.length >= 44 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE"
  if (!wav) throw new Error("La muestra fijada no es un WAV RIFF válido")
}

async function strictFetch(url: string, maxBytes: number, fetcher: typeof fetch) {
  const response = await fetcher(url, {
    redirect: "error",
    headers: { Accept: "application/octet-stream,text/plain;q=0.9", "User-Agent": "Tloque-Sample-Pack-Installer/1.0" },
  })
  if (!response.ok) throw new Error(`La fuente respondió ${response.status}`)
  const declaredBytes = Number(response.headers.get("content-length") || 0)
  if (declaredBytes > maxBytes) throw new Error("El archivo curado excede el tamaño permitido")
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length) throw new Error("La descarga curada llegó vacía")
  if (bytes.length > maxBytes) throw new Error("El archivo curado excede el tamaño permitido")
  return bytes
}

function canonicalRepoPath(basePath: string, value: string) {
  const cleaned = value.trim().replace(/\\/g, "/")
  if (!cleaned || /^(?:https?:|file:|\/)/i.test(cleaned)) throw new Error("Ruta SFZ externa o absoluta")
  const resolved = pathPosix.normalize(pathPosix.join(basePath || ".", cleaned)).replace(/^\.\//, "")
  if (!resolved || resolved === ".." || resolved.startsWith("../")) throw new Error("Ruta SFZ fuera del repositorio")
  return resolved
}

/**
 * Curated repositories may legitimately use ../Samples relative to the top-level
 * program. Resolve those paths server-side against a fixed base, then feed only
 * canonical repository-relative paths to the inert parser. This never permits a
 * runtime SFZ to traverse storage.
 */
export function canonicalizeCuratedSfzPaths(sourceText: string, basePath: string) {
  let text = sourceText.replace(/\bdefault_path\s*=\s*([^\r\n<]+)/gi, (_match, raw: string) => {
    const value = raw.trim()
    return `default_path=${canonicalRepoPath(basePath, value)}`
  })
  text = text.replace(/\bsample\s*=\s*(.*?)(?=\s+[A-Za-z_][\w]*\s*=|\s*<|\r?$)/gim, (_match, raw: string) => {
    const value = raw.trim()
    return `sample=${canonicalRepoPath(basePath, value)}`
  })
  return text
}

export interface DownloadedCuratedSample { sourcePath: string; bytes: Buffer; sha256: string }
export interface DownloadedCuratedSfz { path: string; sha256: string; text: string }
export interface DownloadedCuratedSamplePack {
  moduleId: string
  manifestId: string
  version: string
  pinnedCommit: string
  sfzSha256: string
  sfzText: string
  sfzSources: readonly DownloadedCuratedSfz[]
  samples: readonly DownloadedCuratedSample[]
  source: CuratedSamplePackSource
}

export async function downloadCuratedSamplePack(source: CuratedSamplePackSource, fetcher: typeof fetch = fetch): Promise<DownloadedCuratedSamplePack> {
  const sfzPaths = source.sfzPaths.length ? source.sfzPaths : [source.sfzPath]
  if (sfzPaths.length > 8) throw new Error("El paquete curado contiene demasiados patches SFZ")

  const sfzSources: DownloadedCuratedSfz[] = []
  const sampleRemotePaths = new Map<string, string>()
  let totalBytes = 0

  for (const sfzPath of sfzPaths) {
    const sfzUrl = rawGitHubUrl(source.repositoryUrl, source.pinnedCommit, sfzPath)
    const sfzBytes = await strictFetch(sfzUrl, 2 * 1024 * 1024, fetcher)
    const defaultBase = sfzPath.includes("/") ? sfzPath.slice(0, sfzPath.lastIndexOf("/")) : ""
    const text = canonicalizeCuratedSfzPaths(sfzBytes.toString("utf8"), source.sfzSampleBasePath ?? defaultBase)
    compileSfzBundleToTloqueSamplePack([text], {
      id: source.moduleId,
      name: `${source.libraryName} · ${source.displayName}`,
      instrumentManifestId: source.manifestId,
      license: source.license,
      sourceName: source.libraryName,
      sourceUrl: source.repositoryUrl,
      sourceCommit: source.pinnedCommit,
      sampleUrlForPath: path => `/api/audio/sample-packs/samples/${createHash("sha256").update(path).digest("hex")}.wav`,
    })
    sfzSources.push({ path: sfzPath, sha256: createHash("sha256").update(sfzBytes).digest("hex"), text })
    totalBytes += sfzBytes.length

    for (const sourcePath of samplePathsFromSfz(text)) {
      const normalized = sourcePath.replace(/\\/g, "/")
      const previous = sampleRemotePaths.get(normalized)
      if (previous && previous !== normalized) throw new Error(`Ruta de muestra ambigua entre patches SFZ: ${normalized}`)
      sampleRemotePaths.set(normalized, normalized)
    }
  }

  if (!sampleRemotePaths.size) throw new Error("El paquete fijado no contiene muestras")
  if (sampleRemotePaths.size > 768) throw new Error("El paquete curado contiene demasiadas muestras")

  const samples: DownloadedCuratedSample[] = []
  for (const [sourcePath, remotePath] of sampleRemotePaths) {
    const url = rawGitHubUrl(source.repositoryUrl, source.pinnedCommit, remotePath)
    const bytes = await strictFetch(url, MAX_CURATED_SAMPLE_BYTES, fetcher)
    assertWav(bytes)
    totalBytes += bytes.length
    if (totalBytes > MAX_CURATED_SAMPLE_PACK_BYTES) throw new Error("El paquete de muestras supera el límite seguro de 256 MB")
    samples.push({ sourcePath, bytes, sha256: createHash("sha256").update(bytes).digest("hex") })
  }

  compileSfzBundleToTloqueSamplePack(sfzSources.map(item => item.text), {
    id: source.moduleId,
    name: `${source.libraryName} · ${source.displayName}`,
    instrumentManifestId: source.manifestId,
    license: source.license,
    sourceName: source.libraryName,
    sourceUrl: source.repositoryUrl,
    sourceCommit: source.pinnedCommit,
    sampleUrlForPath: path => `/api/audio/sample-packs/samples/${createHash("sha256").update(path).digest("hex")}.wav`,
  })

  const combinedSfzHash = createHash("sha256")
  for (const sfz of sfzSources) combinedSfzHash.update(sfz.path).update("\0").update(sfz.text).update("\0")

  return {
    moduleId: source.moduleId,
    manifestId: source.manifestId,
    version: source.version,
    pinnedCommit: source.pinnedCommit,
    sfzSha256: combinedSfzHash.digest("hex"),
    sfzText: sfzSources[0].text,
    sfzSources,
    samples,
    source,
  }
}
