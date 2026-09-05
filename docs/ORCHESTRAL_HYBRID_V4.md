# Orchestral Hybrid V4 — continuous physical performance

Date: 2026-09-05. Parent releases: Orchestral Synth V3 and Native Hybrid Performance V2.1.

## Result

V4 removes the note-by-note reset from the subordinate physical layer of sampled bowed strings. The recorded bank remains complete and dominant. A deterministic render unit now binds eligible monophonic legato decisions into one physical string lifetime, while samples continue to provide their recorded attack, timbre, release and true-legato transition when the manifest actually contains one.

| Contract | Version | Scope |
|---|---|---|
| Score source | `TLOQUE_SCORE 2` / `tloque-score-compiler-v2.2` | Backward-compatible author input |
| Universal interpretation | `tloque-universal-performance-director-v2` | Performed time, dynamics and phrase boundaries |
| Hybrid performance | `tloque-native-hybrid-performance-v3-continuous-phrases` | Renderer-neutral grouping and sample-dominance ceilings |
| Bowed hybrid overlay | `bowed-string-overlay-v2-continuous-waveguide` | Continuous sample-underlay for bowed strings |
| Physical string DSP | `tloque-bowed-string-dsp-v3` | Oversampled nonlinear waveguide and body model |
| Bank-free synth | `tloque-orchestral-synth-v3-physical-strings` | Unchanged explicit `orchestra-synth` route |

No manuscript text or narrative inference enters the renderer. DA and Music Brain remain upstream.

## Deterministic phrase unit

`buildNativeHybridPerformancePlan()` still owns eligibility, voice thinning, simultaneous-voice normalization and wet ceilings. `buildNativeHybridRenderUnits()` then groups only decisions that already satisfy every condition below:

- bowed-string resonator;
- exactly one eligible MIDI note;
- `connected-legato` transition;
- same track, instrument and compiled phrase ID;
- distinct pitches no farther than one octave;
- no authored rest, section change or unsupported articulation between events.

Chords and all other families stay as event units. The sample plan is never thinned or rewritten; only the subordinate physical overlay uses the bounded render units.

## Physical and hybrid behavior

- The first note creates one waveguide lifetime; linked notes automate its frequency instead of allocating a new string.
- Each event carries its own normalized wet ceiling into the continuous envelope.
- The obsolete per-note legato excitation reduction is disabled inside a continuous phrase because there is no second physical attack.
- Pressure, bow position, sympathetic coupling, brightness, vibrato and pitch bend remain continuous.
- Bounded calibration axes map into feedback, damping, texture, body and release without bypassing sample dominance.
- A sampled section uses decorrelated physical members selected by the existing 32/48/96 kHz quality policy.

Realtime and WAV compile the same V4 units. Adaptive-dwell playback intentionally keeps event-sized units so a later loop can suppress one event without leaving a hidden continuous voice.

## Mobile and safety policy

The existing 192-source audio-time admission limit remains authoritative and includes tails. A connected physical string phrase makes one reservation for its complete lifetime; section member count remains two below 44.1 kHz and three at 44.1 kHz or above. Runtime diagnostics expose both authored hybrid voice count and the reduced physical render-unit count.

Master approval is deliberately reset by the new engine and performance versions. Studio may exercise the new hybrid; Master still requires the complete 3×3 register/gesture matrix, objective gates, blind human preference and version-matched promotion. Missing or unapproved assets never turn into a fabricated recorded transition.

## Source and evidence status

No external code, model, preset, sample or impulse response was added. V4 reuses repository-owned DSP and the already verified sample manifests. Earlier bowed-string A/B evidence is excluded because it was produced by `bowed-string-overlay-v1` and the V2.1 performance scheduler.

Automated release gates cover deterministic planning, hard rest boundaries, unchanged authored notes, one reservation per connected phrase, deterministic finite PCM, zero clipping, live/WAV parity, TypeScript, the complete test suite, offline waveform tests, production build and bundle budget.

## Honest limit

Technical completion is not perceptual certification. V4 still requires blind listening with installed banks on the target Poco X7 Pro, wired or Bluetooth headphones and the phone speaker. The implementation does not claim an indistinguishable acoustic ensemble, recorded true legato where a manifest lacks transitions, a measured hall or Master approval.
