---
name: tloque-score
version: 2.2
summary: Write deterministic instrumental TloqueScore source for Tloque's native multi-instrument music engine.
---

# TloqueScore

Use `TLOQUE_SCORE 2` for deterministic instrumental music. The language is data, not JavaScript, and must not contain lyrics, speech, arbitrary code or executable expressions.

## Core contract

Declare global tempo/meter/seed/quality/module, then tracks, then one or more sections. Select a track with `use`, write pitched events as `bar:beat NOTE duration`, controls with `control`, rests with `rest`, and close each section with `end`.

Velocity is normalized `0.01..1`. Supported articulations are `normal`, `legato`, `staccato`, `tenuto`, `accent`, `spiccato`, `pizzicato`, `tremolo`, and `harmonic`. Articulation describes the played gesture; it must not be used to disguise a different physical colour of the instrument.

## Native orchestration

Use `module native-auto` when one score contains several verified native instruments. Do not bind individual tracks to storage package IDs. Track identity remains semantic:

```text
module native-auto
track solo synth=pad instrument=strings.violin program=40 role=melody gain=0.28 pan=0.10 attack=0.01 release=1.2 expression=0.85 brightness=0.55 vibrato=0.08 timbre=natural
track viola synth=pad instrument=strings.viola program=41 role=harmony gain=0.22 pan=-0.18 attack=0.01 release=1.2 expression=0.78 brightness=0.48 vibrato=0.04 timbre=natural
track cello synth=bass instrument=strings.cello program=42 role=bass gain=0.24 pan=0.18 attack=0.01 release=1.2 expression=0.80 brightness=0.42 vibrato=0.03 timbre=natural
track continuo synth=pluck instrument=keys.harpsichord program=6 role=harmony gain=0.20 pan=-0.05 attack=0.003 release=0.5 expression=0.72 brightness=0.62 vibrato=0 timbre=natural
```

`native-auto` resolves each `instrument=` to the preferred installed and verified native module. If a semantic instrument has no native package, compilation/playback must fail honestly instead of silently substituting an unrelated instrument. Use a concrete `module <id>` only for a deliberately single-library score or compatibility case.

Current native semantic instruments include orchestral strings, selected woodwinds/brass/percussion, `piano.grand`, `keys.pipe-organ`, and `keys.harpsichord` when their packs are installed. The Italian harpsichord contains physical attack and release recordings; release selection is automatic and is not written as a fake articulation.

## Recorded timbre

`timbre=` is an independent physical-colour axis. It can be declared on a track and overridden on individual note events. Supported values are `natural`, `non-vibrato`, `vibrato`, `expression-vibrato`, `mute`, `harmon-mute`, and `straight-mute`.

A native module may use a timbre only when that exact colour exists in its verified recordings. An explicitly requested unavailable timbre must fail honestly instead of being synthesized with EQ, filtering or an unrelated sample. `natural` means the historically/default recorded colour of that module, not universally non-vibrato.

```text
module vsco2-ce-trumpet
track trumpet synth=pad instrument=brass.trumpet program=56 role=melody gain=0.30 pan=0 attack=0.01 release=1 expression=1 brightness=0.5 vibrato=0 timbre=natural
section colour form=custom bars=1 repeat=1 fade=0 tempo=72 rubato=0
use trumpet
1:1 C4 1 velocity=0.50 timbre=natural
1:2 D4 1 velocity=0.50 timbre=vibrato
1:3 E4 1 velocity=0.50 timbre=straight-mute
1:4 F4 1 velocity=0.50 timbre=harmon-mute
end
```

The numeric `vibrato=0..1` track/control parameter remains an expressive performance control. It is not a substitute for `timbre=vibrato`, which requests a distinct recorded sample colour.

## Legato, releases and microphones

`articulation=legato` is semantic. If the selected native manifest declares true legato and contains the requested physical transition, Tloque uses it. Otherwise a module uses only the legato behaviour it actually supports; do not claim true legato for a library that lacks recorded transitions.

Release samples are automatic when a manifest declares them. Authors do not write a fake `release` articulation. The live engine and WAV exporter must consume the same resolved attack/transition/release plan.

Mic positions exist in the native sample-pack contract but are not currently an author-facing TloqueScore command. Do not invent `mic=` syntax inside scores.

## Percusión orquestal

For unpitched orchestral percussion, do not encode the instrument name as a fake musical pitch. Use the native orchestral percussion module and a semantic `hit` command:

```text
module vsco2-ce-orchestral-percussion
track perc synth=pluck instrument=percussion.orchestral-kit program=0 role=accent gain=0.45 pan=0 attack=0.001 release=2 expression=1 brightness=0.5 vibrato=0 timbre=natural
section hits form=custom bars=1 repeat=1 fade=0 tempo=80 rubato=0
use perc
hit 1:1 bass-drum 0.5 velocity=0.8
hit 1:2 snare-hit 0.25 velocity=0.6
hit 1:3 crash-cymbal 1 velocity=0.7
end
```

Initial semantic hit names include `bass-drum`, `snare-taps`, `snare-hit`, `snare-roll`, `snare-hit-alt`, `snare-roll-alt`, `crash-cymbal`, `suspended-cymbal`, `suspended-cymbal-stick`, `tambourine-shake`, `tambourine-hit`, `tambourine-roll`, `cowbell`, `triangle-muted-small`, `triangle-open-small`, `triangle-muted-large`, `triangle-open-large`, and `sleigh-bells`.

`hit` is valid only on `instrument=percussion.orchestral-kit`; unknown names must fail compilation. MIDI keys used by the underlying SFZ are internal sample selectors and are not part of the author-facing semantics. One-shot samples must be allowed to finish their physical tails.

## Quality rules for AI composers

Prefer `quality=master` for a standalone music render and `studio` for routine editing. Keep a stable seed. Use velocity, expression, register, articulation and rests to shape phrases rather than trying to repair everything with gain. Fast repeated string figures should use the physically available staccato/spiccato routes so round-robin can work. Sustained lines should avoid unsupported timbres or true-legato claims.

For Baroque string writing, separate solo and section roles, keep continuo rhythmically clear, avoid modern cinematic over-reverb, and let the harpsichord support harmony rather than dominate the foreground. `keys.harpsichord` is preferred over substituting a grand piano when its CC0 pack is installed.

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
control 1:1 expression=0.72 vibrato=0.04 brightness=0.54 ramp=0
1:1 E5 0.5 velocity=0.66 articulation=spiccato
1:1.5 F5 0.5 velocity=0.70 articulation=spiccato
1:2 G#5 0.5 velocity=0.74 articulation=spiccato
1:2.5 A5 0.5 velocity=0.78 articulation=accent
1:3 G#5 1 velocity=0.68 articulation=staccato
2:1 E5 2 velocity=0.62 articulation=normal
end
```

Keep scores instrumental, deterministic, bounded, faithful to the physical capabilities of installed modules, and portable across future native libraries through semantic `instrument=` identities.
