# Native instrument capability audit — 2026-08-24

This audit records only capabilities explicitly declared by Tloque's current native manifests. It is not permission to synthesize capabilities that the physical sample packs do not contain.

## Main finding

The current acoustic orchestra is already strongest in velocity-layer and alternate-attack realism, but **none of the currently exposed acoustic instruments declares physical true legato**. The registry contains one CC0 reference manifest (`sfzinstruments-legato-vocal-a`) that proves the transition pipeline, but it is not part of the instrumental orchestra. Therefore Performance Director v1 must shape phrasing without pretending that sampled note-to-note transitions exist.

## Strings

- `strings.violin` — VSCO 2 CE Solo Violin: normal, tremolo, spiccato, pizzicato; 2 velocity layers; 2 RR on spiccato/pizzicato; no true legato; no declared release samples.
- `strings.violin-section` — VSCO 2 CE Violin Section: normal, tremolo, spiccato, pizzicato; 2 velocity layers; 2 RR on spiccato/pizzicato; no true legato.
- `strings.viola` — VSCO 2 CE Viola Section: normal, tremolo, spiccato, pizzicato; 2 velocity layers; 2 RR on spiccato/pizzicato; no true legato.
- `strings.cello` — VSCO 2 CE Cello Section: normal, tremolo, spiccato, pizzicato; 2 velocity layers; 2 RR on spiccato/pizzicato; no true legato.
- `strings.contrabass` — VSCO 2 CE Solo Contrabass: normal, tremolo, spiccato, pizzicato; 2 velocity layers; 2 RR on spiccato/pizzicato; no true legato.

Priority: improve phrase continuity, bow-direction asymmetry and dynamic shaping now; add a verified transition library later rather than faking legato.

## Woodwinds

- `woodwinds.flute` — sustain + staccato, 2 RR on staccato.
- `woodwinds.clarinet` — 3 velocity layers on sustain/staccato, 2 RR on staccato.
- `woodwinds.oboe` — 2 sustain layers, 3 staccato layers, 2 RR on staccato.
- `woodwinds.bassoon` — 2 sustain/staccato layers, 2 RR on staccato.
- `woodwinds.ocarina` — physical sustain + staccato.
- `woodwinds.alto-recorder` — physical sustain + staccato.

Priority: phrase starts/ends and breath-aware separation. Do not advertise true legato or continuous breath modeling yet.

## Brass

- `brass.trumpet` — 2 sustain layers; staccato has 3 velocity layers and 2 RR.
- `brass.trombone` — 4 sustain/staccato velocity layers; 2 RR on staccato.
- `brass.horn` — 4 sustain layers; staccato has 3 layers and 2 RR.
- `brass.tuba` — 3 sustain layers; staccato has 2 layers and 4 RR.

Recorded colour routing such as trumpet vibrato/mutes and horn mute is handled separately by recorded timbre manifests. No brass true legato is currently declared.

Priority: breath-aware phrase endings, destination emphasis and dynamic-layer selection before searching for more instruments.

## Guitar / keys

- `guitar.electric-clean` — Karoryfer Emilyguitar: 4 velocity layers, 3 RR, physical release samples; normal + accent.
- `piano.grand` — VCSL Grand Piano: 3 velocity layers and mic-position capability.
- `keys.harpsichord` — VCSL Italian Harpsichord Stop 1: physical release samples.
- `keys.pipe-organ`, `keys.pipe-organ-soft`, `keys.pipe-organ-pedal` — physical independent organ colours; no extra articulation capability declared.

Priority: preserve guitar/piano attack variation; keep organ timing comparatively stable and build apparent growth through orchestration rather than invented stop automation.

## Percussion

VSCO 2 CE percussion manifests already expose dedicated physical routes per instrument where verified. Percussion should remain tighter in timing than melodic families; repeated hits can still benefit from RR and small velocity variation.

## True-legato status

Current author-facing acoustic instruments with `true-legato`: **0**.

Reference/test capability only:

- `voice.legato-a` / `sfzinstruments-legato-vocal-a` declares physically recorded note-to-note transitions and proves Tloque's transition-selection path.

This distinction is intentional. `articulation=legato` remains a musical instruction, but Tloque only renders a separate physical transition sample when the selected manifest explicitly declares `trueLegato: true` and the requested transition exists.

## Universal Performance Director v2 contract

`tloque-universal-performance-director-v2` may:

- segment complete per-track phrases from sections, authored rests, temporal gaps and bounded musical spans;
- locate a deterministic phrase climax and shape rise/release by track role;
- interpret primary, secondary and light metric positions in simple and compound meters;
- shape performed velocity conservatively;
- make tiny contextual duration changes;
- add tiny family-appropriate attack offsets;
- emphasize melodic leaps, peaks and valleys modestly;
- soften exact repeated notes slightly;
- carry connected string lines and leave family-appropriate wind/brass releases;
- preserve organ stability;
- combine with deterministic family humanization.

It may **not**:

- change pitch or authored rhythmic position;
- replace an authored articulation;
- fabricate bow samples, breaths, mutes, stops or legato transitions;
- claim a synthesis approximation as a physical capability.

All render paths consume the same `performedEventValues` decision. `humanize=0` remains bit-neutral at the interpretation layer for backward compatibility.

This audit should be updated whenever a native manifest gains a verified physical capability.
