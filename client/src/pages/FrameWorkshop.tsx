import { useEffect, useRef, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/hooks/useAuth"
import { useLocation } from "wouter"
import { ArrowLeft, Lock, Frame, Droplets, Trash2, ChevronDown, ChevronUp, Loader2 } from "lucide-react"

interface GalleryFrame {
  id: number
  name: string
  priceTinta: number
  target: string
  createdAt: string
  visible?: boolean
}

// Pantalla de administración: el Taller de Marcos.
// Solo admins. El taller vive en /taller-marcos.html (iframe aislado);
// al tocar "Guardar en la galería" manda un postMessage que aquí se
// recibe y se persiste en el servidor. Abajo, la galería de guardados.
export default function FrameWorkshop() {
  const { isAdmin, isLoading } = useAuth()
  const [, setLocation] = useLocation()
  const queryClient = useQueryClient()
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null)
  const [showGallery, setShowGallery] = useState(false)
  const workshopRef = useRef<HTMLIFrameElement>(null)
  const bridgeToken = useRef(crypto.randomUUID()).current
  const workshopUrl = `/taller-marcos.html?bridge=${encodeURIComponent(bridgeToken)}&parentOrigin=${encodeURIComponent(window.location.origin)}`

  const { data } = useQuery<{ frames: GalleryFrame[] }>({
    queryKey: ["/api/frames"],
    queryFn: async () => {
      const res = await fetch("/api/frames", { credentials: "include" })
      if (!res.ok) return { frames: [] }
      return res.json()
    },
    enabled: !!isAdmin,
  })
  const gallery = (data?.frames || []).filter(frame => frame.visible !== false)

  const save = useMutation({
    mutationFn: async (payload: { name: string; priceTinta: number; target?: string; pkg: any }) => {
      const res = await fetch("/api/admin/frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message || "No se pudo guardar")
      }
      return res.json()
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/frames"] })
      setBanner({ kind: "ok", text: `«${vars.name}» guardado en la galería ✓` })
      setShowGallery(true)
    },
    onError: (e: any) => setBanner({ kind: "err", text: e.message || "Error al guardar" }),
  })

  const retire = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/frames/${id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) throw new Error("No se pudo retirar")
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/frames"] }),
  })

  // Recibir el marco que manda el taller (iframe) al tocar "Guardar".
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Mismo origen: el taller se sirve desde nuestra propia app.
      if (e.origin !== window.location.origin) return
      if (e.source !== workshopRef.current?.contentWindow) return
      const d = e.data
      if (!d || d.type !== "tloque-frame-save" || d.bridgeToken !== bridgeToken || !d.frame) return
      save.mutate({
        name: String(d.name || d.frame?.editableDefinition?.name || "Marco sin título").slice(0, 60),
        priceTinta: Number(d.priceTinta) || 0,
        target: typeof d.target === "string" ? d.target : undefined,
        pkg: d.frame,
      })
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [save, bridgeToken])

  // Desvanecer el aviso tras unos segundos
  useEffect(() => {
    if (!banner) return
    const t = setTimeout(() => setBanner(null), 4000)
    return () => clearTimeout(t)
  }, [banner])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="w-6 h-6 border-2 border-zinc-700 border-t-amber-400 rounded-full animate-spin" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-zinc-950 px-6 text-center">
        <div className="p-3 rounded-full bg-zinc-900 border border-zinc-800">
          <Lock className="w-5 h-5 text-zinc-500" />
        </div>
        <p className="text-zinc-400 text-sm font-sans max-w-xs">
          Esta sección es solo para administradores.
        </p>
        <button onClick={() => setLocation("/")}
          className="text-xs text-amber-400/80 hover:text-amber-400 font-sans">
          Volver al inicio
        </button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-zinc-950 flex flex-col">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900 flex-shrink-0">
        <button onClick={() => setLocation("/")}
          className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400" aria-label="Volver">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-sm font-semibold text-zinc-200 tracking-wide"
            style={{ fontVariant: "small-caps" }}>
          Taller de Marcos
        </h1>
        {/* Galería: contador y despliegue */}
        <button onClick={() => setShowGallery(v => !v)}
          className="ml-auto flex items-center gap-1.5 text-[11px] font-sans px-2.5 py-1.5 rounded-lg"
          style={{ background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.3)", color: "#c9a84c" }}>
          <Frame className="w-3 h-3" />
          Galería ({gallery.length})
          {showGallery ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* Aviso de guardado */}
      {banner && (
        <div className="px-4 py-2 text-[12px] font-sans flex-shrink-0"
          style={{
            background: banner.kind === "ok" ? "rgba(107,208,138,0.12)" : "rgba(224,122,122,0.12)",
            color: banner.kind === "ok" ? "#6bd08a" : "#e07a7a",
            borderBottom: "1px solid " + (banner.kind === "ok" ? "rgba(107,208,138,0.25)" : "rgba(224,122,122,0.25)"),
          }}>
          {save.isPending ? <span className="inline-flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Guardando…</span> : banner.text}
        </div>
      )}

      {/* La galería de marcos guardados */}
      {showGallery && (
        <div className="flex-shrink-0 max-h-[38vh] overflow-y-auto border-b border-zinc-800 bg-zinc-900/60 px-4 py-3">
          {gallery.length === 0 ? (
            <p className="text-[11px] text-zinc-500 font-sans text-center py-3">
              Aún no hay marcos. Crea uno en el taller y tócale «Guardar en la galería de Tloque».
            </p>
          ) : (
            <div className="space-y-2">
              {gallery.map(f => (
                <div key={f.id}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <Frame className="w-4 h-4 flex-shrink-0" style={{ color: "#c9a84c" }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-sans font-semibold text-zinc-200 truncate">{f.name}</p>
                    <p className="text-[10px] text-zinc-500 font-sans">
                      {f.target === "card" ? "Cartas" : f.target === "profile" ? "Perfil" : "Cartas y perfil"}
                      {" · "}{new Date(f.createdAt).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                  <span className="flex items-center gap-1 text-[11px] font-sans font-semibold flex-shrink-0"
                    style={{ color: f.priceTinta > 0 ? "#e6cd82" : "#6bd08a" }}>
                    {f.priceTinta > 0 ? (<><Droplets className="w-3 h-3" />{f.priceTinta}</>) : "Gratis"}
                  </span>
                  <button
                    onClick={() => { if (confirm(`¿Retirar «${f.name}» de la galería?`)) retire.mutate(f.id) }}
                    className="p-1.5 rounded-lg flex-shrink-0 text-zinc-600 hover:text-red-400 hover:bg-red-400/10"
                    aria-label="Retirar de la galería">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <iframe
        ref={workshopRef}
        src={workshopUrl}
        title="Taller de Marcos"
        sandbox="allow-scripts allow-same-origin allow-downloads"
        referrerPolicy="no-referrer"
        className="flex-1 w-full border-0"
        style={{ background: "#0a0a0f", minHeight: 0, height: "100%", display: "block" }}
      />
    </div>
  )
}
