# Orchestra Conductor V7 · Acoustic Continuity

Date: 2026-09-07. Parent release: Orchestra Conductor V6.

V7 closes continuity defects found after the V6 ensemble release. It still sits above Intelligent Performer V5 and never parses manuscripts, composes notes or mutates the compiled score. The change is renderer-neutral and deterministic: authored musical positions define ensemble gestures while rendered seconds retain their bounded humanization.

## Versioned contracts

| Layer | Version | Responsibility |
|---|---|---|
| Ensemble contract | `tloque-orchestra-conductor-v7-acoustic-continuity` | Bounded shared gesture plus measured audible gap |
| Ensemble rules | `tloque-orchestra-conductor-rules-v2-musical-onset-audible-gap` | Musical-onset grouping, sounding-note memory and linear section lookup |
| Universal director | `tloque-universal-performance-director-v5-acoustic-continuity` | V5 musician gesture plus V7 ensemble decision |
| Native sample player | `tloque-native-sample-player-v3-acoustic-continuity` | Preserve authored sample envelopes while applying eligible V5/V7 shaping |
| Bank-free synth | `tloque-orchestral-synth-v5-acoustic-continuity` | Consume the V7 decision in spectral and physical voices |
| Hybrid performance | `tloque-native-hybrid-performance-v6-acoustic-continuity` | Transport the exact V7 decision to subordinate overlays |
| Bowed overlay | `bowed-string-overlay-v5-acoustic-continuity` | Conducted continuous string body |
| Air overlay | `air-column-overlay-v1.4-acoustic-continuity` | Conducted air-column body |
| Physical reeds | `reed-resonator-v3-acoustic-continuity` | Preserve conducted colour across in-note automation |
| Shared live/WAV profile | `tloque-score-audio-v9-acoustic-continuity` | Render-path parity marker |
| Native concert profile | `tloque-native-concert-v4-acoustic-continuity` | Native/sample export identity after envelope correction |

## Corrections

### Musical onset is not wall-clock coincidence

TloqueScore V2 may move rendered `timeSeconds` by a few milliseconds when `humanize` is enabled. V6 grouped events by those seconds, so notes written at the same beat could receive different ensemble density, energy and phase. V7 groups by the authored `timeBeats`; each musician keeps its deterministic microtiming, but the orchestra receives one common gesture.

### Silence begins after sound ends

V6 compared the current onset with the preceding onset. A four-second held note followed 100 ms later could therefore look like four seconds of silence. V7 tracks the latest completed note end and exposes `audibleGapSeconds` in the gesture. Touching or overlapping notes report zero; real gaps report the elapsed time after the last sounding end. Values are finite and capped at 30 seconds.

### Recorded envelopes keep their conductor

The sample planner already transported V5 and V6, but the player rebuilt a smaller envelope object and discarded both gestures before calculating attack and release. V7 retains the complete request. Source-authored attack/release values receive bounded gesture scaling; explicit true-legato crossfades remain exact; one-shots remain unchanged.

### Continuous reeds keep their colour

The physical reed applied ensemble colour at note start but lost it when a later brightness control began. V7 uses one shared colour function for initial state and every in-note ramp.

### Long scores stay linear after sorting

Section progress previously called `indexOf` inside every onset group. V7 precomputes group counts and advances one position counter per section, removing the quadratic section lookup while preserving deterministic order.

### Two-member low-register sections remain bounded

The 32 kHz preview tier may use two physical members. A fixed-cent pair can collapse into an extremely slow low-register beat. V7 applies a small frequency-domain floor only to two-member pairs, keeps exact symmetry around concert pitch and caps each side to at most 8 cents and at most 3 cents beyond the requested spread. Three-member and solo layouts are unchanged. This is a conservative music-design heuristic, not perceptual certification.

## Invariants

- `humanize=0` remains bit-neutral for event time, duration and velocity.
- Notes, pitches, articulations and declared timbres are never rewritten.
- Recorded true legato and release samples are used only when the installed manifest supplies them.
- Explicit transition fades and one-shot envelopes are not reinterpreted.
- Native samples remain dominant and hybrid wet ceilings cannot increase.
- Live, WAV and runtime budgeting compile the same V5/V7 maps.
- The 192-source ceiling and existing mobile memory caps remain unchanged.

## Provenance and validation boundary

No external code, sample, impulse response, model, score or research claim was added. V7 reuses the project's original DSP, installed-bank contracts and existing deterministic score pipeline. All V6 and earlier A/B evidence is excluded from promotion because its renderer and conductor versions no longer match.

Automated validation covers version identity, deterministic grouping under humanization, gap measurement, role hierarchy, sample-envelope propagation, explicit-envelope preservation, one-shot neutrality, continuous reed colour, bounded low-register spread, live/WAV transport, finite PCM and zero clipping. These tests establish implementation safety and reproducibility, not acoustic realism. Master remains closed until version-matched objective renders and blind listening are completed on target speakers, headphones and Bluetooth paths.
