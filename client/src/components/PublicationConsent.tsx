import { useState, useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { accountFetch } from "@/lib/account-context"
import { RIGHTS_OPTIONS, type PublicationAcceptance, type LegalDocument, type RightsOption } from "@shared/legal"

export default function PublicationConsent({ category, onConfirm, onCancel }: {
  category: string; onConfirm: (value: PublicationAcceptance) => void; onCancel: () => void
}) {
  const [accepted, setAccepted] = useState(false)
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null
    const element = dialog.current
    element?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return
      const focusable = Array.from(element?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, summary') || [])
        .filter(item => item.getClientRects().length > 0)
      const first = focusable[0], last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element)) { event.preventDefault(); first.focus() }
    }
    element?.addEventListener("keydown", trap)
    return () => { element?.removeEventListener("keydown", trap); prior?.focus() }
  }, [])
  const [adult, setAdult] = useState(false)
  const [rights, setRights] = useState(false)
  const [origin, setOrigin] = useState<PublicationAcceptance["origin"]>("original")
  const [evidence, setEvidence] = useState("")
  const [choices, setChoices] = useState<PublicationAcceptance["choices"]>({ offline: false, personalPrint: false, commercialPrint: false, audio: false, translation: false, collectibles: false, monetization: false, permanentDigital: false })
  const query = useQuery<{ hash: string; documents: LegalDocument[]; publicationReady: boolean }>({
    queryKey: ["/api/legal/documents"], staleTime: 0,
    queryFn: async () => {
      const response = await accountFetch("/api/legal/documents", { credentials: "include", cache: "no-store" })
      if (!response.ok) throw new Error("No se pudieron cargar las condiciones")
      return response.json()
    },
  })
  const ready = !!query.data?.publicationReady && accepted && adult && rights && (origin === "original" || evidence.trim().length >= 20)
  return <div ref={dialog} tabIndex={-1} onKeyDown={event => { if (event.key === "Escape") onCancel() }} className="fixed inset-0 z-[700] overflow-y-auto bg-black/90 p-4 sm:p-8" role="dialog" aria-modal="true" aria-labelledby="publication-rights-title">
    <section className="mx-auto max-w-2xl rounded-2xl border border-white/15 bg-zinc-950 p-5 text-white sm:p-8">
      <h2 id="publication-rights-title" className="font-serif text-2xl">Permisos de esta versión</h2>
      <p className="mt-3 text-sm leading-6 text-white/65">Conservas tus derechos. Las opciones adicionales empiezan desmarcadas.</p>
      <p className="mt-3 text-sm">{category === "story" ? "Cuento: reparto propuesto 50% autor / 50% Tloque" : "Libro: reparto propuesto 90% autor / 10% Tloque"}. Cobrar requiere acuerdo comercial adicional.</p>
      {query.isLoading && <p className="mt-4" role="status">Cargando condiciones…</p>}
      {query.isError && <button type="button" className="mt-4 underline" onClick={() => void query.refetch()}>Reintentar carga de condiciones</button>}
      {query.data && <>
        {!query.data.publicationReady && <p className="mt-4 rounded-xl bg-amber-200/10 p-4 text-sm text-amber-100" role="status">Faltan datos del responsable y revisión de condiciones. Puedes cerrar y guardar tu borrador.</p>}
        <div className="mt-5 space-y-3">{query.data.documents.map(document => <details key={document.id} className="rounded-lg border border-white/10 p-3"><summary className="cursor-pointer text-sm">{document.title} · {document.version}</summary><p className="mt-3 whitespace-pre-line text-sm leading-6 text-white/65">{document.text}</p></details>)}</div>
        <label className="mt-5 block text-sm">Procedencia<select value={origin} onChange={event => setOrigin(event.target.value as PublicationAcceptance["origin"])} className="mt-2 block w-full rounded-lg border border-white/20 bg-zinc-900 p-3"><option value="original">Obra y recursos propios</option><option value="licensed">Permisos de terceros</option><option value="public_domain">Versión de dominio público verificada</option></select></label>
        {origin !== "original" && <label className="mt-4 block text-sm">Permiso, fuente y versión exacta<textarea className="mt-2 min-h-24 w-full rounded-lg border border-white/20 bg-zinc-900 p-3" value={evidence} maxLength={4000} onChange={event => setEvidence(event.target.value)} placeholder="Titular, edición/traductor, permiso o comprobación territorial. Sin datos sensibles." /></label>}
        <fieldset className="mt-5 space-y-3"><legend className="mb-3 font-medium">Opciones de la obra</legend>{(Object.entries(RIGHTS_OPTIONS) as [RightsOption, string][]).map(([key, label]) => <label key={key} className="flex min-h-11 items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={choices[key]} onChange={event => setChoices(value => ({ ...value, [key]: event.target.checked }))} />{label}</label>)}</fieldset>
        <div className="mt-5 space-y-3 border-t border-white/15 pt-5">
          <label className="flex min-h-11 items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1 h-4 w-4" checked={rights} onChange={event => setRights(event.target.checked)} />Tengo derechos o permisos suficientes sobre esta versión y sus recursos.</label>
          <label className="flex min-h-11 items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1 h-4 w-4" checked={adult} onChange={event => setAdult(event.target.checked)} />Soy mayor de edad y tengo facultades para concederlos. La contratación por representante requiere atención específica.</label>
          <label className="flex min-h-11 items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1 h-4 w-4" checked={accepted} onChange={event => setAccepted(event.target.checked)} />Leí los documentos y acepto la licencia de esta versión con las opciones elegidas. No autorizo entrenamiento de IA.</label>
        </div>
      </>}
      <div className="mt-6 flex flex-wrap gap-3"><button type="button" onClick={onCancel} className="min-h-11 rounded-full border border-white/20 px-5">Volver al borrador</button><button type="button" disabled={!ready} className="min-h-11 rounded-full bg-emerald-200 px-5 text-black disabled:opacity-30" onClick={() => { if (ready && query.data) onConfirm({ documentHash: query.data.hash, accepted: true, adultAndAuthorized: true, hasRights: true, origin, evidence: evidence.trim(), choices }) }}>Confirmar y publicar esta versión</button></div>
    </section>
  </div>
}
