// Pagos de tokens — Stripe Checkout SIN SDK (API REST directa).
// Si STRIPE_SECRET_KEY no está configurada, todo opera en modo "beta"
// (las órdenes se confirman gratis al instante). Al poner las claves
// en los Secrets de Replit, el MISMO flujo empieza a cobrar de verdad.
import { createHmac, timingSafeEqual } from "crypto"

// ── Precios y economía de Tinta 🪙 ───────────────────────────
// 1 Tinta = $2.00 MXN (10 🪙 ≈ 1 USD). Cuento: 5 🪙 · Libro: 10 🪙.
// Reparto al autor: cuentos 50/50 · libros 90/10 (decisión Tloque:
// los cuentos sostienen la casa; los libros son casi todos del autor).
export const TINTA_CENTS = 200                 // centavos MXN por 1 Tinta

// Paquetes de Tinta (compra web vía Stripe; con bono por volumen)
export const TINTA_PACKS = [
  { id: "chico",   tinta: 25,  cents: 5000  },   // $50  — precio base
  { id: "mediano", tinta: 55,  cents: 10000 },   // $100 — 10% de bono
  { id: "grande",  tinta: 120, cents: 20000 },   // $200 — 20% de bono
] as const

// ¿La obra es cuento (un solo capítulo) o libro?
export function isStory(book: any): boolean {
  const n = Array.isArray(book?.chapters) ? book.chapters.length : 1
  return n <= 1
}

// Precio de un token para una obra concreta, en centavos y en Tinta
export function priceFor(kind: "support" | "sale", book: any) {
  const story = isStory(book)
  const tinta = kind === "sale" ? 10 : (story ? 5 : 10)
  return { tinta, cents: tinta * TINTA_CENTS, currency: "mxn" as const, isStory: story }
}

// Compatibilidad: precios máximos (libro) para vistas sin obra concreta
export const PRICES = {
  support: { cents: 10 * TINTA_CENTS, currency: "mxn" },
  sale:    { cents: 10 * TINTA_CENTS, currency: "mxn" },
} as const

export const AUTHOR_SHARE_BOOK  = 0.90         // libros: 90% al autor
export const AUTHOR_SHARE_STORY = 0.50         // cuentos: 50/50

export function splitEarnings(grossCents: number, authorShare = AUTHOR_SHARE_BOOK) {
  const authorCents = Math.round(grossCents * authorShare)
  return { authorCents, platformCents: grossCents - authorCents }
}

// ── Stripe ───────────────────────────────────────────────────
export function stripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

// Codifica un objeto anidado al formato form-urlencoded de Stripe
// (line_items[0][price_data][currency]=mxn …)
export function stripeForm(params: Record<string, any>, prefix = ""): string[] {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    const key = prefix ? `${prefix}[${k}]` : k
    if (v === null || v === undefined) continue
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "object") parts.push(...stripeForm(item, `${key}[${i}]`))
        else parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`)
      })
    } else if (typeof v === "object") {
      parts.push(...stripeForm(v, key))
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`)
    }
  }
  return parts
}

// Crea una sesión de Stripe Checkout y devuelve su URL de pago.
export async function createCheckoutSession(opts: {
  orderId:   number
  bookTitle: string
  kindLabel: string
  cents:     number
  currency:  string
  origin:    string
  bookId:    number
  metaKey?:     "orderId" | "walletOrderId"   // qué orden confirma el webhook
  successPath?: string                        // retorno propio (monedero)
  cancelPath?:  string
}): Promise<{ id: string; url: string }> {
  const metaKey = opts.metaKey || "orderId"
  const successUrl = opts.successPath
    ? `${opts.origin}${opts.successPath}`
    : `${opts.origin}/book/${opts.bookId}?paid=${opts.orderId}`
  const cancelUrl = opts.cancelPath
    ? `${opts.origin}${opts.cancelPath}`
    : `${opts.origin}/book/${opts.bookId}`
  const body = stripeForm({
    mode: "payment",
    client_reference_id: String(opts.orderId),
    [`metadata[${metaKey}]`]: String(opts.orderId),
    success_url: successUrl,
    cancel_url:  cancelUrl,
    line_items: [{
      quantity: 1,
      price_data: {
        currency:    opts.currency,
        unit_amount: opts.cents,
        product_data: { name: `${opts.kindLabel} · ${opts.bookTitle}`.slice(0, 120) },
      },
    }],
  }).join("&")

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type":  "application/x-www-form-urlencoded",
    },
    body,
  })
  const data: any = await res.json()
  if (!res.ok || !data?.url) {
    throw new Error(data?.error?.message || "No se pudo crear la sesión de pago")
  }
  return { id: data.id, url: data.url }
}

// Verifica la firma del webhook de Stripe (HMAC-SHA256 sobre `t.payload`).
// Devuelve el evento parseado, o null si la firma no es válida.
export function verifyStripeWebhook(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string,
  toleranceSec = 300,
): any | null {
  try {
    if (!signatureHeader) return null
    const parts: Record<string, string[]> = {}
    for (const kv of signatureHeader.split(",")) {
      const [k, v] = kv.split("=", 2)
      if (!k || v === undefined) continue
      ;(parts[k.trim()] ||= []).push(v.trim())
    }
    const t   = parts["t"]?.[0]
    const v1s = parts["v1"] || []
    if (!t || v1s.length === 0) return null

    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - Number(t)) > toleranceSec) return null   // anti-replay

    const payload  = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")
    const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")
    const expBuf   = Buffer.from(expected, "utf8")

    const valid = v1s.some(v1 => {
      const got = Buffer.from(v1, "utf8")
      return got.length === expBuf.length && timingSafeEqual(got, expBuf)
    })
    if (!valid) return null
    return JSON.parse(payload)
  } catch { return null }
}
