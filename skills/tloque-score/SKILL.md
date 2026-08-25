---
name: tloque-score
version: 2.5
summary: Write deterministic instrumental TloqueScore source for Tloque's native multi-instrument music engine.
---

# TloqueScore

Use `TLOQUE_SCORE 2` for deterministic instrumental music. The language is data, not JavaScript, and must not contain lyrics, speech, arbitrary code or executable expressions.

## Core contract

Declare global tempo/meter/seed/quality/module, then tracks, then one or more sections. Select a track with `use`, write pitched events as `bar:beat NOTE duration`, controls with `control`, rests with `rest`, and close each section with `end`.

`bars=` is the declared length of that section. Every note, rest, hit and control must use a local bar number between `1` and the section's declared `bars`. Long-form sections are supported up to 128 bars and the complete compiled score up to 256 bars. `repeat=` repeats the declared section after compilation. Never invent another section terminator: the only terminator is exactly `end`.

Velocity is normalized `0.01..1`. Supported articulations are `normal`, `legato`, `staccato`, `tenuto`, `accent`, `spiccato`, `pizzicato`, `tremolo`, and `harmonic`. Articulation describes the played gesture; it must not disguise a different physical colour.

Fractional positions are legal throughout the final beat. In 4/4, `4:4.25`, `4:4.5` and `4:4.75` are inside the bar while `4:5` is not.

## Native orchestration

Use `module native-auto` when one score contains several verified native instruments. Do not bind individual tracks to storage package IDs. Track identity remains semantic.

Current premium semantic identities include:

```text
strings.violin
strings.violin-section
strings.viola
strings.cello
strings.contrabass
woodwinds.flute
woodwinds.oboe
woodwinds.clarinet
woodwinds.bassoon
woodwinds.ocarina
woodwinds.alto-recorder
brass.trumpet
brass.trombone
brass.horn
brass.tuba
guitar.electric-clean
percussion.timpani
percussion.orchestral-kit
piano.grand
keys.pipe-organ
keys.pipe-organ-soft
keys.pipe-organ-pedal
keys.harpsichord
```

`native-auto` resolves every `instrument=` to its preferred verified native module. If a semantic instrument has no native package, premium rendering must fail honestly instead of substituting an unrelated instrument.

### Colour winds

`woodwinds.ocarina` uses the CC0 VCSL Estuary ocarina. The curated package currently exposes physical natural sustain and physical staccato only. Although the source collection also has vibrato files, do not claim an author-facing recorded vibrato colour until the manifest explicitly routes it.

`woodwinds.alto-recorder` uses the VCSL Estuary alto recorder and currently exposes physical sustain and staccato. Write both as monophonic breath instruments: use plausible phrase lengths and rests, avoid impossible chords on one track, and avoid huge chromatic ranges that depend on excessive pitch shifting.

### Cinematic pipe organ

Tloque exposes three independent physical pipe-organ layers instead of pretending one preset is a complete organ console:

```text
keys.pipe-organ       -> VCSL Rode Man3 Open manual
keys.pipe-organ-soft  -> VCSL NT5 Man3 Quiet manual
keys.pipe-organ-pedal -> VCSL Rode Pedal low register
```

For monumental or cosmic original music, layer the quiet manual first, add the open manual for the principal harmony or ostinato, and use the pedal track for long low fundamentals. Build large crescendos through orchestration and `expression`; do not invent swell-pedal behavior, arbitrary stops, couplers, or registration changes that have not been physically modeled. This supports cinematic organ writing while remaining honest that it is not yet a full virtual pipe-organ console.

## Recorded timbre

`timbre=` is an independent physical-colour axis. It can be declared on a track and overridden on individual note events. Supported values are `natural`, `non-vibrato`, `vibrato`, `expression-vibrato`, `mute`, `harmon-mute`, and `straight-mute`.

A native module may use a timbre only when that exact colour exists in its verified recordings. An explicitly requested unavailable timbre must fail honestly instead of being synthesized with EQ, filtering or an unrelated sample. Numeric `vibrato=0..1` remains an expressive performance control and is not the same as `timbre=vibrato`.

## Legato, releases and microphones

`articulation=legato` is semantic. If the selected native manifest declares true legato and contains the requested physical transition, Tloque uses it. Do not claim true legato for a library that lacks recorded transitions.

Release samples are automatic when a manifest declares them. Authors do not write a fake `release` articulation. The live engine and WAV exporter must consume the same resolved attack/transition/release plan.

Mic positions exist in the native sample-pack contract but are not currently an author-facing TloqueScore command. Do not invent `mic=` syntax inside scores.

## Physical performance controls · compiler 2.2

The source header remains `TLOQUE_SCORE 2`. New compilations support dedicated physical axes on ordinary `control` lines. Each dedicated value is normalized `0..1` and persists until another value for the same axis replaces it.

```tloque-score
control 1:1 pressure=0.72 bow=0.28 coupling=0.45 ramp=0.5
control 2:1 embouchure=0.62 pressure=0.58 ramp=0.25
control 3:1 pedal=down damper=0.08 coupling=0.86
control 4:1 pluck=0.34 damper=0.55 coupling=0.42
```

Use the axes according to the physical family:

- Bowed strings: `pressure`, `bow`, and optionally `coupling`.
- Woodwinds and brass: `pressure` and `embouchure`.
- Piano and celesta: `pedal=down|up`, `damper`, and `coupling`.
- Harp and guitars: `pluck`, `damper`, and `coupling`.

Do not use an unsupported physical axis merely because the compiler accepts the numeric field. Do not use physical controls to fake a recorded articulation or timbre that already has a real sample route. `pressure` is not a volume fader, `bow` is not a brightness EQ, `embouchure` is not generic tone, and `coupling` is not a loudness boost.

Compatibility is deliberate. When a dedicated axis is absent, Tloque retains the 2.1 bridge: `expression` supplies pressure, `brightness` supplies bow/pluck position or embouchure depending on family, and `pedal` supplies default damper/coupling behaviour. An explicit axis overrides only itself; for example, a later `brightness=` change must not silently replace an explicit `pressure=` or `bow=` value.

Use `ramp=` for physically plausible continuous gestures rather than abrupt jumps. Prefer sparse controls at musically meaningful points; do not write a new physical control on every note unless the performance genuinely changes there.

Dedicated physical controls do not bypass acoustic validation. `quality master` may use a hybrid physical layer only when the exact engine version has approved evidence; otherwise Tloque preserves the verified sample base.

## Percusión orquestal

For unpitched orchestral percussion use semantic `hit` events on `instrument=percussion.orchestral-kit`, never fake musical pitches. Examples include `bass-drum`, `snare-hit`, `snare-roll`, `crash-cymbal`, `suspended-cymbal`, `tambourine-hit`, `cowbell`, triangle variants, and `sleigh-bells`. One-shot samples must be allowed to finish their physical tails.

## Quality rules for AI composers

Prefer `quality master` for a standalone music render and `studio` for routine editing. Keep a stable seed. Use velocity, expression, register, articulation and rests to shape phrases rather than trying to repair everything with gain. Fast repeated string figures should use physically available staccato/spiccato routes so round-robin can work.

For Baroque string writing, separate solo and section roles, keep continuo rhythmically clear, and prefer `keys.harpsichord` to substituting a grand piano when its pack is installed.

For ocarina and recorder, favor exposed colour melodies and breath-shaped phrases. For cinematic organ, long sustained notes and repeating figures are strengths: keep `keys.pipe-organ-pedal` below the orchestra, layer `keys.pipe-organ-soft` before the open manual, and let strings and brass widen the spectrum instead of simply maximizing organ gain.

Before returning any generated score, perform a structural self-check: every section has exactly one `end`; every event bar is within that section's `bars`; every beat is valid for the meter; every `use` references a declared track; every physical axis belongs to that instrument family; and no invented commands remain.

## Complete native-auto example

```tloque-score
TLOQUE_SCORE 2
title "Baroque native-auto study"
tempo 126
meter 4/4
loop false
seed 20260823
humanize 0.055
quality master
module native-auto
track solo synth=pad instrument=strings.violin program=40 role=melody gain=0.28 pan=0.10 attack=0.01 release=1.0 expression=0.88 brightness=0.58 vibrato=0.08 timbre=natural
track viola synth=pad instrument=strings.viola program=41 role=harmony gain=0.20 pan=-0.18 attack=0.01 release=1.0 expression=0.78 brightness=0.50 vibrato=0.04 timbre=natural
track cello synth=bass instrument=strings.cello program=42 role=bass gain=0.22 pan=0.18 attack=0.01 release=1.0 expression=0.80 brightness=0.42 vibrato=0.03 timbre=natural
track continuo synth=pluck instrument=keys.harpsichord program=6 role=harmony gain=0.18 pan=-0.04 attack=0.003 release=0.5 expression=0.72 brightness=0.62 vibrato=0 timbre=natural
section opening form=exposition bars=2 repeat=1 fade=0 tempo=126 rubato=0.025
use continuo
1:1 A2,E3,A3 1 velocity=0.42
1:2 E3,A3,C4 1 velocity=0.38
1:3 A2,E3,A3 1 velocity=0.42
1:4 E3,G#3,B3 1 velocity=0.40
2:1 A2,E3,A3 2 velocity=0.44
2:3 E3,G#3,B3 2 velocity=0.40
use cello
1:1 A2 1 velocity=0.48 articulation=staccato
1:3 E3 1 velocity=0.50 articulation=staccato
2:1 A2 2 velocity=0.48
use viola
1:1 A3 0.5 velocity=0.52 articulation=spiccato
1:1.5 B3 0.5 velocity=0.54 articulation=spiccato
1:2 C4 0.5 velocity=0.56 articulation=spiccato
1:2.5 B3 0.5 velocity=0.52 articulation=spiccato
use solo
control 1:1 expression=0.72 vibrato=0.04 brightness=0.54 pressure=0.68 bow=0.40 coupling=0.36 ramp=0.5
1:1 E5 0.5 velocity=0.66 articulation=spiccato
1:1.5 F5 0.5 velocity=0.70 articulation=spiccato
1:2 G#5 0.5 velocity=0.74 articulation=spiccato
1:2.5 A5 0.5 velocity=0.78 articulation=accent
1:3 G#5 1 velocity=0.68 articulation=staccato
control 2:1 pressure=0.54 bow=0.58 coupling=0.44 ramp=0.5
2:1 E5 2 velocity=0.62 articulation=normal
end
```

Keep scores instrumental, deterministic, bounded, faithful to the physical capabilities of installed modules, and portable across future native libraries through semantic `instrument=` identities.
