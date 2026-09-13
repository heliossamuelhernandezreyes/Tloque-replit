export const MAX_LAYER_DATA_URL = 400_000
export interface PreparedLayer { url: string; width: number; height: number; bytes: number; transparent: boolean; type: string }
const encode = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("No se pudo codificar la imagen")), "image/webp", quality)
})
const dataURL = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(new Error("No se pudo leer la imagen optimizada"))
  reader.readAsDataURL(blob)
})

/** Browser-only preparation. Alpha is preserved, including WebP input; no upload/API. */
export async function prepareLayer(file: File, maxEdge = 1280, quality = .9): Promise<PreparedLayer> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Usa una imagen estática PNG, JPEG o WebP. Exporta primero las capas de tu PSD.")
  if (file.size > 20_000_000) throw new Error("El archivo supera 20 MB. Reduce su tamaño antes de importarlo.")
  const source = URL.createObjectURL(file), img = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("La imagen tardó demasiado en abrirse")), 12000)
      img.onload = () => { clearTimeout(timer); resolve() }
      img.onerror = () => { clearTimeout(timer); reject(new Error("El archivo no contiene una imagen válida")) }
      img.src = source
    })
    if (!img.width || !img.height || img.width * img.height > 36_000_000) throw new Error("La imagen supera 36 megapíxeles. Exporta una versión de hasta 1280 px para la tarjeta.")
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) throw new Error("No se pudo preparar la imagen en este dispositivo")
    let edge = Math.min(1536, Math.max(320, maxEdge)), lastQuality = Math.max(.65, Math.min(.95, quality))
    // Bound both quality and dimensions. Never silently fall back to the raw oversized file.
    for (let attempt = 0; attempt < 9; attempt++) {
      const ratio = Math.min(1, edge / Math.max(img.width, img.height))
      canvas.width = Math.max(1, Math.round(img.width * ratio)); canvas.height = Math.max(1, Math.round(img.height * ratio))
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const blob = await encode(canvas, lastQuality)
      if (blob.size * 4 / 3 + 40 <= MAX_LAYER_DATA_URL) {
        const url = await dataURL(blob)
        if (url.length <= MAX_LAYER_DATA_URL) {
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
          let transparent = false
          for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 250) { transparent = true; break }
          return { url, width: canvas.width, height: canvas.height, bytes: blob.size, type: blob.type, transparent }
        }
      }
      if (attempt % 2 === 0 && blob.type === "image/webp") lastQuality = Math.max(.65, lastQuality - .1)
      else edge *= .8
    }
    throw new Error("La capa aún supera 400 KB codificados. Simplifica el fondo o exporta una imagen menor.")
  } finally { img.onload = null; img.onerror = null; img.src = ""; URL.revokeObjectURL(source) }
}
