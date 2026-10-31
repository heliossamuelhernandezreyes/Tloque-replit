import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { accountFetch } from "@/lib/account-context"
import { Layout } from "@/components/layout"

type RightsCase = { id: number; public_id: string; book_id: number; status: string; claimant_name: string; claimant_email: string; work_description: string; location: string; rights_basis: string; counter_notice: { evidence: string } | null; deadline_at: string | null }
const actions: Record<string, string[]> = { received: ["removed", "rejected", "closed"], removed: ["proceedings", "restored"], counter_received: ["counter_notified", "proceedings", "restored"], counter_notified: ["proceedings", "restored"], proceedings: ["restored"], restored: ["closed"], rejected: ["closed"], closed: [] }
const labels: Record<string, string> = { received: "Recibido", removed: "Retirar y bloquear", rejected: "Desestimar con motivo", closed: "Cerrar expediente", counter_received: "Contraaviso recibido", counter_notified: "Registrar entrega del contraaviso", proceedings: "Registrar procedimiento iniciado", restored: "Restaurar si procede" }

export default function RightsAdmin() {
  const client = useQueryClient(), [selected, setSelected] = useState<RightsCase | null>(null), [message, setMessage] = useState("")
  const query = useQuery<{ cases: RightsCase[]; approvals: { id: number; book_id: number; action: string; agreement_ref: string }[] }>({ queryKey: ["/api/admin/rights"], queryFn: async () => { const r = await accountFetch("/api/admin/rights"); if (!r.ok) throw new Error("No se pudo cargar la bandeja"); return r.json() } })
  const events = useQuery<{ id: number; action: string; note: string }[]>({ queryKey: ["/api/admin/rights", selected?.id, "events"], enabled: !!selected, queryFn: async () => { const r = await accountFetch(`/api/admin/rights/cases/${selected!.id}/events`); if (!r.ok) throw new Error("No se pudo cargar la bitácora"); return r.json() } })
  const mutation = useMutation({ mutationFn: async ({ path, method, body }: { path: string; method: string; body: unknown }) => {
    const r = await accountFetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const response = await r.json(); if (!r.ok) throw new Error(response.message || "Actuación rechazada"); return response
  }, onSuccess: response => { setMessage(response.message); setSelected(null); void client.invalidateQueries({ queryKey: ["/api/admin/rights"] }); void client.invalidateQueries({ queryKey: ["/api/payments/config"] }) } })
  function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget)
    mutation.mutate({ path: "/api/admin/rights/approvals", method: "POST", body: { bookId: Number(f.get("bookId")), revision: Number(f.get("revision")), action: f.get("action"), agreementRef: f.get("agreementRef"), evidenceRef: f.get("evidenceRef"), confirmedRightsAndAgreement: f.get("confirmed") === "on" } })
  }
  function decide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return
    const f = new FormData(event.currentTarget), notified = String(f.get("notifiedAt") || ""), deadline = String(f.get("deadlineAt") || "")
    mutation.mutate({ path: `/api/admin/rights/cases/${selected.id}`, method: "PATCH", body: { expectedStatus: selected.status, action: f.get("action"), note: f.get("note"), reference: f.get("reference"), resolutionConfirmed: f.get("resolution") === "on", ...(notified ? { notifiedAt: new Date(notified).toISOString() } : {}), ...(deadline ? { deadlineAt: new Date(deadline).toISOString() } : {}) } })
  }
  return <Layout><main className="mx-auto max-w-5xl space-y-6 px-5 py-8 pb-24 text-zinc-300">
    <h1 className="font-serif text-3xl text-white">Permisos y reclamaciones autorales</h1>
    <p className="text-sm leading-7">Acceso restringido. Los registros documentan actuaciones; no verifican por sí mismos la autenticidad de contratos. Notifica por el canal acordado y conserva constancia de entrega. Este panel no envía correos automáticamente.</p>
    {query.isError && <button className="underline" onClick={() => void query.refetch()}>Reintentar carga de expedientes</button>}
    <details className="tloque-surface p-5"><summary className="cursor-pointer text-white">Registrar revisión comercial de una edición</summary><form onSubmit={approve} className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className="tloque-field"><span>Número de obra</span><input name="bookId" type="number" min="1" required /></label><label className="tloque-field"><span>Revisión actual</span><input name="revision" type="number" min="1" required /></label>
      <label className="tloque-field"><span>Acuerdo comercial efectivo</span><input name="agreementRef" required minLength={5} maxLength={2000} /></label><label className="tloque-field"><span>Evidencia de facultades revisada</span><input name="evidenceRef" required minLength={5} maxLength={2000} /></label>
      <label className="tloque-field"><span>Actuación</span><select name="action"><option value="approve">Habilitar esta edición</option><option value="withdraw">Detener nuevas compras</option></select></label>
      <label className="flex min-h-11 gap-3 text-sm"><input name="confirmed" type="checkbox" required />Revisé las facultades del titular y el acuerdo real aplicable a esta edición.</label><button disabled={mutation.isPending} className="tloque-primary-button disabled:opacity-40">Registrar revisión</button>
    </form></details>
    {message && <p role="status">{message}</p>}{mutation.isError && <p role="alert" className="text-amber-100">{mutation.error.message}</p>}
    <h2 className="text-xl text-white">Avisos recibidos</h2>
    {query.data?.cases.length === 0 && <p>No hay avisos registrados.</p>}
    <div className="space-y-3">{query.data?.cases.map(item => <button key={item.id} onClick={() => { setSelected(item); mutation.reset() }} className="tloque-surface block w-full p-4 text-left"><p>Obra {item.book_id} · {labels[item.status] || item.status}</p><p className="mt-1 break-all text-xs text-zinc-500">{item.public_id}</p>{item.deadline_at && <p className="mt-1 text-xs">Vencimiento registrado: {new Date(item.deadline_at).toLocaleString()}</p>}</button>)}</div>
    {selected && <section className="tloque-surface space-y-4 p-5" key={selected.id}><h2 className="text-xl text-white">Expediente de obra {selected.book_id}</h2><p className="break-all text-sm">{selected.claimant_name} · {selected.claimant_email}</p><p className="whitespace-pre-wrap text-sm">{selected.work_description}</p><p className="whitespace-pre-wrap text-sm">{selected.location}</p><p className="whitespace-pre-wrap text-sm">{selected.rights_basis}</p>{selected.counter_notice && <p className="whitespace-pre-wrap text-sm">Contraaviso: {selected.counter_notice.evidence}</p>}
      <form onSubmit={decide} className="space-y-4"><label className="tloque-field"><span>Actuación</span><select name="action">{(actions[selected.status] || []).map(action => <option key={action} value={action}>{labels[action]}</option>)}</select></label><label className="tloque-field"><span>Motivo y alcance</span><textarea name="note" required minLength={10} maxLength={4000} /></label><label className="tloque-field"><span>Constancia de entrega, resolución o procedimiento</span><input name="reference" maxLength={2000} /></label>
        <p className="text-xs">Para notificar un contraaviso, registra la entrega efectuada y el vencimiento de los 15 días hábiles validado con el calendario aplicable. Fechas en la zona horaria de este dispositivo.</p><label className="tloque-field"><span>Entrega efectiva</span><input name="notifiedAt" type="datetime-local" /></label><label className="tloque-field"><span>Vencimiento validado</span><input name="deadlineAt" type="datetime-local" /></label><label className="flex gap-3 text-sm"><input name="resolution" type="checkbox" />La restauración se apoya en una resolución o retirada del reclamante que revisé y cuya referencia registré.</label><button disabled={mutation.isPending || !actions[selected.status]?.length} className="tloque-primary-button disabled:opacity-40">Registrar actuación</button>
      </form><h3 className="font-medium text-white">Bitácora</h3>{events.isError && <button className="underline" onClick={() => void events.refetch()}>Reintentar bitácora</button>}{events.data?.map(item => <p className="whitespace-pre-wrap text-xs" key={item.id}>{item.action} · {item.note}</p>)}
    </section>}
    <details><summary className="cursor-pointer">Revisiones comerciales registradas</summary>{query.data?.approvals.map(item => <p key={item.id} className="mt-2 text-sm">Obra {item.book_id} · {item.action} · {item.agreement_ref}</p>)}</details>
  </main></Layout>
}
