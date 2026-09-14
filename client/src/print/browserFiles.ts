import { isSafeImageSource } from "@shared/media"
import type { PrintImage } from "./cover"

export async function loadCoverImage(source: string | undefined, signal: AbortSignal): Promise<PrintImage | null> {
  if (!source || !isSafeImageSource(source)) return null
  let url: string | undefined
  try {
    const response = await fetch(source, { signal })
    if (!response.ok || !/^image\/(png|jpeg|webp|gif)(;|$)/i.test(response.headers.get("content-type") || "")) return null
    if (Number(response.headers.get("content-length")) > 12_000_000) return null
    const reader = response.body?.getReader()
    if (!reader) return null
    const chunks: Uint8Array[] = []; let length = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > 12_000_000) { await reader.cancel(); return null }
      chunks.push(value)
    }
    url = URL.createObjectURL(new Blob(chunks, { type: response.headers.get("content-type") || "image/jpeg" }))
    const image = new Image(); image.src = url
    await image.decode()
    if (signal.aborted || image.naturalWidth * image.naturalHeight > 32_000_000 || !image.naturalWidth) return null
    const canvas = document.createElement("canvas")
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0)
    return { data: canvas.toDataURL("image/jpeg", .96), width: canvas.width, height: canvas.height }
  } catch { return null }
  finally { if (url) URL.revokeObjectURL(url) }
}
export function downloadFile(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename
  document.body.appendChild(anchor); anchor.click(); anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
export const printFilename = (title: string, suffix: string, ext = "pdf") => (title.replace(/[\x00-\x1f\x7f\\/*?:"<>|]/g, "").trim().slice(0, 90) || "Tloque") + " - " + suffix + "." + ext
