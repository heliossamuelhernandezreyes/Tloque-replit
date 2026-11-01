// Browser QA entry, never imported by the product bundle.
import React from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { accountContext } from "../../client/src/lib/account-context"
import PublicationConsent from "../../client/src/components/PublicationConsent"
import PrivacyRequest from "../../client/src/pages/PrivacyRequest"
import PrivacyAdmin from "../../client/src/pages/PrivacyAdmin"
import RightsCenter from "../../client/src/pages/RightsCenter"
import TokensPanel from "../../client/src/components/TokensPanel"
import CommercialAgreement from "../../client/src/components/CommercialAgreement"
import { SettingsProvider } from "../../client/src/context/SettingsContext"
import "../../client/src/index.css"

let root: Root | undefined
let generation = 0
export function renderLegalFixture(view: "publication" | "request" | "admin" | "rights" | "tokens" | "commercial") {
  accountContext.activate(599)
  root ||= createRoot(document.getElementById("root")!)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  root.render(<QueryClientProvider key={++generation} client={client}>{view === "publication"
    ? <PublicationConsent category="book" onCancel={() => { (window as any).cancelled = true }} onConfirm={value => { (window as any).confirmed = value }} />
    : view === "commercial" ? <main className="min-h-screen bg-black p-6 text-white"><CommercialAgreement bookId={123} /></main> : view === "request" ? <PrivacyRequest /> : view === "rights" ? <RightsCenter /> : view === "tokens" ? <SettingsProvider><TokensPanel bookId={123} accentColor="#d1ba71" accentGlow="#d1ba71" isDownloading={false} onPrintCopy={() => {}} /></SettingsProvider> : <PrivacyAdmin />}</QueryClientProvider>)
}
