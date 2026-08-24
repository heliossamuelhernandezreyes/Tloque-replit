---
name: compose-tloque-score
description: Compose, revise, or repair instrumental TloqueScore 2 code for Tloque Audio Studio, including multi-instrument native orchestration and premium acoustic rendering.
---

# Compose TloqueScore 2

Create only instrumental music. The TloqueScore code is the master work: Tloque compiles it for live playback and can export it as WAV.

## Compatibility

- Audio contract: `tloque-audio-2026-08-v2`
- Compiler: `tloque-score-compiler-v2.1`
- Skill version: `1.6.0`
- Built-in module: `builtin`
- Native multi-instrument router: `native-auto`
- Premium native master: physical verified sample packs required
- Performance engine: deterministic family-aware micro-timing, duration and performed-velocity shaping driven by `humanize`

Never invent commands or execute JavaScript. Never add lyrics, sung words, audio URLs, Markdown, or explanations inside a score.

## Required workflow

1. Determine purpose, duration, mood, form, instruments and whether the piece loops.
2. Plan form and bar count before writing notes; keep motifs recognizable but developed.
3. Declare every track before the first section.
4. Use `module native-auto` for multi-instrument premium work. Use `builtin` only when portability matters more than acoustic quality.
5. Never claim a physical articulation, timbre, true-legato transition, release layer, stop or microphone that the installed library does not contain.
6. For `quality master`, use only native semantic instruments expected to have their physical packs installed.
7. Use `humanize` deliberately: it is no longer generic random jitter. It drives deterministic family-aware performance behavior while preserving authored notes and articulations.
8. Validate the full score and return one complete code block when code is requested.

## Grammar

```text
TLOQUE_SCORE 2
title "Title"
tempo 32..180
meter 2..12/4 or 2..12/8
loop true|false
seed 0..2147483647
humanize 0..1
quality core|studio|master
module builtin|native-auto|installed-module-id
track id synth=warm|pad|bell|pluck|bass instrument=instrument.id program=0..127 role=melody|harmony|bass|pulse|texture|accent gain=0..1 pan=-1..1 attack=0.001..8 release=0.01..12 expression=0..1 brightness=0..1 vibrato=0..1 timbre=natural|non-vibrato|vibrato|expression-vibrato|mute|harmon-mute|straight-mute
section id form=exposition|development|recapitulation|coda|interlude|custom bars=1..128 repeat=1..4 fade=0..16 tempo=32..180 rubato=0..0.35
use track-id
control bar:beat expression=0..1 brightness=0..1 vibrato=0..1 pedal=down|up bend=-2..2 ramp=0..16
bar:beat C3,Eb3,G3 duration velocity=0.01..1 articulation=normal|legato|staccato|tenuto|accent|spiccato|pizzicato|tremolo|harmonic timbre=...
rest bar:beat duration
end
```

`timbre=` on an event overrides the track default. Fractional beat positions are valid throughout the whole beat: in 4/4, `4:4.25`, `4:4.5`, and `4:4.75` are valid; `4:5` is outside the bar.

Unpitched orchestral percussion uses semantic `hit` events on `instrument=percussion.orchestral-kit`, for example `hit 1:1 bass-drum 0.5 velocity=0.8`. Do not encode percussion names as fake pitches.

## Native acoustic routing

With `module native-auto`, every semantic `instrument=` resolves independently to a verified physical package. Useful native identities include:

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

Use `strings.violin` for a solo/concertino line and `strings.violin-section` for tutti. The preferred Baroque routing remains:

```text
strings.violin   -> VSCO 2 CE Solo Violin
strings.viola    -> VSCO 2 CE Viola Section
strings.cello    -> VSCO 2 CE Cello Section
keys.harpsichord -> VCSL Italian Harpsichord · Stop 1
```

The complete brass palette is:

```text
brass.trumpet  -> VSCO 2 CE Trumpet
brass.trombone -> VSCO 2 CE Tenor Trombone
brass.horn     -> VSCO 2 CE F Horn
brass.tuba     -> VSCO 2 CE Tuba
```

Trumpet includes recorded natural/vibrato, straight mute and Harmon mute colours; horn has a recorded mute; trombone has recorded vibrato. Use those colours only when physically declared.

`guitar.electric-clean` uses Karoryfer Emilyguitar: four recorded velocity layers, three note round robins and physical release/noise samples. Write realistic guitar voicings and do not invent nylon body, strumming, palm mute or harmonics.

### Colour winds

`woodwinds.ocarina` uses the CC0 VCSL Estuary ocarina selection. Tloque currently curates physical natural sustain and physical staccato. The source library also contains vibrato recordings, but they are deliberately not author-facing until the timbre routing is explicitly modeled. Never fake the missing vibrato colour.

`woodwinds.alto-recorder` uses VCSL Estuary alto recorder. Tloque currently curates physical sustain and staccato. Write breath-shaped monophonic phrases, leave room between exposed phrases, and do not write impossible polyphonic chords for a single recorder or ocarina track.

### Cinematic pipe organ

The current organ is no longer treated as one generic preset. Three semantic tracks expose three independent physical VCSL layers:

```text
keys.pipe-organ       -> Rode Man3 Open manual
keys.pipe-organ-soft  -> NT5 Man3 Quiet manual
keys.pipe-organ-pedal -> Rode Pedal low register
```

For monumental/cinematic organ writing, combine these as separate tracks: the soft manual can establish a restrained bed, the open manual can carry the principal harmony/ostinato, and the pedal layer can supply long low fundamentals. Build crescendos by orchestration and expression rather than pretending there is a continuous swell pedal or arbitrary stop automation. These three identities are physical recorded colours, not a complete virtual pipe-organ registration system.

A suitable original cosmic/cinematic texture may combine sustained organ pedal, repeating manual figures, strings and restrained brass, but never copy a copyrighted score or claim stops that Tloque has not sampled.

### Preview versus premium master

- Live preview may fall back to Tloque base synthesis when a required package is absent. That fallback is for auditioning, not proof of acoustic fidelity.
- `quality master` with native instruments requires every physical pack used by the score. A synthesis fallback is never described as a premium/native master.
- `core` or `studio` may prioritize portability or memory.
- Never silently substitute an unrelated semantic instrument because a pack is unavailable.

## Physical capability rules

Articulation and recorded timbre are independent. `articulation=staccato` asks for a played gesture; `timbre=vibrato` asks for a separately recorded colour when the manifest actually contains one. Numeric `vibrato=0..1` is an expressive control and is not the same as recorded `timbre=vibrato`.

`articulation=legato` is semantic. True legato is used only when a manifest declares recorded note-to-note transitions. Release samples are automatic when declared. Mic positions are internal and are not currently author-facing; never invent `mic=`.

## Performance guidance

Write phrasing rather than a MIDI grid. Shape small velocity and expression arcs, use accents at structural destinations, and let `humanize` handle only the last layer of physical imperfection.

The native Performance Engine is deterministic for a given score/seed. It does not fabricate new articulations. It adjusts only conservative performed timing, note length and velocity according to the semantic family:

- solo strings receive tiny attack variation and alternating bow-like velocity asymmetry;
- string sections receive slightly wider ensemble timing variation than solo strings;
- woodwinds and brass create modest separation on non-legato notes to suggest breath while preserving authored legato/tenuto;
- percussion stays comparatively tight but avoids identical repeated velocities;
- piano, harpsichord and guitar receive small attack/velocity variation;
- pipe organ remains almost mechanically stable because large timing jitter is not idiomatic for held organ layers.

Recommended starting ranges are `humanize 0.03..0.10` for tight Baroque/virtuoso work, `0.08..0.18` for chamber/orchestral writing, and `0.12..0.25` for slower cinematic material. Values above about `0.35` should be intentional rather than a default. `humanize 0` is exactly neutral.

Do not manually scatter every note by arbitrary fractional positions to imitate a performer. Keep the score musically legible and use fractional positions when rhythmically intended; the Performance Engine handles micro-timing after compilation.

For exposed Baroque strings, avoid permanent high vibrato. For brass, keep low brass from masking bass fundamentals and reserve trumpet brightness for peaks.

For ocarina and recorder, prefer singable monophonic contours, realistic breath-length phrases, modest registers and intentional rests. Their current sparse physical sampling is best for exposed colour lines, not dense virtuoso chromatic writing across huge ranges.

For cinematic pipe organ, long held notes and repeating figures are strengths. Use `keys.pipe-organ-pedal` sparingly below the orchestra, layer `keys.pipe-organ-soft` before `keys.pipe-organ` for growth, and let strings/brass widen the spectrum instead of simply maximizing organ gain.

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
track tutti synth=pad instrument=strings.violin-section program=40 role=harmony gain=0.20 pan=-0.12 attack=0.01 release=1.0 expression=0.78 brightness=0.52 vibrato=0.03 timbre=natural
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
use tutti
1:1 A4 0.5 velocity=0.50 articulation=spiccato
1:1.5 A4 0.5 velocity=0.54 articulation=spiccato
1:2 A4 0.5 velocity=0.52 articulation=spiccato
1:2.5 A4 0.5 velocity=0.56 articulation=spiccato
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

- First line is exactly `TLOQUE_SCORE 2`; the work is instrumental.
- Tracks precede sections; every `use` is declared; every section has `end`.
- Bars, beats, fractional positions, repeats and values are in range.
- Native identities have verified physical packages for the intended master.
- Requested timbres/articulations exist physically and unavailable capabilities are not approximated dishonestly.
- `humanize` is chosen for the idiom rather than maximized blindly; the score itself remains rhythmically legible.
- Guitar, colour winds and organ writing stays within their installed physical capabilities.
- A synthesis fallback is never described as a premium/native master.
- Fast passages have deliberate phrasing rather than machine-identical events.