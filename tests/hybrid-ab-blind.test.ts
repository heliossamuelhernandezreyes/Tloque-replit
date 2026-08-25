import { describe, expect, it } from "vitest"
import { hybridBlindAssignment, hybridBlindSideForActual, hybridPreferenceForBlindVote } from "../shared/hybrid-ab-blind"

describe("hybrid blind A/B mapping", () => {
  it("maps both possible assignments without exposing semantics in the blind side", () => {
    expect(hybridBlindAssignment(false)).toEqual({ A: "sampled", B: "hybrid" })
    expect(hybridBlindAssignment(true)).toEqual({ A: "hybrid", B: "sampled" })
  })

  it("resolves a blind vote to the actual source only after the vote", () => {
    const assignment = hybridBlindAssignment(true)
    expect(hybridPreferenceForBlindVote(assignment, "A")).toBe("hybrid")
    expect(hybridPreferenceForBlindVote(assignment, "B")).toBe("sampled")
    expect(hybridPreferenceForBlindVote(assignment, "tie")).toBe("tie")
  })

  it("can reveal the winning blind side after review", () => {
    const assignment = hybridBlindAssignment(false)
    expect(hybridBlindSideForActual(assignment, "hybrid")).toBe("B")
    expect(hybridBlindSideForActual(assignment, "sampled")).toBe("A")
  })
})
