import { createHash } from "node:crypto"
import { AUDIO_MODULE_SOURCES, type AudioModuleSource } from "../shared/audio-module-sources"
import { detectSoundBankType } from "./soundBankDetection"

export const MAX_CURATED_MODULE_BYTES = 64 * 1024 * 1024

export function curatedAudioModuleSource(id: string): AudioModuleSource | null {
  return AUDIO_MODULE_SOURCES.find(source => source.id === id && source.install) || null
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
