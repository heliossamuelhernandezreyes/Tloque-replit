---
name: compose-tloque-score
description: Compose, revise, or repair instrumental TloqueScore 2 code for Tloque Audio Studio. Use when creating sonatas, character leitmotifs, lobby themes, reading music, interface themes, or any linear instrumental work that must compile in Tloque.
---

# Compose TloqueScore 2

Create only original instrumental music. The TloqueScore code is the master work: Tloque compiles it for live playback and can export it as WAV.

## Compatibility

- Audio contract: `tloque-audio-2026-08-v2`
- Compiler: `tloque-score-compiler-v2`
- Skill version: `1.0.0`
- Built-in module: `builtin`

Never invent commands or execute JavaScript. Never add lyrics, sung words, audio URLs, Markdown, or explanations inside a score.

## Required workflow

1. Ask for purpose, approximate duration, mood, musical form, instruments, and whether the piece must loop. If the user omits them, choose conservative defaults.
2. Translate musical terms into constraints. For example, `adagio` becomes an appropriate `tempo`; it is not a TloqueScore command. An arpeggio is written as separate note events.
3. Plan form and bar count before writing notes. Keep a recognizable motif and vary contour, rhythm, harmony, register, or orchestration.
4. Declare every track before the first section.
5. Use `module builtin` unless the user supplies the exact ID of an installed module.
6. Validate the complete score against the grammar and limits below.
7. Return exactly one code block containing the complete score. Do not put commentary inside that block. The user pastes only its contents into Tloque.

## Grammar

The first line must be:

```text
TLOQUE_SCORE 2
```

Global commands, one per line:

```text
title "Title up to 160 characters"
tempo 32..180
meter 2..12/4 or 2..12/8
loop true|false
seed 0..2147483647
quality core|studio|master
module builtin|installed-module-id
```

Track declarations must come before all sections. IDs start with a lowercase letter and may contain lowercase letters, numbers, `_`, or `-`.

```text
track id synth=warm|pad|bell|pluck|bass instrument=instrument.id program=0..127 role=melody|harmony|bass|pulse|texture|accent gain=0..1 pan=-1..1 attack=0.001..8 release=0.01..12
```

Sections and events:

```text
section id form=exposition|development|recapitulation|coda|interlude|custom bars=1..128 repeat=1..4 fade=0..16 tempo=32..180
use track-id
bar:beat C3,Eb3,G3 duration velocity=0.01..1 articulation=normal|legato|staccato|tenuto|accent
rest bar:beat duration
end
```

Rules for notes and time:

- Valid notes run from `C1` through `C8`. Use `#` or `b` for accidentals, such as `F#4` or `Bb3`.
- Separate simultaneous notes with commas and no spaces: `C3,E3,G3`.
- `bar:beat` must fall inside the current section and meter. In 4/4, beats are 1 through 4; in 6/8, positions are 1 through 6.
- Duration is measured in quarter-note beats: `1` is a quarter note, `0.5` is an eighth note, and `4` is a whole note in 4/4.
- A section must end with `end`. Select a track with `use` before writing its notes or rests.
- Use a stable `seed` so the same code identifies the same work.

Hard limits after repeats are expanded:

- 16 tracks, 32 sections, 256 bars, 8,192 note events, 12 simultaneous notes per event, and 30 minutes total.

## Composition guidance

For a readable mix, separate registers and roles: place bass mostly below `C3`, harmony around `C3-C5`, and foreground melody around `C4-C6`. Leave rests and avoid having every track attack on every beat. Use `gain` and velocity for hierarchy; do not solve balance only by lowering every track.

For reading or audiobooks, use no lyrics, sparse foreground attacks, modest syncopation, smooth voice leading, controlled brightness, and real silence around dense dialogue or important text. Do not map one emotion to one cliché such as “sad equals minor.” Combine tension, pace, intimacy, uncertainty, and narrative purpose.

For lobby themes or standalone works, stronger melody and development are allowed, but preserve headroom and avoid a permanently dominant sub-bass. A leitmotif should keep one or two recognizable interval or rhythm traits while its harmony, register, or orchestration changes.

## Complete valid example

```text
TLOQUE_SCORE 2
title "Luz en el umbral"
tempo 72
meter 4/4
loop false
seed 20260822
quality studio
module builtin

track piano synth=warm instrument=piano.grand program=0 role=harmony gain=0.32 pan=-0.10 attack=0.04 release=1.5
track motif synth=pad instrument=strings.violin program=40 role=melody gain=0.22 pan=0.14 attack=0.16 release=1.8

section opening form=exposition bars=4 repeat=1 fade=1 tempo=72
use piano
1:1 C3,E3,G3 2 velocity=0.48
1:3 G3,C4,E4 2 velocity=0.44
2:1 F3,A3,C4 4 velocity=0.46
3:1 D3,F3,A3 2 velocity=0.46
3:3 G3,B3,D4 2 velocity=0.48
4:1 C3,E3,G3 4 velocity=0.42 articulation=tenuto
use motif
1:1 E4 1 velocity=0.42 articulation=legato
1:2 G4 1 velocity=0.44 articulation=legato
1:3 C5 2 velocity=0.48
2:1 A4 2 velocity=0.44
2:3 G4 2 velocity=0.40
3:1 F4 1 velocity=0.42
3:2 A4 1 velocity=0.44
3:3 D5 2 velocity=0.48
4:1 E4 4 velocity=0.38 articulation=tenuto
end
```

## Final self-check

- The first line is exactly `TLOQUE_SCORE 2`.
- The work is instrumental and contains no unsupported commands.
- All tracks appear before sections; every `use` names an existing track; every section has `end`.
- Every note, position, duration, velocity, articulation, program, gain, pan, attack, and release is in range.
- Expanded repeats stay within all hard limits.
- Bass, harmony, and melody occupy intentional registers and remain audible without masking one another.
- The final response contains one complete score ready to paste into Tloque.
