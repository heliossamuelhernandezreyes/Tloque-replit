# Hybrid A/B register × gesture matrix v1

Master evidence for a hybrid overlay must cover the instrument as a performance surface, not only as a pitch range.

## Matrix

Every blind A/B run contains nine cells:

| Register | soft | neutral | strong |
| --- | --- | --- | --- |
| low | required | required | required |
| mid | required | required | required |
| high | required | required | required |

Representative pitches are selected at approximately 22%, 50% and 78% of the declared hybrid MIDI range. Each cell is an 8-second deterministic probe. The complete A/B pair is therefore roughly 72 seconds long.

## Family gestures

The three gesture IDs are stable (`soft`, `neutral`, `strong`), but their acoustic meaning is family-specific:

- Bowed strings: `soft / tasto`, `neutral / ordinario`, `strong / ponticello`.
- Air-column woodwinds/brass: `soft / relaxed`, `neutral / centered`, `strong / focused`.
- Piano/celesta sympathetic resonance: `soft / dry`, `neutral / balanced`, `strong / resonant`, varying pedal, damper and coupling.
- Harp/acoustic guitar sympathetic resonance: `soft / dry`, `neutral / balanced`, `strong / resonant`, varying pluck position, damper and coupling.

Each cell still contains a soft/loud pair, a sustained note and a legato transition so the existing five regression metrics remain comparable across gestures.

## Master policy

A report can qualify as Master evidence only when:

1. exactly one result exists for every register × gesture combination (9/9 cells),
2. every metric in every cell passes,
3. every register summary passes,
4. global metrics are the worst observed cell values, never averages,
5. the engine version matches exactly,
6. the human review was a blind A/B,
7. the reviewer preferred the hybrid rendering.

Missing, duplicate, legacy register-only or labeled-A/B evidence is invalid by design. Legacy reports must fail closed rather than throw.

## Resource budget

The 8-second cell length keeps the full matrix materially lighter than nine historical 10-second probes while still providing attack, dynamic, sustain, legato and tail windows. This is intentional for mobile Admin use.
