---
name: tloque-score
version: 2.1
summary: Write deterministic instrumental TloqueScore source for Tloque's native music engine.
---

# TloqueScore

Use `TLOQUE_SCORE 2` for deterministic instrumental music. The language is data, not JavaScript, and must not contain lyrics, speech, arbitrary code or executable expressions.

## Core contract

Declare global tempo/meter/seed/quality/module, then tracks, then one or more sections. Select a track with `use`, write pitched events as `bar:beat NOTE duration`, controls with `control`, rests with `rest`, and close each section with `end`.

A score may reference a verified native module with `module <id>`. Instrument identity belongs in each track through `instrument=<semantic-id>` and its zero-based GM-compatible `program` where applicable.

Velocity is normalized `0.01..1`. Supported articulations are `normal`, `legato`, `staccato`, `tenuto`, `accent`, `spiccato`, `pizzicato`, `tremolo`, and `harmonic`. A renderer must fall back honestly when the selected sample library does not contain a requested technique.

## Percusión orquestal

For unpitched orchestral percussion, do not encode the instrument name as a fake musical pitch. Use the native orchestral percussion module and a semantic `hit` command:

```text
module vsco2-ce-orchestral-percussion
track perc synth=pluck instrument=percussion.orchestral-kit program=0 role=accent gain=0.45 pan=0 attack=0.001 release=2 expression=1 brightness=0.5 vibrato=0
section hits form=custom bars=1 repeat=1 fade=0 tempo=80 rubato=0
use perc
hit 1:1 bass-drum 0.5 velocity=0.8
hit 1:2 snare-hit 0.25 velocity=0.6
hit 1:3 crash-cymbal 1 velocity=0.7
end
```

Initial semantic hit names include `bass-drum`, `snare-taps`, `snare-hit`, `snare-roll`, `snare-hit-alt`, `snare-roll-alt`, `crash-cymbal`, `suspended-cymbal`, `suspended-cymbal-stick`, `tambourine-shake`, `tambourine-hit`, `tambourine-roll`, `cowbell`, `triangle-muted-small`, `triangle-open-small`, `triangle-muted-large`, `triangle-open-large`, and `sleigh-bells`.

`hit` is valid only on `instrument=percussion.orchestral-kit`; unknown names must fail compilation. MIDI keys used by the underlying SFZ are internal sample selectors and are not part of the author-facing semantics.

## Example

```tloque-score
TLOQUE_SCORE 2
title "Tloque example"
tempo 72
meter 4/4
loop false
seed 20260823
humanize 0.08
quality studio
module builtin
track piano synth=warm instrument=piano.grand program=0 role=harmony gain=0.32 pan=-0.08 attack=0.04 release=1.6 expression=0.9 brightness=0.55 vibrato=0
track violin synth=pad instrument=strings.violin program=40 role=melody gain=0.24 pan=0.12 attack=0.14 release=1.5 expression=0.76 brightness=0.62 vibrato=0.12
section opening form=exposition bars=2 repeat=1 fade=1 tempo=72 rubato=0.05
use piano
1:1 C3,E3,G3 4 velocity=0.46
2:1 F3,A3,C4 4 velocity=0.44
use violin
control 1:1 expression=0.58 brightness=0.48 vibrato=0.08 ramp=0
1:1 E4 2 velocity=0.42 articulation=legato
2:1 A4 2 velocity=0.46 articulation=tenuto
end
```

Keep scores instrumental, deterministic, bounded, and faithful to the capabilities of the selected module.
