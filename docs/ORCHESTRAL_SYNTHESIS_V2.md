# Orchestral synthesis V2 — implementation and audit

Date: 2026-09-02. Base: `bbe235afcdf03d84dd2a986cf77949545891065d`.

## Result and compatibility

`module orchestra-synth` remains the explicit, bank-free orchestral renderer. The score grammar, authored notes, rhythm, tracks, seed and module ID do not change. The renderer profile advances from `tloque-orchestral-synth-v1` to `tloque-orchestral-synth-v2`; old saved scores select the same module and receive the compatible renderer improvement on their next playback/export.

| Contract | V2 value | Compatibility |
|---|---|---|
| Score/module | `TLOQUE_SCORE 2` / `orchestra-synth` | Unchanged |
| Renderer | `tloque-orchestral-synth-v2` | Version bump, no score rewrite |
| Continuous dynamics | `tloque-orchestral-dynamics-v2` | New shared live/WAV layer |
| Concert stage | `tloque-concert-stage-v3` | New deterministic impulse design |
| Reading policy | existing mute/duck/silence and dwell contracts | Unchanged |

The Data Adapter remains upstream of the score. No manuscript text, reader data or new semantic input enters the audio renderer.

## Implemented sound changes

### Continuous timbral dynamics

`OrchestralDynamics` evaluates velocity plus authored `expression` and `brightness` throughout a held note at 32 Hz. It produces bounded effort/colour curves used by both explicit orchestral synthesis and sustained native samples. Synth voices build a sufficiently rich band-limited waveform, then move a family-aware low-pass curve over the sustain. Native recordings receive a gentler per-voice colour curve on top of their existing equal-power attack-layer selection; this does not claim to recreate missing recorded p/f layers.

The curve contains a short onset bloom and a small intra-note arc. These are deterministic musical heuristics, not calibrated bow-pressure, breath-pressure or psychoacoustic models. Short, pizzicato, staccato, spiccato and one-shot voices are not converted into artificial sustains. Recorded one-shots remain unchanged by this layer.

### Connected phrase transitions

The orchestral plan now links only a current monophonic `legato` note to a previous monophonic note when the authored gap is between −120 and +90 ms and the interval is no larger than an octave. Polyphonic events, rests, non-legato attacks and decaying/modal instruments do not receive the link.

For a linked synthesized note the attack and bow/breath-like excitation are reduced, the previous release remains available for overlap, and pitch reaches the target through an 18–55 ms bounded transition. This is a synthetic connected gesture, **not** recorded true legato. Native packs still use the existing stricter rule: “true legato” is allowed only when their manifest declares and supplies the exact physical transition sample; otherwise the engine uses the already documented phrase crossfade without changing that claim.

### Concert stage V3

The directional seating and four image-source early arrivals remain. The shared late field is now a 3.6-second original deterministic design with:

- sparse-to-dense reflection bloom;
- two decay slopes rather than one white-noise exponential tail;
- controlled inter-channel common energy plus decorrelation;
- low-frequency-stable diffusion and slow bounded air modulation;
- 26 ms predelay and 8.1 kHz damping to preserve attacks and avoid brittle brass/string tails.

Live and offline paths still share `NativeRenderGraph`, acoustic stage, room, compressor and limiter. This is a designed virtual hall, not a measured impulse response, binaural HRTF or named physical venue.

## Safety and computational bounds

| Bound | Value |
|---|---:|
| Continuous-control rate | 32 Hz |
| Dynamic points per note | 4,096 maximum |
| Synth sources including release tails | 192 maximum |
| Waveform cache per `AudioContext` | 128 entries |
| Late-field impulse | 3.6 s maximum |
| Preview / Studio / synthetic Master | 32 / 48 / 96 kHz |
| Dynamic filter ceiling | 44% of sample rate |

The existing decoded-sample and offline-render memory limits, realtime look-ahead, cancellation, explicit playback gesture, reader monitoring level and silence/duck policy remain. Source admission includes release tails. No `Math.random`, network fetch or third-party model is used during synthesis.

## Reproducible technical validation

Run on Node 20:

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run test:audio:render
npm run build
npm run check:bundle
```

The validation covers deterministic/bounded control curves; interrupted ramps; Nyquist safety at 32/48/96 kHz; preserved pitches; link eligibility; real PCM upper-partial opening during a crescendo; reduced incoming legato excitation; target pitch arrival; native sustained colour; bit-equivalent one-shot behaviour; source budget; finite stereo render; loudness, peak, estimated 4× true peak, DC and clipping.

Reference 8-track Studio render after V2:

| Measurement | Result |
|---|---:|
| Duration including tail | 19 s |
| Integrated loudness | −20.949 LUFS |
| Sample peak | −6.811 dBFS |
| 4× interpolated peak estimate | −6.805 dBTP |
| Clipped samples | 0 |
| DC offset | 0.00000206 |
| Stereo side/mid RMS | 0.3274 |
| Channel correlation | 0.8953 |
| WAV size | 5,472,044 bytes |

Repeated Studio SHA-256: `fb1397f916f58b6ce1e900fdcc275718c66b19cf103dcfd10abbcb727c5e1298`. Preview measured −20.884 LUFS / −6.939 dBFS; synthetic Master measured −21.128 LUFS / −7.261 dBFS. These are implementation/environment observations, not cross-browser bit-identity or mastering-laboratory certification.

## A/B and physical-device lab

`npm run test:audio:browser` builds a loopback-only lab. It checks production playback controls plus deterministic 32/48/96 kHz renders, creates a blind Orquesta V2/builtin comparison, attenuates both references to the quieter integrated-loudness value, and hides the mapping until “Revelar referencias”. The page includes a Poco X7 Pro checklist for solo/tutti, headphones/speaker, mute/duck, pause/resume/stop and ghost-tail detection.

Automated PCM checks are not a listening vote. Physical-device listening and browser transport still have to be performed before claiming perceptual realism, a concert-hall illusion or target-phone performance.

## Source and license decisions

No new sample, score, impulse response or model weight was imported.

| Source reviewed | Decision | Reason |
|---|---|---|
| [OpenAIR — Arthur Sykes Rymer Auditorium](https://www.openair.hosted.york.ac.uk/?page_id=425) | Defer | The page declares CC BY 4.0 and is a viable future candidate, but no exact channel/position choice, asset hash, size budget or device A/B was completed in this slice. |
| [Isophonics room IR dataset](https://isophonics.net/content/room-impulse-response-data-set.html) | Exclude | CC BY-NC-SA is incompatible with the intended commercial redistribution path. |
| [EchoThief downloads](https://www.echothief.com/downloads/) | Exclude | The site exposes downloads and copyright attribution but the reviewed page does not grant a clear raw-IR redistribution license. |
| [Web Audio API](https://www.w3.org/TR/webaudio-1.1/) | Adopt as API reference | Existing browser API only; no copied audio or implementation asset. |

The timbre, dynamics, transition and room code in this change is original repository work under MIT. Existing curated native-pack licenses and the empty hybrid Master-approval registry are unchanged.

## Remaining evidence gap

V2 materially improves renderer behaviour, but does not prove a full-size acoustic orchestra, player individuality, bow direction, physical mutes, recorded dynamic-layer morphing, measured hall acoustics or indistinguishability from performers. The next evidence-bearing step is a matched, blind device session using real native banks and a separately reviewed CC BY hall candidate; only a versioned human review should promote a hybrid or measured-room profile toward Master.
