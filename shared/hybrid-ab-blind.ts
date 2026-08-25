export type HybridAbActualSide = "sampled" | "hybrid"
export type HybridAbBlindSide = "A" | "B"
export type HybridAbBlindVote = HybridAbBlindSide | "tie"

export interface HybridAbBlindAssignment {
  A: HybridAbActualSide
  B: HybridAbActualSide
}

export function hybridBlindAssignment(swapped: boolean): HybridAbBlindAssignment {
  return swapped ? { A: "hybrid", B: "sampled" } : { A: "sampled", B: "hybrid" }
}

export function hybridPreferenceForBlindVote(
  assignment: HybridAbBlindAssignment,
  vote: HybridAbBlindVote,
): HybridAbActualSide | "tie" {
  return vote === "tie" ? "tie" : assignment[vote]
}

export function hybridBlindSideForActual(
  assignment: HybridAbBlindAssignment,
  actual: HybridAbActualSide,
): HybridAbBlindSide {
  return assignment.A === actual ? "A" : "B"
}
