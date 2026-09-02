/** Original, declarative timbre design. These are synthesis heuristics, not sampled
 * instruments or claims of physical/acoustic certification. No external assets. */
export const ORCHESTRAL_SYNTH_MODULE_ID = "orchestra-synth" as const
export const ORCHESTRAL_SYNTH_VERSION = "tloque-orchestral-synth-v2" as const
export const ORCHESTRAL_SYNTH_MAX_SOURCES = 192

export interface OrchestralTimbre {
  id: string
  rolloff: number
  evenHarmonics: number
  formantHz: number
  formantWidth: number
  attack: number
  release: number
  decay: number
  noise: number
  vibratoHz: number
  vibratoCents: number
  ensemble: number
  modalRatios?: readonly number[]
}

const bowed: OrchestralTimbre = { id: "bowed", rolloff: 1.24, evenHarmonics: 0.9, formantHz: 2400, formantWidth: 1700, attack: 0.09, release: 0.26, decay: 0, noise: 0.018, vibratoHz: 5.2, vibratoCents: 19, ensemble: 1 }
const flute: OrchestralTimbre = { ...bowed, id: "flute", rolloff: 2.5, evenHarmonics: 0.72, formantHz: 1400, attack: 0.06, release: 0.15, noise: 0.025, vibratoHz: 4.9, vibratoCents: 12 }
const reed: OrchestralTimbre = { ...bowed, id: "reed", rolloff: 1.3, evenHarmonics: 0.65, formantHz: 1600, formantWidth: 950, attack: 0.045, release: 0.16, noise: 0.012, vibratoHz: 5.4, vibratoCents: 10 }
const brass: OrchestralTimbre = { ...bowed, id: "brass", rolloff: 1.3, evenHarmonics: 1, formantHz: 1700, formantWidth: 1200, attack: 0.065, release: 0.22, noise: 0.009, vibratoHz: 4.6, vibratoCents: 8 }
const plucked: OrchestralTimbre = { ...bowed, id: "plucked", rolloff: 1.6, evenHarmonics: 0.82, formantHz: 900, attack: 0.006, release: 0.6, decay: 1.4, noise: 0.015, vibratoCents: 0, modalRatios: [1, 2, 3.002, 4.008] }
const bell: OrchestralTimbre = { ...plucked, id: "bell", decay: 0.9, release: 1.3, noise: 0.003, modalRatios: [1, 2.76, 5.4, 8.93] }

export function orchestralTimbreFor(instrument: string, midi = 60): OrchestralTimbre {
  if (instrument === "strings.harp" || instrument.startsWith("guitar.")) return { ...plucked, id: instrument, decay: instrument === "strings.harp" ? 0.85 : 1.4 }
  if (instrument.startsWith("strings.")) return { ...bowed, id: instrument, ensemble: instrument.endsWith("-section") ? 3 : 1, formantHz: instrument === "strings.cello" || instrument === "strings.contrabass" ? 1100 : 2400 }
  if (/flute|piccolo|recorder|ocarina/.test(instrument)) return { ...flute, id: instrument }
  if (instrument.includes("clarinet")) return { ...reed, id: instrument, evenHarmonics: 0.12, rolloff: 1.4 }
  if (instrument.startsWith("woodwinds.")) return { ...reed, id: instrument, formantHz: /bassoon/.test(instrument) ? 700 : 1500 }
  if (instrument.startsWith("brass.")) return { ...brass, id: instrument, rolloff: /horn|tuba/.test(instrument) ? 1.85 : 1.15, formantHz: /tuba|trombone/.test(instrument) ? 850 : 1700 }
  if (instrument === "piano.grand") return { ...plucked, id: instrument, decay: 0.55 + Math.max(0, midi - 36) * 0.018, modalRatios: [1, 2.001, 3.004, 4.011, 5.022] }
  if (instrument.startsWith("keys.pipe-organ")) return { ...flute, id: instrument, attack: 0.025, release: 0.2, noise: 0, vibratoCents: 0, evenHarmonics: 1 }
  if (instrument === "keys.harpsichord") return { ...plucked, id: instrument, rolloff: 1.05, decay: 1.8 }
  if (instrument === "percussion.orchestral-kit") {
    if (midi === 36) return { ...plucked, id: "bass-drum", decay: 5, release: 0.3, noise: 0.12, modalRatios: [1, 1.53, 2.08] }
    if (midi >= 37 && midi <= 41) return { ...plucked, id: "snare", decay: 10, release: 0.13, noise: 0.72, modalRatios: [1, 1.47] }
    return { ...bell, id: "metal-percussion", noise: midi < 60 ? 0.42 : 0.025, decay: midi < 60 ? 1.8 : 0.9 }
  }
  if (/celesta|glockenspiel|vibraphone|tubular/.test(instrument)) return { ...bell, id: instrument }
  if (/marimba|xylophone/.test(instrument)) return { ...plucked, id: instrument, decay: 2.2, noise: 0.008, modalRatios: [1, 4, 10] }
  if (instrument === "percussion.timpani") return { ...plucked, id: instrument, decay: 1.7, noise: 0.03, modalRatios: [1, 1.5, 2, 2.5] }
  return { ...flute, id: "neutral" }
}

export function orchestralIdentityUnit(identity: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < identity.length; i++) hash = Math.imul(hash ^ identity.charCodeAt(i), 0x01000193)
  return (hash >>> 0) / 0xffffffff
}

/** Fourier amplitudes sum to <= 1; DC and harmonics near Nyquist are absent.
 * PeriodicWave adds the browser's band-limited playback on top of this bound. */
export function orchestralSpectrum(profile: OrchestralTimbre, frequency: number, brightness: number, sampleRate: number) {
  const coefficients = new Float32Array(33)
  let total = 0
  const colour = Math.max(0, Math.min(1, brightness))
  for (let harmonic = 1; harmonic < coefficients.length; harmonic++) {
    const hz = frequency * harmonic
    if (hz >= sampleRate * 0.45) break
    const parity = harmonic % 2 === 0 ? profile.evenHarmonics : 1
    const formant = 1 + 1.5 * Math.exp(-(((hz - profile.formantHz) / profile.formantWidth) ** 2))
    const amplitude = parity * formant / harmonic ** (profile.rolloff + (1 - colour) * 1.4)
    coefficients[harmonic] = amplitude
    total += amplitude
  }
  if (total > 0) for (let i = 1; i < coefficients.length; i++) coefficients[i] /= total
  return coefficients
}

/** No score rewriting: changing the rendering source preserves all authored notes. */
export function withOrchestralModule(source: string, moduleId: "builtin" | "native-auto" | typeof ORCHESTRAL_SYNTH_MODULE_ID) {
  if (!/^TLOQUE_SCORE\s+2\s*$/m.test(source)) return source
  if (/^module\s+\S+\s*$/m.test(source)) return source.replace(/^module\s+\S+\s*$/m, `module ${moduleId}`)
  return source.replace(/^(TLOQUE_SCORE\s+2)\s*$/m, `$1\nmodule ${moduleId}`)
}
