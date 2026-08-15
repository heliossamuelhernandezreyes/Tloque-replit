import test from "node:test"
import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import {
  AUTHOR_SHARE_BOOK, AUTHOR_SHARE_STORY, betaPaymentsEnabled, priceFor,
  splitEarnings, stripeEnabled, stripeForm, TINTA_PACKS, verifyStripeWebhook,
} from "../server/payments"

test("preserva precios y reparto económico actuales", () => {
  assert.deepEqual(priceFor("support", { chapters: [{ content: "cuento" }] }), {
    tinta: 5, cents: 1_000, currency: "mxn", isStory: true,
  })
  assert.deepEqual(priceFor("support", { chapters: [{}, {}] }), {
    tinta: 10, cents: 2_000, currency: "mxn", isStory: false,
  })
  assert.equal(priceFor("sale", { chapters: [{}] }).tinta, 10)
  assert.deepEqual(splitEarnings(1_001, AUTHOR_SHARE_BOOK), { authorCents: 901, platformCents: 100 })
  assert.deepEqual(splitEarnings(1_001, AUTHOR_SHARE_STORY), { authorCents: 501, platformCents: 500 })
})

test("los paquetes de Tinta son transparentes y el valor mejora por volumen", () => {
  assert.deepEqual(TINTA_PACKS.map(pack => [pack.id, pack.tinta, pack.cents]), [
    ["gota", 25, 4_900], ["tintero", 55, 9_900], ["archivo", 120, 19_900],
  ])
  assert.equal(TINTA_PACKS.filter(pack => pack.recommended).length, 1)
  const unitPrices = TINTA_PACKS.map(pack => pack.cents / pack.tinta)
  assert.ok(unitPrices[0] > unitPrices[1] && unitPrices[1] > unitPrices[2])
})

test("el modo beta exige autorización explícita en cualquier entorno", () => {
  const oldNodeEnv = process.env.NODE_ENV
  const oldBeta = process.env.PAYMENTS_BETA_MODE
  try {
    process.env.NODE_ENV = "production"
    delete process.env.PAYMENTS_BETA_MODE
    assert.equal(betaPaymentsEnabled(), false)
    process.env.PAYMENTS_BETA_MODE = "true"
    assert.equal(betaPaymentsEnabled(), true)
    process.env.PAYMENTS_BETA_MODE = "false"
    assert.equal(betaPaymentsEnabled(), false)
    process.env.NODE_ENV = "development"
    delete process.env.PAYMENTS_BETA_MODE
    assert.equal(betaPaymentsEnabled(), false)
    process.env.PAYMENTS_BETA_MODE = "true"
    assert.equal(betaPaymentsEnabled(), true)
  } finally {
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = oldNodeEnv
    if (oldBeta === undefined) delete process.env.PAYMENTS_BETA_MODE
    else process.env.PAYMENTS_BETA_MODE = oldBeta
  }
})

test("Stripe exige secreto de webhook antes de cobrar en cualquier entorno", () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    stripe: process.env.STRIPE_SECRET_KEY,
    webhook: process.env.STRIPE_WEBHOOK_SECRET,
  }
  try {
    process.env.NODE_ENV = "production"
    process.env.STRIPE_SECRET_KEY = "sk_test_configured"
    delete process.env.STRIPE_WEBHOOK_SECRET
    assert.equal(stripeEnabled(), false)
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_configured"
    assert.equal(stripeEnabled(), true)
    process.env.NODE_ENV = "development"
    delete process.env.STRIPE_WEBHOOK_SECRET
    assert.equal(stripeEnabled(), false)
  } finally {
    for (const [key, value] of [
      ["NODE_ENV", previous.nodeEnv],
      ["STRIPE_SECRET_KEY", previous.stripe],
      ["STRIPE_WEBHOOK_SECRET", previous.webhook],
    ] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test("codifica estructuras anidadas para Stripe", () => {
  const encoded = stripeForm({ mode: "payment", line_items: [{ quantity: 1 }] }).join("&")
  assert.match(encoded, /mode=payment/)
  assert.match(encoded, /line_items%5B0%5D%5Bquantity%5D=1/)
})

test("verifica firma y ventana anti-replay del webhook", () => {
  const secret = "whsec_test"
  const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" })
  const timestamp = Math.floor(Date.now() / 1_000)
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")
  const header = `t=${timestamp},v1=${signature}`
  assert.deepEqual(verifyStripeWebhook(payload, header, secret), JSON.parse(payload))
  assert.equal(verifyStripeWebhook(payload + "x", header, secret), null)
  assert.equal(verifyStripeWebhook(payload, `t=${timestamp - 1_000},v1=${signature}`, secret), null)
})
