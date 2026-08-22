# Tloque Music Brain V1

## Purpose

Music Brain converts the Direction Agent sidecar into an adaptive, renderer-neutral score. It does not analyze raw manuscript text inside the audio engine and it does not promise to induce focus, flow, dopamine, or a specific emotion.

The pipeline is:

`manuscript -> Direction Agent -> MusicBrainScoreV1 -> CompositionPlanV1 -> TimelineV1 -> renderer`

The normal editor remains manuscript-only. Analysis and direction remain in the advanced editor. The public reader receives only a compact experience profile and semantic music score; manuscript text, private notes, and agent audit data are not included.

## What V1 implements

- Versioned semantic score, composition plan, and event timeline.
- Deterministic seed, rule version, and knowledge version.
- Narrative regions with emotion, valence, arousal, tension, warmth, density, texture, pauses, silence, and transition time.
- Character leitmotifs represented by relative intervals and rhythm cells.
- Stable motif transformation input without storing or replaying a protected melody.
- Mode, tempo, meter, harmonic rhythm, progression, voice leading, texture, and instrument-role planning.
- Foundation, motion, and leitmotif event layers.
- Real silence markers and regions with zero note attacks.
- Reading-mode caps for intensity, density, polyphony, velocity, tempo, and MIDI range.
- Tone.js `Part` scheduling on the audio transport rather than UI timers.
- Backward-compatible compilation of existing procedural recipes.
- Region selection from the reader's existing narrative-attention resolver.
- Fallback compilation from the compact experience profile when no matching advanced sidecar exists.

## Runtime behavior

The server derives `MusicBrainScoreV1` when it serves an approved experience profile. If an advanced direction project with the same source revision exists, voice spans contribute character entrances, pauses, and dominant directed emotion. Otherwise, the compact narrative regions still produce a deterministic score without character cues.

The client compiles that score locally. A procedural soundtrack can then select a region at the next musical boundary while the reader moves through the chapter. Stream and SoundFont engines keep their existing behavior and receive the same conservative gain direction.

Nothing plays automatically. Silence and mute remain first-class user choices.

## Scientific translation

The engine uses research as safety constraints, not as an emotion-control model:

- Lyrics can interfere with verbal memory and reading comprehension, so reading music defaults to instrumental. Souza & Leite, 2023, DOI `10.5334/joc.273`, PMID `37152835`.
- Fast and loud background music can impair reading comprehension, so tempo, intensity, and velocity are bounded. Thompson, Schellenberg & Letnic, 2012, DOI `10.1177/0305735611400173`.
- Preferred music does not guarantee better reading performance. Perham & Currie, 2014, DOI `10.1002/acp.2994`.
- Effects depend on listener, task, and musical features. Furnham et al., 2002, PMID `11964204`; Du et al., 2020, DOI `10.1038/s41598-020-75623-3`.
- Interruptions and split attention add cognitive cost, supporting quiet UI and non-abrupt musical transitions. Mark et al., 2008, DOI `10.1145/1357054.1357072`; Chandler & Sweller, 1992, DOI `10.1111/j.2044-8279.1992.tb01017.x`.
- Mind-wandering correlates do not justify consumer attention diagnosis. Mézière et al., 2025/2026, DOI `10.3758/s13421-025-01797-8`, PMID `41107699`.
- Neural evidence for flow remains sparse and inconclusive. Alameda, Sanabria & Ciria, 2022, PMID `35926367`.

## Repository screening

### Suitable runtime foundations

| Repository | License | Role |
|---|---|---|
| `Tonejs/Tone.js` | MIT | Existing Web Audio renderer and transport. |
| `tonaljs/tonal` | MIT | Candidate for a later pinned theory/voicing expansion. V1 keeps the core compiler dependency-free. |
| `spessasus/SpessaSynth` | Apache-2.0 | Existing SoundFont/MIDI renderer; instrument assets require their own audit. |
| `Tonejs/Midi` | MIT | Optional MIDI interchange. |
| `jazz-soft/JZZ` | MIT | Optional MIDI/SMF tooling. |
| `schellingb/TinySoundFont` | MIT | Future native/offline renderer reference. |

### Offline knowledge, analysis, and validation

| Repository | License | Role |
|---|---|---|
| `cuthbertLab/music21` | BSD-3-Clause | Music theory, score, corpus, and analysis tooling. Corpus rights remain separate. |
| `CPJKU/partitura` | Apache-2.0 | MusicXML/MIDI/score normalization and analysis. |
| `salu133445/muspy` | MIT | Symbolic music representation and evaluation. |
| `Yikai-Liao/symusic` | MIT | Fast symbolic MIDI tooling. |
| `craffel/pretty-midi` | MIT | MIDI analysis and transformations. |
| `mido/mido` | MIT | MIDI messages and file tooling. |
| `mne-tools/mne-python` | BSD-3-Clause | Reproduction/analysis of consented EEG/MEG research only. |
| `jspsych/jsPsych` | MIT | Browser experiments for comprehension and distraction validation. |
| `neuropsychology/NeuroKit` | MIT | Reviewed offline physiological analysis, not product inference. |

### Excluded from the product runtime

GPL/AGPL sources such as Abjad, Essentia, Strudel, PsychoPy, and AGPL procedural generators are not copied into Tloque without an explicit legal/product decision. Foundation music-generation models are also excluded from mobile playback because of size, nondeterminism, latency, cost, and model/data-rights risk.

SoundFonts, samples, presets, corpora, datasets, and model weights always require asset-level license and provenance review independently of the hosting repository.

## V1 invariants

- Same score + seed + versions produces the same plan and timeline.
- Character IDs produce stable, distinguishable motif signatures.
- Silence regions emit no note events.
- Events are sorted and finite.
- MIDI, duration, velocity, tempo, density, intensity, and polyphony stay bounded.
- Region changes use musical transport boundaries.
- Missing advanced direction degrades to a compact-profile score; missing score degrades to the existing recipe; renderer failure retains the existing error/silent fallback.

## Next validation gates

1. Listening QA on phone speakers, wired headphones, and Bluetooth.
2. Verify region transitions under rapid scroll, low confidence, pause/resume, and chapter changes.
3. Add an asset-level instrument manifest before shipping new SoundFonts.
4. Run comprehension/distraction studies with silence as a control and matched loudness.
5. Expand harmony/orchestration packs only after provenance and cultural review.
