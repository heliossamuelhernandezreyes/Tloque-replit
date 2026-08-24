import { createHash } from "node:crypto"
import { posix as pathPosix } from "node:path"
import type { CuratedGitLabSamplePackSource } from "../shared/curated-gitlab-sample-packs"
import { compileSfzBundleToTloqueSamplePack, samplePathsFromSfz } from "./sfzSamplePackCompiler"
import type { DownloadedCuratedSample, DownloadedCuratedSamplePack, DownloadedCuratedSfz } from "./audioModuleInstaller"

const GITLAB_API_ORIGIN = "https://gitlab.com"
const MAX_GITLAB_SFZ_BYTES = 2 * 1024 * 1024
const MAX_GITLAB_SAMPLE_BYTES = 48 * 1024 * 1024
const MAX_GITLAB_PACK_BYTES = 256 * 1024 * 1024

function safeRepoPath(value: string) {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\/+/, "")
  if (!normalized || normalized.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Ruta GitLab curada inválida")
  return normalized
}

export function gitLabRawLfsUrl(source: CuratedGitLabSamplePackSource, path: string) {
  if (!Number.isInteger(source.gitlabProjectId) || source.gitlabProjectId <= 0) throw new Error("Proyecto GitLab curado inválido")
  if (!/^[a-f0-9]{8,40}$/i.test(source.pinnedCommit)) throw new Error("Revisión GitLab curada inválida")
  const safePath = safeRepoPath(path)
  const encodedPath = encodeURIComponent(safePath)
  return `${GITLAB_API_ORIGIN}/api/v4/projects/${source.gitlabProjectId}/repository/files/${encodedPath}/raw?ref=${encodeURIComponent(source.pinnedCommit)}&lfs=true`
}

function assertGitLabResponse(response: Response) {
  if (!response.url) return
  const finalUrl = new URL(response.url)
  if (finalUrl.protocol !== "https:" || finalUrl.hostname !== "gitlab.com" || !finalUrl.pathname.startsWith("/api/v4/projects/")) {
    throw new Error(`La descarga GitLab fue redirigida fuera del API permitido: ${finalUrl.hostname}`)
  }
}

async function strictGitLabFetch(source: CuratedGitLabSamplePackSource, path: string, maxBytes: number, fetcher: typeof fetch) {
  const response = await fetcher(gitLabRawLfsUrl(source, path), {
    redirect: "follow",
    headers: { Accept: "application/octet-stream,text/plain;q=0.9", "User-Agent": "Tloque-GitLab-Sample-Installer/1.0" },
  })
  if (!response.ok) throw new Error(`GitLab respondió ${response.status}`)
  assertGitLabResponse(response)
  const declared = Number(response.headers.get("content-length") || 0)
  if (declared > maxBytes) throw new Error("El archivo GitLab curado excede el límite permitido")
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length) throw new Error("La descarga GitLab llegó vacía")
  if (bytes.length > maxBytes) throw new Error("El archivo GitLab curado excede el límite permitido")
  return bytes
}

function canonicalRepoPath(basePath: string, value: string) {
  const cleaned = value.trim().replace(/\\/g, "/")
  if (!cleaned || /^(?:https?:|file:|\/)/i.test(cleaned)) throw new Error("Ruta SFZ GitLab externa o absoluta")
  const resolved = pathPosix.normalize(pathPosix.join(basePath || ".", cleaned)).replace(/^\.\//, "")
  if (!resolved || resolved === ".." || resolved.startsWith("../")) throw new Error("Ruta SFZ GitLab fuera del repositorio")
  return resolved
}

export function canonicalizeGitLabSfzPaths(sourceText: string, basePath: string) {
  let text = sourceText.replace(/\bdefault_path\s*=\s*([^\r\n<]+)/gi, (_match, raw: string) => `default_path=${canonicalRepoPath(basePath, raw.trim())}`)
  text = text.replace(/\bsample\s*=\s*(.*?)(?=\s+[A-Za-z_][\w]*\s*=|\s*<|\r?$)/gim, (_match, raw: string) => `sample=${canonicalRepoPath(basePath, raw.trim())}`)
  return text
}

function assertWav(bytes: Buffer) {
  const valid = bytes.length >= 44 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE"
  if (!valid) throw new Error("La muestra GitLab LFS no es un WAV RIFF válido")
}

export async function downloadCuratedGitLabSamplePack(
  source: CuratedGitLabSamplePackSource,
  fetcher: typeof fetch = fetch,
): Promise<DownloadedCuratedSamplePack> {
  const sfzBytes = await strictGitLabFetch(source, source.gitlabSfZPath, MAX_GITLAB_SFZ_BYTES, fetcher)
  const sfzBase = source.gitlabSfZPath.includes("/") ? source.gitlabSfZPath.slice(0, source.gitlabSfZPath.lastIndexOf("/")) : ""
  const sfzText = canonicalizeGitLabSfzPaths(sfzBytes.toString("utf8"), source.sfzSampleBasePath ?? sfzBase)
  const samplePaths = samplePathsFromSfz(sfzText)
  if (!samplePaths.length) throw new Error("El SFZ GitLab fijado no contiene muestras")
  if (samplePaths.length > 768) throw new Error("El paquete GitLab contiene demasiadas muestras")

  const prefix = safeRepoPath(source.gitlabSamplePrefix)
  for (const path of samplePaths) {
    if (!path.startsWith(prefix)) throw new Error(`El SFZ GitLab intenta salir del prefijo de muestras permitido: ${path}`)
  }

  let totalBytes = sfzBytes.length
  const samples: DownloadedCuratedSample[] = []
  for (const sourcePath of samplePaths) {
    const bytes = await strictGitLabFetch(source, sourcePath, MAX_GITLAB_SAMPLE_BYTES, fetcher)
    assertWav(bytes)
    totalBytes += bytes.length
    if (totalBytes > MAX_GITLAB_PACK_BYTES) throw new Error("El paquete GitLab supera el límite seguro de 256 MB")
    samples.push({ sourcePath, bytes, sha256: createHash("sha256").update(bytes).digest("hex") })
  }

  const shaByPath = new Map(samples.map(sample => [sample.sourcePath, sample.sha256]))
  compileSfzBundleToTloqueSamplePack([sfzText], {
    id: source.moduleId,
    name: `${source.libraryName} · ${source.displayName}`,
    instrumentManifestId: source.manifestId,
    license: source.license,
    sourceName: source.libraryName,
    sourceUrl: source.repositoryUrl,
    sourceCommit: source.pinnedCommit,
    sampleUrlForPath: path => `/api/audio/sample-packs/samples/${shaByPath.get(path) ?? createHash("sha256").update(path).digest("hex")}.wav`,
    sampleSha256ForPath: path => shaByPath.get(path),
  })

  const sfzSha256 = createHash("sha256").update(sfzText).digest("hex")
  const sfzSources: readonly DownloadedCuratedSfz[] = [{ path: source.gitlabSfZPath, sha256: createHash("sha256").update(sfzBytes).digest("hex"), text: sfzText }]
  return {
    moduleId: source.moduleId,
    manifestId: source.manifestId,
    version: source.version,
    pinnedCommit: source.pinnedCommit,
    sfzSha256,
    sfzText,
    sfzSources,
    samples,
    source,
  }
}
