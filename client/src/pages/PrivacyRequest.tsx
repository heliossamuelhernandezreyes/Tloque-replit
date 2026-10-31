import { useState, type FormEvent } from "react"
import { PRIVACY_REQUEST_LABELS, PRIVACY_REQUEST_TYPES } from "@shared/legal"

export default function PrivacyRequest() {
  const [email, setEmail] = useState("")
  const [type, setType] = useState<string>("access")
  const [description, setDescription] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [receipt, setReceipt] = useState<{ folio: string; receivedAt: string; status: string; message: string } | null>(null)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError("")
    try {
      const response = await fetch("/api/privacy/requests", { method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, type, description }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.message || "No se pudo registrar la solicitud")
      setReceipt(body)
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo registrar la solicitud") }
    finally { setBusy(false) }
  }
  function download() {
    if (!receipt) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...receipt, type, email }, null, 2)], { type: "application/json" }))
    const link = document.createElement("a"); link.href = url; link.download = `tloque-solicitud-${receipt.folio}.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <main className="min-h-screen bg-black px-5 py-10 text-zinc-200"><section className="mx-auto max-w-xl">
    <a href="/privacy" className="text-sm underline">Aviso de privacidad</a><h1 className="mt-7 font-serif text-3xl">Solicitud de privacidad</h1>
    <p className="mt-4 text-sm leading-6 text-white/60">No necesitas iniciar sesión. No adjuntes identificaciones, datos bancarios ni manuscritos. Se verificará identidad y alcance antes de entregar o eliminar datos.</p>
    {receipt ? <div className="mt-6 space-y-4 rounded-xl border border-emerald-200/30 p-5" role="status"><p>Solicitud recibida</p><p className="break-all font-mono text-sm">{receipt.folio}</p><p className="text-sm">{new Date(receipt.receivedAt).toLocaleString()}</p><p className="text-sm leading-6">{receipt.message}</p><button className="min-h-11 underline" onClick={download}>Descargar comprobante</button></div>
      : <form onSubmit={event => void submit(event)} className="mt-7 space-y-5">
        <label className="block text-sm">Correo para seguimiento<input type="email" required maxLength={254} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-white/20 bg-zinc-950 p-3" /></label>
        <label className="block text-sm">Derecho o solicitud<select value={type} onChange={event => setType(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-white/20 bg-zinc-950 p-3">{PRIVACY_REQUEST_TYPES.map(value => <option value={value} key={value}>{PRIVACY_REQUEST_LABELS[value]}</option>)}</select></label>
        <label className="block text-sm">Qué necesitas revisar<textarea required minLength={10} maxLength={4000} value={description} onChange={event => setDescription(event.target.value)} className="mt-2 min-h-32 w-full rounded-lg border border-white/20 bg-zinc-950 p-3" /></label>
        {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}<button disabled={busy} className="min-h-11 rounded-full bg-white px-6 text-black disabled:opacity-40">{busy ? "Registrando…" : "Presentar solicitud"}</button>
      </form>}
  </section></main>
}
