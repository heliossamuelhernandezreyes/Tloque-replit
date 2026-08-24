import { createHash } from "node:crypto"
import type { CuratedExternalPcmPackSource } from "../shared/curated-external-pcm-packs"
import { convertAiffPcmToWav } from "./aiffPcm"
import { compileExternalPcmPathsToSfz } from "./externalPcmSamplePackCompiler"
import { compileSfzBundleToTloqueSamplePack } from "./sfzSamplePackCompiler"
import type { DownloadedCuratedSamplePack, DownloadedCuratedSample } from "./audioModuleInstaller"

const MAX_EXTERNAL_SOURCE_BYTES = 8 * 1024 * 1024
const MAX_EXTERNAL_PACK_BYTES = 128 * 1024 * 1024

function safeRelativePath(value: string) {
  const path = value.trim().replace(/\\/g, "/").replace(/^\/+/, "")
  if (!path || path.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Ruta PCM externa inválida")
  return path
}

export function fixedExternalPcmUrl(source: CuratedExternalPcmPackSource, path: string) {
  const safePath = safeRelativePath(path)
  if (source.gitlabProjectId) {
    if (new URL(source.externalBaseUrl).origin !== "https://gitlab.com") throw new Error("Base GitLab PCM inválida")
    if (!/^[a-f0-9]{8,40}$/i.test(source.pinnedCommit)) throw new Error("Revisión GitLab PCM inválida")
    return `https://gitlab.com/api/v4/projects/${source.gitlabProjectId}/repository/files/${encodeURIComponent(safePath)}/raw?ref=${encodeURIComponent(source.pinnedCommit)}&lfs=true`
  }
  const base = new URL(source.externalBaseUrl)
  if (base.protocol !== "https:" || !base.pathname.endsWith("/")) throw new Error("Base PCM externa inválida")
  const url = new URL(safePath.split("/").map(encodeURIComponent).join("/"), base)
  if (url.origin !== base.origin || !decodeURIComponent(url.pathname).startsWith(decodeURIComponent(base.pathname))) throw new Error("Ruta PCM fuera de la fuente fijada")
  return url.toString()
}

export function assertFixedExternalResponse(response: Response, source: CuratedExternalPcmPackSource) {
  const finalUrl = new URL(response.url)
  if (source.gitlabProjectId) {
    if (finalUrl.protocol !== "https:" || finalUrl.hostname !== "gitlab.com" || !finalUrl.pathname.startsWith(`/api/v4/projects/${source.gitlabProjectId}/repository/files/`)) {
      throw new Error(`La fuente GitLab PCM redirigió fuera del API permitido: ${finalUrl.hostname}`)
    }
    return
  }
  const base = new URL(source.externalBaseUrl)
  if (finalUrl.protocol !== "https:" || finalUrl.origin !== base.origin) throw new Error(`La fuente PCM redirigió fuera del origen permitido: ${finalUrl.hostname}`)
  if (!decodeURIComponent(finalUrl.pathname).startsWith(decodeURIComponent(base.pathname))) throw new Error("La fuente PCM redirigió fuera de la ruta fijada")
}

async function fetchFixedExternal(source: CuratedExternalPcmPackSource, path: string, fetcher: typeof fetch) {
  const response = await fetcher(fixedExternalPcmUrl(source, path), {
    redirect: "follow",
    headers: { Accept: "audio/aiff,audio/wav,application/octet-stream", "User-Agent": "Tloque-Curated-PCM-Installer/1.0" },
  })
  if (!response.ok) throw new Error(`La fuente PCM respondió ${response.status}`)
  if (response.url) assertFixedExternalResponse(response, source)
  const declaredBytes = Number(response.headers.get("content-length") || 0)
  if (declaredBytes > MAX_EXTERNAL_SOURCE_BYTES) throw new Error("La muestra PCM externa excede 8 MB")
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length) throw new Error("La muestra PCM externa llegó vacía")
  if (bytes.length > MAX_EXTERNAL_SOURCE_BYTES) throw new Error("La muestra PCM externa excede 8 MB")
  return bytes
}

function assertWav(bytes: Buffer) {
  const valid = bytes.length >= 44 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE"
  if (!valid) throw new Error("La muestra PCM externa no es un WAV RIFF válido")
}

export async function downloadCuratedExternalPcmPack(
  source: CuratedExternalPcmPackSource,
  fetcher: typeof fetch = fetch,
): Promise<DownloadedCuratedSamplePack> {
  if (!source.externalPaths.length || source.externalPaths.length > 256) throw new Error("El paquete PCM externo tiene una cantidad inválida de muestras")
  const compiled = compileExternalPcmPathsToSfz(source.externalPaths, source.mappingProfile)
  if (compiled.samples.length !== source.externalPaths.length) throw new Error("El mapping PCM no reconoció todas las muestras fijadas")

  let totalBytes = 0
  const samples: DownloadedCuratedSample[] = []
  for (const mapped of compiled.samples) {
    const original = await fetchFixedExternal(source, mapped.sourcePath, fetcher)
    const wav = source.inputFormat === "aiff-pcm" ? convertAiffPcmToWav(original) : original
    assertWav(wav)
    totalBytes += wav.length
    if (totalBytes > MAX_EXTERNAL_PACK_BYTES) throw new Error("El paquete PCM externo supera 128 MB")
    samples.push({ sourcePath: mapped.samplePath, bytes: wav, sha256: createHash("sha256").update(wav).digest("hex") })
  }

  compileSfzBundleToTloqueSamplePack([compiled.sfzText], {
    id: source.moduleId,
    name: `${source.libraryName} · ${source.displayName}`,
    instrumentManifestId: source.manifestId,
    license: source.license,
    sourceName: source.libraryName,
    sourceUrl: source.repositoryUrl,
    sourceCommit: source.pinnedCommit,
    sampleUrlForPath: path => `/api/audio/sample-packs/samples/${createHash("sha256").update(path).digest("hex")}.wav`,
  })

  const sfzSha256 = createHash("sha256").update(compiled.sfzText).digest("hex")
  return {
    moduleId: source.moduleId,
    manifestId: source.manifestId,
    version: source.version,
    pinnedCommit: source.pinnedCommit,
    sfzSha256,
    sfzText: compiled.sfzText,
    sfzSources: [{ path: `generated:${source.mappingProfile}`, sha256: sfzSha256, text: compiled.sfzText }],
    samples,
    source,
  }
}
