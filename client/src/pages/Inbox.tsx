import QueryNotice from "@/components/QueryNotice"
import { useState } from "react"
import { accountFetch as fetch } from "@/lib/account-context"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bell, CheckCheck, LockKeyhole, Mail } from "lucide-react"
import { useLocation } from "wouter"
import { Layout } from "@/components/layout"
import { useSettings } from "@/context/SettingsContext"
import { experienceText } from "@shared/experience-i18n"

type Notice = { id: number; kind: string; title: string; body: string; destination: string; readAt: string | null; createdAt: string }
type Payload = { notifications: Notice[]; unread: number }

export default function Inbox() {
  const { settings } = useSettings()
  const [, setLocation] = useLocation()
  const client = useQueryClient()
  const copy = (key: Parameters<typeof experienceText>[1], vars?: Record<string, string | number>) => experienceText(settings.language, key, vars)
  const { data = { notifications: [], unread: 0 }, isLoading, isError, refetch } = useQuery<Payload>({
    queryKey: ["/api/notifications"],
    queryFn: async () => {
      const response = await fetch("/api/notifications", { credentials: "include" })
      if (!response.ok) throw new Error("inbox")
      return response.json()
    },
  })
  const [readError, setReadError] = useState("")
  const readAll = useMutation({
    mutationFn: async () => { const r = await fetch("/api/notifications/read-all", { method: "POST", credentials: "include" }); if (!r.ok) throw new Error("No se pudo marcar como leído") },
    onSuccess: () => client.invalidateQueries({ queryKey: ["/api/notifications"] }),
  })
  async function openNotice(notice: Notice) {
    try {
      if (!notice.readAt) { const response = await fetch(`/api/notifications/${notice.id}/read`, { method: "PATCH", credentials: "include" }); if (!response.ok) throw new Error("No se pudo marcar como leído") }
      setReadError("")
    } catch { setReadError("No se pudo actualizar la lectura de la notificación. Puedes volver a abrirla para reintentar.") }
    client.invalidateQueries({ queryKey: ["/api/notifications"] })
    if (/^\/(editions|library|rights|book\/\d+)$/.test(notice.destination)) setLocation(notice.destination)
  }

  return (
    <Layout>
      <section className="mx-auto w-full max-w-3xl px-4 pb-24 pt-8 sm:px-6">
        <div className="mb-7 flex items-start justify-between gap-4">
          <div><p className="tloque-eyebrow">Tloque</p><h1 className="mt-1 text-2xl text-white">{copy("inbox")}</h1><p className="mt-2 text-sm text-zinc-400">{copy("transactionalInbox")}</p></div>
          {!!data.unread && <button className="tloque-secondary-button" onClick={() => readAll.mutate()} disabled={readAll.isPending}><CheckCheck className="h-4 w-4" />{copy("markAllRead")}</button>}
        </div>
        <QueryNotice loading={isLoading} error={isError || readAll.isError} onRetry={() => { void refetch(); if (readAll.isError) readAll.mutate() }} />
        {readError && <p role="alert" className="my-3 text-sm text-amber-100">{readError}</p>}
        <div className="tloque-surface overflow-hidden">
          <div className="flex items-center gap-2 border-b border-white/5 px-5 py-4 text-sm text-white"><Bell className="h-4 w-4" />{copy("notifications")}{!!data.unread && <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">{data.unread}</span>}</div>
          {!isLoading && !isError && data.notifications.length === 0 && <div className="px-5 py-14 text-center"><Mail className="mx-auto h-7 w-7 text-white/65" /><p className="mt-3 text-sm text-zinc-400">{copy("emptyInbox")}</p></div>}
          {data.notifications.map(notice => (
            <button key={notice.id} onClick={() => openNotice(notice)} className="flex w-full gap-3 border-b border-white/5 px-5 py-4 text-left last:border-0 hover:bg-white/[.025]">
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${notice.readAt ? "bg-white/10" : "bg-violet-300"}`} />
              <span className="min-w-0 flex-1"><span className="block text-sm text-white">{notice.kind === "copy_claimed" ? copy("copyClaimed") : notice.title}</span><span className="mt-1 block text-xs text-zinc-400">{notice.kind === "copy_claimed" ? `${notice.title} · ${copy("copyClaimedBody", { folio: notice.body })}` : notice.body}</span></span>
              <time className="shrink-0 text-xs text-white/65">{new Date(notice.createdAt).toLocaleDateString(settings.language)}</time>
            </button>
          ))}
        </div>
        <div className="mt-4 flex gap-3 rounded-2xl border border-white/[.06] bg-white/[.02] p-4"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-white/65" /><div><p className="text-xs font-medium text-white/60">{copy("messages")}</p><p className="mt-1 text-xs leading-relaxed text-zinc-400">{copy("directMessagesProtected")}</p></div></div>
      </section>
    </Layout>
  )
}
