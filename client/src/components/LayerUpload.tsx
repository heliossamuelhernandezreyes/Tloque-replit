// Subidor de imágenes reutilizable (galería, archivos o URL) con
// compresión previa — compartido por el editor y las tarjetas.
import { useState } from "react"
import { motion } from "framer-motion"
import { X, Check, Image } from "lucide-react"
import { useSettings } from "@/context/SettingsContext"

export // ── COMPRESIÓN DE IMÁGENES — evita reventar localStorage (max ~150KB) ──
function compressImage(file: File, maxSize = 800, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      const img = new window.Image()
      img.onload = () => {
        let { width, height } = img
        // Redimensionar manteniendo proporción — lado mayor a maxSize
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
        // PNG conserva transparencia (capas); JPEG para fotos planas
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

export // ── SUBCOMPONENTE: UPLOAD DE CAPA ────────────────────────
function LayerUpload({
  label, url, gc, onUpload, inputRef, hint, compact = false,
}: {
  label:    string
  url:      string
  gc:       { color: string; glow: string }
  onUpload: (url: string) => void
  inputRef: React.RefObject<HTMLInputElement>
  hint?:    string
  compact?: boolean
}) {
  const { t } = useSettings()
  const [showUrl,  setShowUrl]  = useState(false)
  const [urlValue, setUrlValue] = useState("")
  const [busy,     setBusy]     = useState(false)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      // Comprimir antes de guardar — evita reventar localStorage
      const compressed = await compressImage(file)
      onUpload(compressed)
    } catch {
      // Fallback: usar el archivo crudo si la compresión falla
      const reader = new FileReader()
      reader.onloadend = () => onUpload(reader.result as string)
      reader.readAsDataURL(file)
    } finally {
      setBusy(false)
      e.target.value = ""  // permite volver a subir la misma imagen
    }
  }

  function handleUrl() {
    if (urlValue.trim()) {
      onUpload(urlValue.trim())
      setShowUrl(false)
      setUrlValue("")
    }
  }

  return (
    <div>
      {label && (
        <div className="flex items-center justify-between mb-1">
          <p className="text-[9px] text-zinc-600 uppercase tracking-widest font-sans">{label}</p>
          {hint && <p className="text-[9px] text-zinc-700 font-sans italic">{hint}</p>}
        </div>
      )}

      {showUrl && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          className="mb-2 flex gap-2"
        >
          <input
            value={urlValue}
            onChange={e => setUrlValue(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleUrl()}
            placeholder="https://..."
            autoFocus
            className="flex-1 text-white text-xs outline-none rounded-lg px-3 py-2 font-sans"
            style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${gc.color}40`, caretColor: gc.color }}
          />
          <motion.button whileTap={{ scale: 0.95 }} onClick={handleUrl}
            className="px-3 py-2 rounded-lg text-xs font-sans font-semibold"
            style={{ background: gc.color, color: "rgba(0,0,0,0.8)" }}>OK</motion.button>
          <motion.button whileTap={{ scale: 0.95 }} onClick={() => setShowUrl(false)}
            className="px-2 py-2 rounded-lg"
            style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>
            <X className="w-3 h-3" />
          </motion.button>
        </motion.div>
      )}

      <div className="flex gap-2">
        <motion.div
          whileTap={{ scale: 0.97 }}
          onClick={() => !busy && inputRef.current?.click()}
          className="relative flex-1 cursor-pointer rounded-xl overflow-hidden flex items-center gap-3"
          style={{
            height:     compact ? 40 : url ? 72 : 52,
            background: url ? "transparent" : "rgba(255,255,255,0.03)",
            border:     `1px dashed ${url ? gc.color + "40" : "rgba(255,255,255,0.10)"}`,
            padding:    "0 12px",
          }}
        >
          {busy ? (
            <p className="text-xs font-sans mx-auto" style={{ color: gc.color }}>Optimizando…</p>
          ) : url ? (
            <>
              <img loading="lazy" src={url}
                className="w-10 object-cover rounded-lg shrink-0" style={{ height: compact ? 32 : 60 }} />
              <p className="text-xs text-zinc-500 font-sans">Toca para cambiar</p>
              <div className="ml-auto"><Check className="w-3 h-3" style={{ color: gc.color }} /></div>
            </>
          ) : (
            <>
              <Image className="w-4 h-4 shrink-0" style={{ color: "rgba(255,255,255,0.2)" }} />
              <p className="text-xs text-zinc-600 font-sans">{t("galleryOrFiles")}</p>
            </>
          )}
        </motion.div>

        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowUrl(v => !v)}
          className="shrink-0 flex items-center justify-center rounded-xl text-[10px] font-sans"
          style={{
            width:      36,
            height:     compact ? 40 : url ? 72 : 52,
            background: showUrl ? `${gc.glow}20` : "rgba(255,255,255,0.04)",
            border:     `1px solid ${showUrl ? gc.color + "50" : "rgba(255,255,255,0.08)"}`,
            color:      showUrl ? gc.color : "rgba(255,255,255,0.3)",
          }}
          title="Pegar URL de imagen"
        >
          URL
        </motion.button>
      </div>

      {/* accept="image/*" abre galería + archivos en móvil */}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  )
}
