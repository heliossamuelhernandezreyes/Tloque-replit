// Comprime una imagen a base64, redimensionando el lado mayor a maxSize.
// Reutilizable para portadas, avatares, etc.
export function compressImage(file: File, maxSize = 800, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      const img = new window.Image()
      img.onload = () => {
        let { width, height } = img
        if (width > height && width > maxSize) {
          height = Math.round((height * maxSize) / width)
          width  = maxSize
        } else if (height > maxSize) {
          width  = Math.round((width * maxSize) / height)
          height = maxSize
        }
        const canvas = document.createElement("canvas")
        canvas.width  = width
        canvas.height = height
        const ctx = canvas.getContext("2d")
        if (!ctx) { reject(new Error("No canvas context")); return }
        ctx.drawImage(img, 0, 0, width, height)
        const isPng = file.type === "image/png"
        resolve(canvas.toDataURL(isPng ? "image/png" : "image/jpeg", quality))
      }
      img.onerror = () => reject(new Error("Image load failed"))
      img.src = e.target?.result as string
    }
    reader.onerror = () => reject(new Error("File read failed"))
    reader.readAsDataURL(file)
  })
}
