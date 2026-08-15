export type PaperFeature = "oracle" | "elevenlabs"
export type SubscriptionPlanKey = "reader" | "aesthetic" | "audio"

export const PAPER_PLANS = [
  { key: "reader" as const, monthlyPaper: 20, oracle: false, elevenlabs: false },
  { key: "aesthetic" as const, monthlyPaper: 200, oracle: true, elevenlabs: false },
  { key: "audio" as const, monthlyPaper: 800, oracle: true, elevenlabs: true },
] as const

export const PAPER_RATES = {
  oracle: { unitName: "tokens", unitsPerPaper: 1_000 },
  elevenlabs: { unitName: "characters", unitsPerPaper: 1_000 },
} as const

export function paperChargeFor(
  feature: PaperFeature,
  inputUnits: number,
  outputUnits = 0,
  unitsPerPaper = PAPER_RATES[feature].unitsPerPaper,
): number {
  const input = Number.isFinite(inputUnits) ? Math.max(0, Math.trunc(inputUnits)) : 0
  const output = Number.isFinite(outputUnits) ? Math.max(0, Math.trunc(outputUnits)) : 0
  const scale = Number.isFinite(unitsPerPaper) ? Math.max(1, Math.trunc(unitsPerPaper)) : 1
  const measured = input + (feature === "oracle" ? output : 0)
  return measured === 0 ? 0 : Math.ceil(measured / scale)
}

export function paperPlan(key: string) {
  return PAPER_PLANS.find(plan => plan.key === key) ?? PAPER_PLANS[0]
}
