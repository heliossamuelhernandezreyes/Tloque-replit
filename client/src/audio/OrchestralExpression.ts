import { orchestralIdentityUnit, orchestralTimbreFor } from "@shared/orchestral-synthesis"

export interface OrchestralNoteExpression {
  swell: number
  vibratoCents: number
  vibratoHz: number
  vibratoDelay: number
  identity: string
}

/** Recording vibrato is never doubled. Plucked/percussive attacks stay untouched.
 * Small intra-note arcs are an original musical heuristic, not physical calibration. */
export function orchestralNoteExpression(instrument: string, articulation: string, duration: number, vibrato: number, recordedVibrato: boolean, identity: string): OrchestralNoteExpression {
  const profile = orchestralTimbreFor(instrument)
  const sustained = profile.decay === 0 && duration >= 0.35 && !["staccato", "spiccato", "pizzicato"].includes(articulation)
  return {
    swell: sustained ? Math.min(0.12, duration * 0.025) : 0,
    vibratoCents: sustained && !recordedVibrato ? profile.vibratoCents * Math.max(0, Math.min(1, vibrato)) : 0,
    vibratoHz: profile.vibratoHz + (orchestralIdentityUnit(identity) - 0.5) * 0.5,
    vibratoDelay: Math.min(0.42, duration * 0.22),
    identity,
  }
}

export function orchestralExpressionCurve(expression: OrchestralNoteExpression, duration: number, kind: "gain" | "detune") {
  // 64 Hz control curve, bounded even for the longest legal score note.
  const count = Math.max(2, Math.min(8192, Math.ceil(duration * 64) + 1))
  const curve = new Float32Array(count)
  const phase = orchestralIdentityUnit(expression.identity) * Math.PI * 2
  for (let i = 0; i < count; i++) {
    const x = i / (count - 1), time = x * duration
    if (kind === "gain") curve[i] = 1 - expression.swell + expression.swell * Math.sin(Math.PI * x)
    else {
      const bloom = Math.max(0, Math.min(1, (time - expression.vibratoDelay) / 0.25))
      curve[i] = bloom > 0 ? expression.vibratoCents * bloom * (0.86 * Math.sin(2 * Math.PI * expression.vibratoHz * time + phase) + 0.14 * Math.sin(2 * Math.PI * expression.vibratoHz * 0.73 * time)) : 0
    }
  }
  return curve
}
