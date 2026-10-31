import test from "node:test"
import assert from "node:assert/strict"
import React from "react"
import { create, act } from "react-test-renderer"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import PublicationConsent from "../client/src/components/PublicationConsent"
import PrivacyRequest from "../client/src/pages/PrivacyRequest"
import { legalDocuments } from "../shared/legal"

const documents = legalDocuments({ name: "Operador simulado", address: "Domicilio simulado para validación", privacyEmail: "contacto@fixture.mx", phone: "8180000000" })
const bundle = { hash: "a".repeat(64), publicationReady: true, documents }

test("publicar empieza sin permisos opcionales y exige declaración afirmativa", async () => {
  const oldDocument = globalThis.document
  const oldReact = (globalThis as any).React
  ;(globalThis as any).React = React
  ;(globalThis as any).document = { activeElement: null }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false, gcTime: 0 } } })
  client.setQueryData(["/api/legal/documents"], bundle)
  let root: ReturnType<typeof create>
  let confirmed: any = null
  try {
    await act(async () => { root = create(React.createElement(QueryClientProvider, { client }, React.createElement(PublicationConsent, { category: "book", onConfirm: value => { confirmed = value }, onCancel: () => {} }))) })
    const checks = root!.root.findAllByType("input")
    assert.equal(checks.length, 11)
    assert.ok(checks.every(input => input.props.checked === false))
    const confirm = () => root!.root.findAllByType("button").find(button => button.children.includes("Confirmar y publicar esta versión"))!
    assert.equal(confirm().props.disabled, true)
    await act(async () => { for (const input of checks.slice(-3)) input.props.onChange({ target: { checked: true } }) })
    assert.equal(confirm().props.disabled, false)
    await act(async () => { confirm().props.onClick() })
    assert.equal(confirmed.documentHash, bundle.hash)
    assert.ok(Object.values(confirmed.choices).every(value => value === false))
    await act(async () => { root!.root.findAllByType("input")[1].props.onChange({ target: { checked: true } }) })
    await act(async () => { confirm().props.onClick() })
    assert.equal(confirmed.choices.personalPrint, true)
    assert.equal(confirmed.choices.commercialPrint, false)
    assert.equal(confirmed.choices.audio, false)
    await act(async () => { client.setQueryData(["/api/legal/documents"], { ...bundle, publicationReady: false }); await new Promise(resolve => setTimeout(resolve, 0)) })
    assert.equal(confirm().props.disabled, true)
  } finally {
    await act(async () => { root!?.unmount() }); client.clear()
    globalThis.document = oldDocument; (globalThis as any).React = oldReact
  }
})

test("la solicitud no necesita sesión y muestra un comprobante sin ejecutar un borrado", async () => {
  const oldFetch = globalThis.fetch
  const oldReact = (globalThis as any).React
  ;(globalThis as any).React = React
  let submitted: RequestInit | undefined
  globalThis.fetch = async (_input, init) => {
    submitted = init
    return Response.json({ folio: "fixture-folio", receivedAt: "2026-10-30T10:00:00Z", status: "received", message: "No se ha ejecutado ninguna eliminación." }, { status: 201 })
  }
  let root: ReturnType<typeof create>
  try {
    await act(async () => { root = create(React.createElement(PrivacyRequest)) })
    await act(async () => {
      root!.root.findByType("input").props.onChange({ target: { value: "reader@fixture.mx" } })
      root!.root.findByType("select").props.onChange({ target: { value: "cancellation" } })
      root!.root.findByType("textarea").props.onChange({ target: { value: "Revisar mis borradores conservados" } })
    })
    await act(async () => { root!.root.findByType("form").props.onSubmit({ preventDefault() {} }); await new Promise(resolve => setTimeout(resolve, 0)) })
    assert.equal(submitted?.credentials, "omit")
    assert.equal(submitted?.method, "POST")
    assert.equal(JSON.parse(submitted?.body as string).type, "cancellation")
    assert.ok(JSON.stringify(root!.toJSON()).includes("fixture-folio"))
    assert.ok(JSON.stringify(root!.toJSON()).includes("No se ha ejecutado ninguna eliminación"))
  } finally { await act(async () => { root!?.unmount() }); globalThis.fetch = oldFetch; (globalThis as any).React = oldReact }
})
