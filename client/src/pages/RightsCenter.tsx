import { useState, type FormEvent } from "react"
import { useQuery } from "@tanstack/react-query"
import { accountFetch } from "@/lib/account-context"
import { useAuth } from "@/hooks/useAuth"

export default function RightsCenter() {
  const { user } = useAuth()
  const [busy, setBusy] = useState(false), [error, setError] = useState("")
  const [receipt, setReceipt] = useState<{ folio?: string; message: string } | null>(null)
  const mine = useQuery<{ public_id: string; book_id: number; status: string; deadline_at: string | null; work_description: string; location: string; rights_basis: string }[]>({
    queryKey: ["/api/rights/cases/mine", user?.id], enabled: !!user,
    queryFn: async () => { const r = await accountFetch("/api/rights/cases/mine"); if (!r.ok) throw new Error("No se pudieron cargar tus expedientes"); return r.json() },
  })
  async function submit(event: FormEvent<HTMLFormElement>, counter = false) {
    event.preventDefault(); if (busy) return
    const fields = new FormData(event.currentTarget)
    const body = counter ? { publicId: fields.get("publicId"), evidence: fields.get("evidence"), authorized: fields.get("authorized") === "on" }
      : { bookId: Number(fields.get("bookId")), name: fields.get("name"), email: fields.get("email"), work: fields.get("work"), location: fields.get("location"), rightsBasis: fields.get("rightsBasis"), goodFaith: fields.get("goodFaith") === "on" }
    setBusy(true); setError(""); setReceipt(null)
    try {
      const r = await (counter ? accountFetch : fetch)(`/api/rights/${counter ? "counter-notices" : "notices"}`, { method: "POST", credentials: counter ? "include" : "omit", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const response = await r.json()
      if (!r.ok) throw new Error(response.message || "No se pudo registrar la solicitud")
      setReceipt(response); if (counter) void mine.refetch()
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo registrar la solicitud") }
    finally { setBusy(false) }
  }
  return <main className="min-h-screen bg-black px-5 py-8 text-zinc-300"><article className="mx-auto max-w-3xl space-y-6">
    <a href="/" className="underline">Volver a Tloque</a>
    <h1 className="font-serif text-3xl text-white">Derechos de autor</h1>
    <p className="text-sm leading-7">Puedes comunicar una posible infracción sin crear una cuenta. Identifica la obra, tu derecho y el contenido concreto. No incluyas identificaciones, datos bancarios ni documentos sensibles. La recepción genera un folio y requiere atención del responsable.</p>
    <form onSubmit={event => void submit(event)} className="space-y-4 rounded-xl border border-white/15 p-5">
      <h2 className="text-xl text-white">Presentar un aviso</h2>
      <label className="tloque-field"><span>Número de la obra en Tloque</span><input name="bookId" type="number" min="1" required placeholder="123 en /book/123" /></label>
      <label className="tloque-field"><span>Titular o representante</span><input name="name" required minLength={2} maxLength={200} /></label>
      <label className="tloque-field"><span>Correo para notificaciones</span><input name="email" type="email" required maxLength={254} /></label>
      <label className="tloque-field"><span>Obra y contenido reclamados</span><textarea name="work" required minLength={10} maxLength={2000} /></label>
      <label className="tloque-field"><span>Ubicación electrónica y fragmento o capítulo</span><textarea name="location" required minLength={5} maxLength={2000} /></label>
      <label className="tloque-field"><span>Derecho o representación que invocas y evidencia disponible</span><textarea name="rightsBasis" required minLength={20} maxLength={4000} /></label>
      <label className="flex min-h-11 gap-3 text-sm"><input name="goodFaith" type="checkbox" required />Declaro de buena fe que tengo el derecho o representación indicados y que la información es correcta.</label>
      <button disabled={busy} className="tloque-primary-button disabled:opacity-40">{busy ? "Registrando…" : "Enviar aviso"}</button>
    </form>
    {error && <p role="alert" className="text-amber-100">{error}</p>}
    {receipt && <section role="status" className="space-y-2"><h2 className="text-xl text-white">Comprobante</h2>{receipt.folio && <p className="break-all font-mono">{receipt.folio}</p>}<p>{receipt.message}</p></section>}
    <details className="rounded-xl border border-white/15 p-5"><summary className="cursor-pointer text-white">Contraaviso del autor o publicante</summary>
      {!user ? <p className="mt-4"><a href="/api/auth/google" className="underline">Inicia sesión</a> con la cuenta que publicó la obra.</p> : <>
        {mine.isError && <button onClick={() => void mine.refetch()} className="mt-4 underline">Reintentar carga de expedientes</button>}
        {mine.data?.map(item => <section key={item.public_id} className="mt-3 space-y-2 break-words text-sm"><p>Obra {item.book_id} · {item.status} · {item.public_id}</p><p className="whitespace-pre-wrap">{item.work_description}</p><p className="whitespace-pre-wrap">{item.location}</p><p className="whitespace-pre-wrap">{item.rights_basis}</p></section>)}
        <form className="mt-5 space-y-4" onSubmit={event => void submit(event, true)}>
          <p className="text-sm leading-6">Si consideras que la retirada fue errónea, documenta tu titularidad, autorización para ese uso o excepción aplicable. El contraaviso no restaura por sí solo la obra ni inicia el plazo antes de su notificación efectiva al reclamante.</p>
          <label className="tloque-field"><span>Folio del aviso</span><input name="publicId" required /></label>
          <label className="tloque-field"><span>Autorización, titularidad o excepción y evidencia</span><textarea name="evidence" required minLength={20} maxLength={6000} /></label>
          <label className="flex min-h-11 gap-3 text-sm"><input name="authorized" type="checkbox" required />Declaro que tengo la autorización o base legal descrita para este uso.</label>
          <button disabled={busy} className="tloque-primary-button disabled:opacity-40">Registrar contraaviso</button>
        </form>
      </>}
    </details>
    <p className="text-sm leading-7">Se atienden avisos, contraavisos y órdenes conforme al régimen aplicable, con revisión de errores y medidas frente a infractores reincidentes. La venta de un libro físico no renueva un canje digital ya utilizado.</p>
    <nav className="flex gap-5 text-sm underline"><a href="/terms">Términos</a><a href="/privacy">Privacidad</a></nav>
  </article></main>
}
