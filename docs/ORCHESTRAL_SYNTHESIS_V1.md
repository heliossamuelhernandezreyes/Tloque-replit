# Orchestral synthesis v1 — implementation and validation

Date: 2026-08-31. Base: `f16bd490628b4b23095cf2b408cb20c95dc92217`.

## Selecting the sound

In Fonoteca → Compositor, select **Síntesis orquestal**, then validate/compile. The source line becomes `module orchestra-synth`; authored notes, rhythm, tracks and score version stay intact. `native-auto` remains the recorded/physical source router, and `builtin` retains the legacy synthesized source. Saved scores and the reader recognize the new source without a sample-bank asset.

The downloadable composer guide is version 1.9.0 and documents this distinction explicitly.

## Architecture and sound changes

- `shared/orchestral-synthesis.ts`: original family spectra, formants, decays, ensemble sizes and excitation parameters. Strings, wind families and brass receive different harmonic profiles; piano, harp and struck percussion use decaying modal partials. Unknown identities have a neutral synthetic fallback, not a claimed recorded equivalent.
- `OrchestralSynthPlan`: the existing deterministic Performance Engine/Director interprets timing, duration and velocity without changing authored pitches. The plan contains no invented sample capabilities. Piano pedal extends performed duration.
- `OrchestralSynthVoice`: shared realtime/offline Web Audio voices; velocity-sensitive filtering, delayed vibrato, bounded within-note dynamics, three decorrelated violin-section members, per-member stereo offsets, deterministic bow/breath-like excitation and power-normalized section gain. Numeric bend/vibrato controls run over the held note; an event's `non-vibrato` overrides the track.
- `OrchestralExpression`: bounded phrase envelopes also serve sustained native samples. Recorded vibrato is not doubled; one-shot recordings are not reshaped by this layer.
- `OrchestralRoom` / `ScoreAcousticStage`: four directional early reflections per track, family seating, depth/air filtering and shared diffuse/tail returns. This is a designed virtual stereo stage, not a measured hall or personalized HRTF.
- `ScoreMixMaster`: gentler main compression preserves attacks and dynamic differences; the safety chain remains. Shared `NativeRenderGraph` is used for realtime and WAV.

Correctness fixes include interpolated control lookup, interrupted ramp continuity (including restoring its earlier ramp segment), Nyquist-safe filter limits at Preview rate, reference-monitor volume, and updated reader fallback status. Missing native sources use the new voice only on affected tracks; strict/native Master continues to reject missing or uncertified sources. Explicit synthetic Master does not request native certification.

## Bounds and compatibility

| Mode | Rate / depth | Meaning |
|---|---|---|
| Preview / `core` | 32 kHz / 16-bit | Synthetic preview |
| Studio | 48 kHz / 24-bit | Synthetic WAV |
| Master, `orchestra-synth` | 96 kHz / 24-bit | Higher-rate synthetic WAV, not acoustic certification |
| Master, native source | 48 kHz / 24-bit | Existing physical-source verification required |

At most 192 concurrent synthesis sources are admitted, including release tails. One note can use multiple sources. Budget overflow is reported instead of silently completing a partial export. Per-context waveform cache: 128 entries. Control curves: at most 8192 points per note. Existing decoded-sample and offline-buffer memory guards remain. The realtime scheduler, explicit playback gesture, reading duck/silence/volume controls and adaptive dwell policy are retained.

The new synthesis does not prove physical mutes, sampled true-legato, individual bow directions, room measurement, a full-sized orchestra, or indistinguishability from acoustic performers. The source choice is not an automatic migration of saved `builtin` works. Native previews/exports do change through the shared stage, dynamics and sustained-note layer.

## Reproducible checks

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run test:audio:render
npm run build
npm run check:bundle
```

Verified locally on Node 20.20.2: 433 general tests and 9 audio-render/runtime tests pass. The audio CI workflow runs both suites. Tests cover real PCM rendering at 32/48/96 kHz, ten distinct family outputs, equal repeated render hashes, finite/non-silent data, clipping, DC, stereo/mono compatibility, source admission (including out-of-order realtime recovery), interrupted ramps, event non-vibrato, held-note bend and native one-shot preservation. These checks are technical evidence, not listening votes.

The original 8-track, 4-bar fixture is `tests/fixtures/orchestral-score.ts`. Node offline renderer results:

| Measurement | Studio result |
|---|---:|
| Duration including tail | 19 s |
| Integrated loudness | −21.300 LUFS |
| Sample peak | −6.960 dBFS |
| 4× interpolated peak estimate | −6.959 dBTP |
| Clipped samples | 0 |
| DC offset | 0.00000146 |
| Stereo side/mid RMS | 0.3243 |
| Channel correlation | 0.9172 |
| WAV size | 5,472,044 bytes |

Repeated Studio WAV SHA-256: `5848a7ca181879cb8ccf7b19a502383688d8ff06e18d171bdfa0cea80c77f353`. This is a reproducibility observation for this renderer/version/environment, not a cross-browser bit-identity guarantee. Preview measured −21.188 LUFS / −7.426 dBFS; Master −21.345 LUFS / −7.344 dBFS. The peak estimator is an engineering diagnostic, not laboratory conformance certification.

## Pending perceptual and device validation

`npm run test:audio:browser` serves a loopback-only listening/transport laboratory at `http://localhost:4178`. It compiles the production engine and offers render, play, pause, resume and stop. Re-run it after source changes. The remote browser in this session rejected the local URL with `ERR_BLOCKED_BY_CLIENT`; interactive browser and physical-device listening were therefore **not** validated here. No alternate browser access route was used.

Before making concert-realism or mobile-performance claims, test the actual reader on the target device/headphones: starts and releases, exposed solos, soft/loud passages, dense tutti, transitions, pause/resume, silence/ducking, repeated loops, cancellation and long exports. Compare at matched loudness. The provided classical/new listening clips are labelled references, not a blind perceptual certification.

## Provenance and licenses

Timbre/room/expression code and the short score are original project work under the repository's MIT license. No third-party sample/audio asset, score, measured impulse response or model weight was imported.

The test-only dependency `node-web-audio-api` is pinned to 1.0.9 (BSD-3-Clause; supports Node 20). It renders an offline graph without an audio device and is not included in the browser bundle or the production audio engine. Primary implementation/API references: [IRCAM node-web-audio-api](https://github.com/ircam-ismm/node-web-audio-api), [Web Audio API specification](https://www.w3.org/TR/webaudio-1.1/). Existing native-bank licenses and approval registries remain unchanged.
