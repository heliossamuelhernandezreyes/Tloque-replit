/** Default offers are shared by the server and isolated interface fixtures. */
export const TINTA_PACKS = [
  { id: "entrada", tinta: 5, cents: 2_000, label: "Entrada", recommended: false },
  { id: "gota", tinta: 10, cents: 3_000, label: "Gota", recommended: false },
  { id: "tintero", tinta: 20, cents: 5_500, label: "Tintero", recommended: true },
  { id: "biblioteca", tinta: 50, cents: 12_000, label: "Biblioteca", recommended: false },
  { id: "archivo", tinta: 100, cents: 22_000, label: "Archivo", recommended: false },
] as const

export const DEFAULT_PRICES = {
  support: { cents: 3500, currency: "mxn", tinta: 10 },
  sale:    { cents: 3000, currency: "mxn", tinta: 12 },
} as const
