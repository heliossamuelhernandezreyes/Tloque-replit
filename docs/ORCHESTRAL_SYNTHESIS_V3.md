# Orchestral synthesis V3 — physical strings

Date: 2026-09-04. Parent release: `tloque-orchestral-synth-v2.1`.

## Result and compatibility

`module orchestra-synth` keeps the existing `TLOQUE_SCORE 2` contract and remains bank-free. The renderer advances to `tloque-orchestral-synth-v3-physical-strings`; saved scores do not need a rewrite. Authored notes, rests, articulations, timbres and controls remain the source of truth.

| Layer | Version | Behaviour |
|---|---|---|
| Renderer | `tloque-orchestral-synth-v3-physical-strings` | Existing module ID; physical bowed-string route |
| String DSP | `tloque-bowed-string-dsp-v3` | Nonlinear oversampled waveguide plus body modes |
| Interpretation | `tloque-universal-performance-director-v2` | Phrase boundaries and performed event values |
| Dynamics | `tloque-orchestral-dynamics-v2` | Continuous effort and brightness curves |
| Stage | `tloque-concert-stage-v3` | Existing designed stereo stage |

No manuscript text or reader inference enters this renderer. DA and Music Brain contracts stay upstream.

## Physical string path

Violin, violin section, viola, cello and contrabass now use a dedicated bowed-string path for every non-pizzicato, non-harmonic event:

- a Nyquist-bounded periodic exciter and deterministic bow texture feed a delay-line waveguide;
- a bounded odd friction curve runs inside the feedback path with browser oversampling;
- frequency and delay length move together through valid legato transitions;
- instrument-specific body modes and bridge filtering replace direct oscillator output;
- expression, brightness, vibrato and pitch bend remain continuous within the event;
- a monophonic chain of explicitly linked notes in one Performance Director phrase occupies one physical voice and one source-budget reservation;
- chords, authored rests, phrase starts, pizzicato and harmonics are hard grouping boundaries.

When available, `/audio-worklets/tloque-bowed-string-v3.js` runs the same contract off the main thread with internal 1x/2x/4x integration. Environments without `AudioWorklet` use the deterministic Web Audio waveguide. This fallback is a supported backend, not a change to the score.

## Quality and mobile policy

| Context sample rate | Internal integration | Section members |
|---:|---:|---:|
| below 44.1 kHz | 1x | 2 |
| 44.1–88.1 kHz | 2x | 3 |
| 88.2 kHz and above | 4x | 3 |

The existing 192-source admission limit still includes release tails. A continuous string phrase reserves one bounded unit for its complete lifetime instead of allocating a new physical string at every connected note. Adaptive-dwell loops keep event-sized units because later loop cycles may intentionally suppress individual events.

## Live/WAV parity

Realtime and offline native routes both:

1. compile `buildOrchestralSynthRenderUnits()`;
2. prepare the worklet when the current context supports it;
3. schedule grouped strings through `scheduleOrchestralStringPhrase()`;
4. use the same fallback and source budget;
5. retain the existing sampled/hybrid paths for `native-auto`.

## Evidence gates

Automated tests must prove version alignment, stable grouping, rest boundaries, bounded friction, distinct body profiles, quality tiers, one reservation per connected phrase, deterministic PCM, finite output, low DC and zero clipped samples. Full application typecheck, tests, offline orchestral render, production build and bundle budget remain release gates.

This implementation uses no new sample, preset, model or third-party DSP source. All V3 code is original repository work under the project license.

## Honest limit

V3 is a material synthesis improvement, not proof of an indistinguishable acoustic violin or concert orchestra. `AudioWorklet` must still be listened to on the target Poco X7 Pro, headphones, speaker and Bluetooth. Recorded attacks, true-legato sample transitions and measured hall responses remain properties of verified banks, not claims made by this synth.
