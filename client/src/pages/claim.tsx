import { useState } from "react"
import { useRoute, useLocation } from "wouter"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { motion } from "framer-motion"
import { Loader2, KeyRound, ShieldAlert, BadgeCheck, BookOpen, ArrowLeft } from "lucide-react"
import { Layout } from "@/components/layout"
import { useSettings } from "@/context/SettingsContext"

interface ClaimInfo {
  folio:    string
  status:   "free" | "yours" | "taken"
  kind:     string
  bookId:   number
  title:    string
  author:   string
  coverUrl: string
}

export default function ClaimPage() {
  const [, params]     = useRoute("/claim/:folio")
  const [, setLocation] = useLocation()
  const { t } = useSettings()
  const queryClient = useQueryClient()
  const folio = (params?.folio || "").toUpperCase()
  const [key, setKey] = useState(() => {
    try {
      const fragmentKey = new URLSearchParams(window.location.hash.slice(1)).get("key")
      // Compatibilidad con PDFs beta; la URL antigua se limpia antes de
      // efectuar cualquier otra navegación o solicitud.
      const legacyKey = new URLSearchParams(window.location.search).get("key")
      const value = (fragmentKey || legacyKey || "").toUpperCase()
      if (value) window.history.replaceState(null, "", window.location.pathname)
      return value
    } catch {
      return ""
    }
  })
  const [claimed, setClaimed] = useState(false)

  const { data, isLoading, error } = useQuery<ClaimInfo>({
    queryKey: [`/api/claim/${folio}`],
    queryFn: async () => {
      const res = await fetch(`/api/claim/${encodeURIComponent(folio)}`, { credentials: "include" })
      if (!res.ok) throw new Error(res.status === 404 ? "notfound" : "error")
      return res.json()
    },
    enabled: !!folio,
    retry: false,
  })

  const claim = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/claim/${encodeURIComponent(folio)}`, {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ key }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.message === "taken" ? "taken" : e.message || "error")
      }
      return res.json()
    },
    onSuccess: () => {
      setClaimed(true)
      queryClient.invalidateQueries({ queryKey: [`/api/claim/${folio}`] })
      // Refrescar los desbloqueados en el dispositivo
      fetch("/api/tokens/unlocked", { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then(d => d && localStorage.setItem("novareads_unlocked", JSON.stringify((d.bookIds || []).map(String))))
        .catch(() => {})
    },
  })

  const status = claimed ? "yours" : data?.status

  return (
    <Layout>
      <div className="max-w-md mx-auto px-5 pt-20 pb-32">
        <button onClick={() => setLocation("/")} className="flex items-center gap-1.5 text-xs font-sans mb-8"
          style={{ color: "rgba(255,255,255,0.5)" }}>
          <ArrowLeft className="w-3.5 h-3.5" /> Tloque
        </button>

        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-white/40" /></div>
        ) : error || !data ? (
          <p className="text-center text-sm font-sans py-16" style={{ color: "rgba(255,255,255,0.55)" }}>
            {t("claimNotFound")}
          </p>
        ) : (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            {/* Encabezado del ejemplar */}
            <p className="text-[10px] font-sans tracking-[0.22em] uppercase text-center mb-6"
              style={{ color: "rgba(255,255,255,0.4)" }}>
              {t("claimTitle")}
            </p>

            <div className="flex gap-4 items-start mb-6">
              {data.coverUrl && (
                <img src={data.coverUrl} alt="" className="w-20 rounded-lg shadow-lg flex-shrink-0"
                  style={{ aspectRatio: "2/3", objectFit: "cover" }} />
              )}
              <div className="min-w-0">
                <h1 className="text-lg font-display font-bold text-white leading-snug">{data.title}</h1>
                <p className="text-sm font-sans mt-1" style={{ color: "rgba(255,255,255,0.6)" }}>{data.author}</p>
                <p className="text-[11px] font-mono mt-3 px-2.5 py-1 rounded-lg inline-block"
                  style={{ background: "rgba(201,168,87,0.12)", color: "#c9a857", border: "1px solid rgba(201,168,87,0.3)" }}>
                  {data.folio}
                </p>
              </div>
            </div>

            {/* Estado */}
            {status === "yours" && (
              <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                className="rounded-2xl p-5 text-center"
                style={{ background: "rgba(90,200,130,0.08)", border: "1px solid rgba(90,200,130,0.3)" }}>
                <BadgeCheck className="w-8 h-8 mx-auto mb-2" style={{ color: "rgba(120,220,160,0.9)" }} />
                <p className="text-sm font-sans font-semibold text-white mb-1">
                  {claimed ? t("claimSuccess") : t("claimYours")}
                </p>
                <p className="text-xs font-sans leading-relaxed mb-4" style={{ color: "rgba(255,255,255,0.55)" }}>
                  {claimed ? t("claimSuccessDesc") : t("claimYoursDesc")}
                </p>
                <button
                  onClick={() => setLocation(`/book/${data.bookId}`)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-sans font-semibold"
                  style={{ background: "linear-gradient(135deg, rgba(120,220,160,0.9), rgba(90,200,130,0.8))", color: "rgba(0,0,0,0.85)" }}
                >
                  <BookOpen className="w-4 h-4" /> {t("claimRead")}
                </button>
              </motion.div>
            )}

            {status === "taken" && (
              <div className="rounded-2xl p-5"
                style={{ background: "rgba(230,150,60,0.08)", border: "1px solid rgba(230,150,60,0.35)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <ShieldAlert className="w-5 h-5" style={{ color: "rgba(240,170,90,0.95)" }} />
                  <p className="text-sm font-sans font-semibold text-white">{t("claimTaken")}</p>
                </div>
                <p className="text-xs font-sans leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>
                  {t("claimTakenDesc")}
                </p>
              </div>
            )}

            {status === "free" && (
              <div className="rounded-2xl p-5"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <p className="text-xs font-sans mb-4" style={{ color: "rgba(255,255,255,0.6)" }}>
                  {t("claimFree")}
                </p>
                <label className="text-[11px] font-sans font-semibold block mb-2"
                  style={{ color: "rgba(255,255,255,0.7)" }}>
                  {t("claimKeyLabel")}
                </label>
                <div className="flex items-center gap-2 rounded-xl px-3 mb-3"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)" }}>
                  <KeyRound className="w-4 h-4 flex-shrink-0" style={{ color: "rgba(201,168,87,0.7)" }} />
                  <input
                    value={key}
                    onChange={e => setKey(e.target.value.toUpperCase())}
                    placeholder={t("claimKeyPh")}
                    autoCapitalize="characters"
                    className="flex-1 bg-transparent py-3 text-sm font-mono outline-none text-white min-w-0"
                  />
                </div>
                {claim.isError && (
                  <p className="text-[11px] font-sans mb-3" style={{ color: "#e8a0a0" }}>
                    {(claim.error as Error)?.message === "taken" ? t("claimTakenDesc") : t("claimWrongKey")}
                  </p>
                )}
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => key.trim() && claim.mutate()}
                  disabled={!key.trim() || claim.isPending}
                  className="w-full py-3 rounded-xl text-sm font-sans font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg, #e0c878, #c9a857)", color: "rgba(0,0,0,0.85)" }}
                >
                  {claim.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("claimVerifying")}</> : t("claimBtn")}
                </motion.button>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </Layout>
  )
}
