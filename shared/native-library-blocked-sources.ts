export type NativeSourceBlockReason = "noncommercial-license" | "redistribution-prohibited" | "unclear-provenance"

export interface NativeBlockedSourceCandidate {
  instrumentId: string
  sourceName: string
  sourceUrl: string
  license: string
  reason: NativeSourceBlockReason
  note: string
}

/**
 * High-quality candidates that Tloque deliberately does NOT install. Keeping
 * these explicit prevents future work from accidentally treating an available
 * download as a redistributable Master source.
 */
export const NATIVE_BLOCKED_SOURCE_CANDIDATES: readonly NativeBlockedSourceCandidate[] = [
  {
    instrumentId: "woodwinds.english-horn",
    sourceName: "TU Berlin / RWTH Aachen · Anechoic Musical Instruments Database",
    sourceUrl: "https://doi.org/10.14279/depositonce-19858",
    license: "CC BY-NC 4.0",
    reason: "noncommercial-license",
    note: "Modern English horn has dense anechoic single-note recordings, but the published database license is non-commercial and therefore unsuitable for Tloque distribution.",
  },
  {
    instrumentId: "woodwinds.contrabassoon",
    sourceName: "TU Berlin / RWTH Aachen · Anechoic Musical Instruments Database",
    sourceUrl: "https://doi.org/10.14279/depositonce-19858",
    license: "CC BY-NC 4.0",
    reason: "noncommercial-license",
    note: "Modern contrabassoon has dense anechoic single-note recordings, but the published database license is non-commercial and therefore unsuitable for Tloque distribution.",
  },
  {
    instrumentId: "woodwinds.english-horn",
    sourceName: "Philharmonia Orchestra Sound Samples",
    sourceUrl: "https://philharmonia.co.uk/resources/sound-samples/",
    license: "Philharmonia sample terms",
    reason: "redistribution-prohibited",
    note: "The samples may be used in productions but may not be redistributed as a sample library or sampler instrument.",
  },
  {
    instrumentId: "woodwinds.contrabassoon",
    sourceName: "Philharmonia Orchestra Sound Samples",
    sourceUrl: "https://philharmonia.co.uk/resources/sound-samples/",
    license: "Philharmonia sample terms",
    reason: "redistribution-prohibited",
    note: "The samples may be used in productions but may not be redistributed as a sample library or sampler instrument.",
  },
  {
    instrumentId: "woodwinds.english-horn",
    sourceName: "Eddie's English Horn",
    sourceUrl: "https://www.polyphone.io/en/soundfonts/reeds/211-english-horn-eddie-s",
    license: "reported public domain",
    reason: "unclear-provenance",
    note: "Multiple archives label the soundfont public domain, but the author and original chain of title are unknown; it is not acceptable as a Tloque Master source without stronger provenance.",
  },
  {
    instrumentId: "woodwinds.english-horn",
    sourceName: "Sonatina Symphonic Orchestra",
    sourceUrl: "https://github.com/peastman/sso",
    license: "CC Sampling Plus 1.0 / mixed sources",
    reason: "unclear-provenance",
    note: "SSO itself warns that some legacy source soundfonts have uncertain authorship or licensing. Tloque therefore keeps it out of the Master library.",
  },
  {
    instrumentId: "woodwinds.contrabassoon",
    sourceName: "Sonatina Symphonic Orchestra",
    sourceUrl: "https://github.com/peastman/sso",
    license: "CC Sampling Plus 1.0 / mixed sources",
    reason: "unclear-provenance",
    note: "SSO provides a usable contrabassoon but cannot establish exact provenance for every legacy source, so it is excluded from the Master library.",
  },
]

export function blockedSourcesForInstrument(instrumentId: string): readonly NativeBlockedSourceCandidate[] {
  return NATIVE_BLOCKED_SOURCE_CANDIDATES.filter(candidate => candidate.instrumentId === instrumentId)
}
