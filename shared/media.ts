const SAFE_IMAGE_DATA = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i

export function isSafeHttpsUrl(value: string, maxLength = 2_000): boolean {
  if (!value || value.length > maxLength) return false
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password
  } catch {
    return false
  }
}

export function isSafeImageSource(value: string, maxLength = 3_000_000): boolean {
  if (value === "") return true
  if (value.length > maxLength) return false
  if (value.startsWith("data:")) return SAFE_IMAGE_DATA.test(value)
  return isSafeHttpsUrl(value, Math.min(maxLength, 4_000))
}

export function isSafeAudioSource(value: string): boolean {
  if (/^\/api\/audio\/uploads\/[a-f0-9]{64}\.(?:mp3|wav)$/.test(value)) return true
  if (!isSafeHttpsUrl(value, 4_000)) return false
  try {
    const path = new URL(value).pathname.toLowerCase()
    return /\.(?:mp3|m4a|aac|ogg|oga|wav|flac|opus)$/.test(path)
  } catch {
    return false
  }
}

// Clave relativa y opaca para almacenamiento de audiolibros. Nunca se acepta
// una ruta absoluta, segmentos de navegación ni separadores de Windows: el
// mismo valor puede terminar en disco local o en un firmador de objetos.
export function isSafeStorageKey(value: string, maxLength = 1_000): boolean {
  if (!value || value.length > maxLength || value.includes("\\")) return false
  if (value.startsWith("/") || value.endsWith("/") || value.includes("\u0000")) return false
  const parts = value.split("/")
  return parts.every(part =>
    part.length > 0
    && part !== "."
    && part !== ".."
    && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part)
  )
}
