import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { accountFetch } from "@/lib/account-context"
import { PRIVACY_REQUEST_LABELS, type PRIVACY_REQUEST_TYPES } from "@shared/legal"

function RequestHistory({ id }: { id: number }) {
  const query = useQuery<any[]>({ queryKey: ["/api/admin/privacy/requests", id, "events"], queryFn: async () => {
    const response = await accountFetch(`/api/admin/privacy/requests/${id}/events`, { credentials: "include", cache: "no-store" })
    if (!response.ok) throw new Error("No se pudo cargar la bitácora")
    return response.json()
  }, refetchOnMount: "always" })
  return <div className="mt-4 border-t border-white/15 pt-4">{query.isLoading && <p role="status">Cargando actuaciones…</p>}{query.isError && <p role="alert">No se pudo cargar la bitácora.</p>}{query.data?.map(event => <p key={event.id} className="mb-3 whitespace-pre-wrap break-words text-xs leading-5"><time>{new Date(event.createdAt).toLocaleString()}</time> · {event.status}<br />{event.note}</p>)}</div>
}

export default function PrivacyAdmin() {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<number | null>(null)
  const query = useQuery<any[]>({ queryKey: ["/api/admin/privacy/requests"], queryFn: async () => {
    const response = await accountFetch("/api/admin/privacy/requests", { credentials: "include", cache: "no-store" })
    if (!response.ok) throw new Error("No se pudieron cargar las solicitudes")
    return response.json()
  } })
  async function update(id: number, status: string) {
    const note = window.prompt("Registra la actuación realizada. Cambiar el estado no envía una respuesta ni elimina datos. No copies identificaciones aquí.")
    if (!note || note.trim().length < 5 || busy) return
    setBusy(true); setError("")
    try {
      const response = await accountFetch(`/api/admin/privacy/requests/${id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, note }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || "No se pudo actualizar")
      setHistory(null)
      await query.refetch()
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo actualizar") }
    finally { setBusy(false) }
  }
  return <main className="min-h-screen bg-black p-6 text-white"><section className="mx-auto max-w-3xl"><a href="/admin" className="underline">Administración</a><h1 className="mt-8 font-serif text-3xl">Solicitudes de privacidad</h1><p className="mt-4 text-sm text-white/60">Verifica identidad, alcance, fundamento y plazos antes de actuar. Esta bandeja registra actuaciones; no envía correos ni ejecuta borrados.</p>
    {(error || query.isError) && <p role="alert" className="mt-4 text-amber-200">{error || "No se pudieron cargar las solicitudes"}</p>}
    {query.isLoading && <p>Cargando…</p>}{query.data?.length === 0 && <p className="mt-5">Sin solicitudes.</p>}
    <div className="mt-6 space-y-4">{query.data?.map(row => <article key={row.id} className="rounded-xl border border-white/15 p-4"><h2 className="break-all font-mono text-xs">{row.publicId}</h2><p className="mt-3 break-words">{PRIVACY_REQUEST_LABELS[row.type as typeof PRIVACY_REQUEST_TYPES[number]] || row.type} · {row.status} · {row.email}</p><p className="mt-2 text-xs">Recibida: {new Date(row.createdAt).toLocaleString()}</p><p className="mt-3 whitespace-pre-wrap break-words text-sm">{row.description}</p><div className="mt-4 flex flex-wrap gap-3">{["verification", "processing", "answered", "closed"].map(status => <button key={status} disabled={busy} className="min-h-11 rounded-full border border-white/20 px-4 text-xs disabled:opacity-30" onClick={() => void update(row.id, status)}>{({ verification: "Verificación", processing: "En atención", answered: "Respondida", closed: "Cerrada" })[status as "closed"]}</button>)}<button className="min-h-11 rounded-full border border-white/20 px-4 text-xs" aria-expanded={history === row.id} onClick={() => setHistory(history === row.id ? null : row.id)}>Ver actuaciones</button></div>{history === row.id && <RequestHistory id={row.id} />}</article>)}</div>
  </section></main>
}
