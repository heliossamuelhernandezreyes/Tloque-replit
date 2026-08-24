---
name: compose-tloque-score
description: Compose, revise, or repair instrumental TloqueScore 2 code for Tloque Audio Studio, including multi-instrument native orchestration.
---

# Compose TloqueScore 2

Create only instrumental music. The TloqueScore code is the master work: Tloque compiles it for live playback and can export it as WAV.

## Compatibility

- Audio contract: `tloque-audio-2026-08-v2`
- Compiler: `tloque-score-compiler-v2.1`
- Skill version: `1.2.0`
- Built-in module: `builtin`
- Native multi-instrument router: `native-auto`

Never invent commands or execute JavaScript. Never add lyrics, sung words, audio URLs, Markdown, or explanations inside a score.

## Required workflow

1. Determine purpose, approximate duration, mood, musical form, instruments and whether the piece loops. If omitted, choose conservative defaults.
2. Translate musical terms into supported musical constraints. `adagio` becomes tempo; an arpeggio is written as note events; a crescendo uses velocity/expression structure.
3. Plan form and bar count before writing notes. Keep recognizable motifs and vary contour, rhythm, harmony, register or orchestration.
4. Declare every track before the first section.
5. Use `module native-auto` for a work that should use several installed native acoustic instruments. Use `module builtin` only when portability without installed sample packs matters more than acoustic quality. A concrete native module ID is appropriate for a deliberately single-library score.
6. Never claim an articulation, timbre, true-legato transition, release layer or other physical feature that the selected library does not contain.
7. Validate the complete score against the grammar and limits below.
8. Return exactly one code block containing the complete score when the user asks for code to paste into Tloque.

## Grammar

The first line must be:

```text
TLOQUE_SCORE 2
```

Global commands:

```text
title "Title up to 160 characters"
tempo 32..180
meter 2..12/4 or 2..12/8
loop true|false
seed 0..2147483647
humanize 0..1
quality core|studio|master
module builtin|native-auto|installed-module-id
```

Track declarations come before all sections:

```text
track id synth=warm|pad|bell|pluck|bass instrument=instrument.id program=0..127 role=melody|harmony|bass|pulse|texture|accent gain=0..1 pan=-1..1 attack=0.001..8 release=0.01..12 expression=0..1 brightness=0..1 vibrato=0..1 timbre=natural|non-vibrato|vibrato|expression-vibrato|mute|harmon-mute|straight-mute
```

Sections and pitched events:

```text
section id form=exposition|development|recapitulation|coda|interlude|custom bars=1..128 repeat=1..4 fade=0..16 tempo=32..180 rubato=0..0.35
use track-id
control bar:beat expression=0..1 brightness=0..1 vibrato=0..1 pedal=down|up bend=-2..2 ramp=0..16
bar:beat C3,Eb3,G3 duration velocity=0.01..1 articulation=normal|legato|staccato|tenuto|accent|spiccato|pizzicato|tremolo|harmonic timbre=...
rest bar:beat duration
end
```

`timbre=` on an event is optional and overrides the track timbre for that event.

Unpitched orchestral percussion uses semantic hits, never fake pitch names:

```text
use perc
hit 1:1 bass-drum 0.5 velocity=0.8
hit 1:2 snare-hit 0.25 velocity=0.6
hit 1:3 crash-cymbal 1 velocity=0.7
```

`hit` is valid only on a track with `instrument=percussion.orchestral-kit`. Supported names include `bass-drum`, `snare-taps`, `snare-hit`, `snare-roll`, `snare-hit-alt`, `snare-roll-alt`, `crash-cymbal`, `suspended-cymbal`, `suspended-cymbal-stick`, `tambourine-shake`, `tambourine-hit`, `tambourine-roll`, `cowbell`, `triangle-muted-small`, `triangle-open-small`, `triangle-muted-large`, `triangle-open-large`, and `sleigh-bells`.

## Native acoustic routing

With `module native-auto`, each track is resolved from its semantic `instrument=` identity to the preferred verified native package. Do not write storage package IDs on individual tracks.

Useful semantic identities currently include:

```text
strings.violin
strings.viola
strings.cello
strings.contrabass
woodwinds.flute
woodwinds.oboe
woodwinds.clarinet
woodwinds.bassoon
brass.trumpet
brass.trombone
brass.horn
brass.tuba
percussion.timpani
percussion.orchestral-kit
piano.grand
keys.pipe-organ
keys.harpsichord
```

The renderer loads the required packs independently but sends them through one common mixer/master. Live and native WAV export must resolve the same physical zones.

If `native-auto` cannot find a verified native package for an instrument, the operation must fail instead of silently swapping in a different instrument.

## Physical capability rules

Articulation and recorded timbre are different axes. `articulation=spiccato` asks for the played gesture. `timbre=vibrato` asks for a separately recorded colour when the manifest actually contains one.

The numeric `vibrato=0..1` expressive control is not the same thing as `timbre=vibrato`.

`articulation=legato` is semantic. True legato is used only when a manifest declares recorded note-to-note transitions and the requested transition exists. Do not invent a `true-legato` command.

Release samples are automatic when a package declares them. Do not invent a `release` articulation. The CC0 Italian harpsichord, for example, contains physical sustain attacks plus key-off/release samples.

Mic positions exist internally in TloqueSamplePack but are not currently part of author-facing TloqueScore syntax. Do not write `mic=` in a score.

## Notes, time and expression

- Valid notes run from `C1` through `C8`. Use `#` or `b` accidentals.
- Simultaneous notes use commas and no spaces: `C3,E3,G3`.
- Duration is measured in quarter-note beats: `1` quarter, `0.5` eighth, `0.25` sixteenth, `4` whole note in 4/4.
- A section must end with `end`; select a track with `use` before events.
- `expression` shapes phrase loudness inside track gain; `brightness` shapes the supported spectral direction; `vibrato` is continuous expressive pitch modulation; `pedal` sustains notes where meaningful; `bend` is semitones.
- Use deterministic `humanize` conservatively. For exposed Baroque writing prefer roughly `0.02..0.08`; do not smear rapid rhythmic figures.
- Use `rubato` structurally and sparingly in music that requires a strong pulse.
- Keep a stable `seed` so the same code identifies the same work.

Hard limits after repeats: 16 tracks, 32 sections, 256 bars, 8,192 note events, 4,096 controls, 12 simultaneous notes per event, and 30 minutes total.

## Quality guidance

For standalone listening use `quality master` unless memory constraints require `studio`. High quality comes primarily from correct source samples, orchestration and performance decisions, not from simply maximizing gain.

For fast strings, let staccato/spiccato and velocity variation activate physical layers and round-robin where available. Avoid perfectly identical velocities on long repeated-note passages. Preserve ensemble hierarchy: solo violin foreground, violin/viola middle, cello/bass foundation, continuo below the solo line.

For Baroque music, prefer `keys.harpsichord` for continuo when its native pack is installed. Keep reverberation/decay restrained compared with modern cinematic orchestration. Do not turn every string line into continuous vibrato.

For reading/audiobooks, use sparser foreground attacks and more silence than in standalone concert music.

## Native multi-instrument example

```text
TLOQUE_SCORE 2
title "Baroque engine study"
tempo 132
meter 4/4
loop false
seed 20260823
humanize 0.045
quality master
module native-auto
track solo synth=pad instrument=strings.violin program=40 role=melody gain=0.28 pan=0.10 attack=0.01 release=1.0 expression=0.88 brightness=0.58 vibrato=0.06 timbre=natural
track viola synth=pad instrument=strings.viola program=41 role=harmony gain=0.20 pan=-0.18 attack=0.01 release=1.0 expression=0.78 brightness=0.50 vibrato=0.03 timbre=natural
track cello synth=bass instrument=strings.cello program=42 role=bass gain=0.22 pan=0.18 attack=0.01 release=1.0 expression=0.80 brightness=0.42 vibrato=0.02 timbre=natural
track continuo synth=pluck instrument=keys.harpsichord program=6 role=harmony gain=0.18 pan=-0.04 attack=0.003 release=0.5 expression=0.72 brightness=0.62 vibrato=0 timbre=natural
section opening form=exposition bars=2 repeat=1 fade=0 tempo=132 rubato=0.015
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
control 1:1 expression=0.72 vibrato=0.03 brightness=0.54 ramp=0
1:1 E5 0.5 velocity=0.66 articulation=spiccato
1:1.5 F5 0.5 velocity=0.70 articulation=spiccato
1:2 G#5 0.5 velocity=0.74 articulation=spiccato
1:2.5 A5 0.5 velocity=0.78 articulation=accent
1:3 G#5 1 velocity=0.68 articulation=staccato
2:1 E5 2 velocity=0.62 articulation=normal
end
```

## Final self-check

- First line is exactly `TLOQUE_SCORE 2`.
- Work is instrumental and contains no unsupported command.
- All tracks precede sections; every `use` names an existing track; every section has `end`.
- Values are in range and repeats remain under hard limits.
- `native-auto` uses only semantic instrument identities that have verified native packages available for the intended installation.
- Requested timbres/articulations exist physically; unavailable capabilities are not approximated dishonestly.
- Pedal and pitch bend gestures are intentionally closed/reset.
- Fast passages have deliberate phrasing and dynamic variation rather than machine-identical events.
- Final response contains one complete score ready to paste into Tloque.
