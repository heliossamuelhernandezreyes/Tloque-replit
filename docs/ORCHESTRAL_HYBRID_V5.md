# Orchestral Hybrid V5 — Intelligent Performer

> Superseded for current rendering by [Orchestra Conductor V6](./ORCHESTRA_CONDUCTOR_V6.md). The V5 individual-musician gesture remains active underneath V6.

Date: 2026-09-05. Parent releases: Orchestral Synth V3 and Orchestral Hybrid V4.

## Result

V5 adds one renderer-neutral performance gesture to every playable event. The gesture describes how the authored note is performed without changing its pitch, rhythm class, articulation or timbre. Native samples, bank-free synthesis, hybrid overlays and physical reeds consume the same deterministic decision in realtime and WAV.

| Contract | Version | Scope |
|---|---|---|
| Score source | `TLOQUE_SCORE 2` / `tloque-score-compiler-v2.2` | Backward-compatible author input |
| Intelligent Performer | `tloque-intelligent-performer-v5` | Renderer-neutral gesture shape |
| Gesture rules | `tloque-intelligent-performer-rules-v1-phrase-gesture` | Family, phrase, contour and articulation policy |
| Universal Director | `tloque-universal-performance-director-v3-intelligent-gestures` | Phrase segmentation and performed event values |
| Hybrid performance | `tloque-native-hybrid-performance-v4-intelligent-performer` | Sample-dominance, voice limits and gesture transport |
| Bowed overlay | `bowed-string-overlay-v3-intelligent-gesture` | Continuous V4 string plus V5 gesture |
| Air overlay | `air-column-overlay-v1.2-intelligent-gesture` | Breath/pressure gesture under wind and brass samples |
| Physical string DSP | `tloque-bowed-string-dsp-v3` | Unchanged stable waveguide processor |

DA analysis and manuscript text remain outside the renderer. The Music Brain may author notes and controls upstream, but playback never infers narrative meaning from raw prose.

## Gesture contract

Each event records:

- physical medium: bow, breath, key, pluck, strike or generic sustain;
- connection: fresh attack, modeled phrase carry or verified recorded legato;
- bounded attack and release time scales;
- onset, sustain and release effort;
- bounded brightness and vibrato depth;
- delayed vibrato and interval-aware transition time;
- bow direction where applicable;
- explicit breath reset for a new wind/brass attack.

The rules use complete phrase position, stable climax, metric hierarchy, articulation, monophonic continuity and instrument family. `humanize=0` keeps authored time, duration and velocity neutral; V5 gesture shaping remains active because interpretation and random variation are separate concerns.

## Capability truth

`phrase-carry` is modeled continuity, never a recorded claim. `recorded-legato` is emitted only when the selected manifest declares true legato and the sample pack contains the exact from/to transition. A normal articulation keeps a fresh attack. Missing dedicated articulations, release samples, velocity layers or round robins are not invented.

The sample remains dominant. Recorded attacks and releases are only adjusted within tight time bounds; one-shots keep their physical waveform. Sustained sample layers receive the gesture through their existing effort, brightness, expression and crossfade paths. Synthetic and physical sources use the same gesture more deeply because their excitation is generated at render time.

## Renderer coverage

- Native sample live and WAV share `NativeSampleScorePlan`, including gesture-shaped dynamics, expression and phrase carry.
- Bank-free synthesis passes the gesture through every planned event; strings, winds, brass, keys, plucks and percussion retain their family-specific renderer.
- Continuous string phrases preserve one waveguide lifetime while applying per-event effort, colour, vibrato and release intent.
- Wind/brass hybrid overlays use breath reset, effort, brightness and delayed vibrato.
- Native physical reeds consume the same attack, release, pressure, colour and vibrato gesture.
- Runtime source limits, explicit rests, safe phrase boundaries and deterministic silent/fallback behavior remain unchanged.

## Evidence and source status

No external code, model, preset, sample, impulse response or knowledge dataset was imported for V5. The implementation uses repository-owned DSP and the existing verified manifests and banks. V4 and earlier A/B reports are excluded from Master promotion because their performance and overlay versions do not match V5.

Release gates require deterministic gesture plans, capability-truth tests, bounded finite curves, unchanged authored notes, sample/synth/physical routing coverage, deterministic PCM, zero clipping, TypeScript, full regression tests, offline waveform tests, production build and bundle budget.

## Honest limit

Technical completion is not perceptual certification. V5 does not claim a universal human interpretation, an indistinguishable acoustic orchestra, recorded true legato where no transition exists, or a measured concert hall. Blind listening with installed banks remains required on the target Poco X7 Pro, wired/Bluetooth headphones and phone speaker before any version-matched Master promotion.
