# Orchestra Conductor V6

> Historical ensemble contract. Current rendering uses [Orchestra Conductor V7](./ORCHESTRA_CONDUCTOR_V7.md), which preserves musical-onset grouping, measures gaps after sounding-note ends and keeps conductor gestures inside recorded envelopes and physical-control ramps.

Orchestra Conductor V6 adds one deterministic ensemble decision above Intelligent Performer V5. V5 remains responsible for the gesture of each musician; V6 remembers what the ensemble was doing and coordinates balance, colour, attacks, releases and section spread. It does not parse manuscripts, generate notes or mutate a compiled score.

## Versioned contracts

| Layer | Version | Responsibility |
|---|---|---|
| Ensemble contract | `tloque-orchestra-conductor-v6` | Bounded renderer-neutral ensemble state |
| Ensemble rules | `tloque-orchestra-conductor-rules-v1-ensemble-memory` | Density, memory, phase and role balance |
| Universal director | `tloque-universal-performance-director-v4-orchestra-conductor` | V5 musician gesture plus V6 ensemble decision |
| Bank-free synth | `tloque-orchestral-synth-v4-orchestra-conductor` | Consume V6 in spectral and physical voices |
| Hybrid performance | `tloque-native-hybrid-performance-v5-orchestra-conductor` | Transport the same V6 decision to overlays |
| Bowed overlay | `bowed-string-overlay-v4-orchestra-conductor` | Conducted continuous string body |
| Air overlay | `air-column-overlay-v1.3-orchestra-conductor` | Conducted air-column body |
| Shared live/WAV profile | `tloque-score-audio-v8-orchestra-conductor` | Render-path parity marker |

## Decision model

The conductor groups simultaneous onsets, measures active tracks and notes, and carries a bounded energy memory between groups. An explicit audible gap attenuates that memory; a new section establishes a fresh bounded state. Every simultaneous event receives the same ensemble energy, memory, density and phase.

The track role changes only balance. Melody receives a small lift in dense writing, while harmony, pulse and texture make bounded room. Bass remains conservative. A `strings.*-section` track also receives deterministic intra-section timing and pitch spread; solo instruments receive none.

All values are finite and clamped:

| Value | Range |
|---|---:|
| Ensemble and memory energy | `0.08..1` |
| Density | `0..1` |
| Role balance | `0.86..1.08` |
| Colour | `0.94..1.06` |
| Attack cohesion | `0.90..1.08` |
| Release cohesion | `0.94..1.12` |
| Section time spread | `0..4 ms` |
| Section pitch spread | `0..3 cents` added to the existing ensemble spread |

## Renderer policy

- `humanize=0` preserves exact event time, duration and velocity. V5 and V6 still shape the renderer.
- Native samples remain dominant. V6 can attenuate a subordinate hybrid overlay, but it cannot raise its registered wet ceiling.
- One-shot attacks keep their source envelope.
- Recorded true legato is used only when the manifest and bank contain the exact transition.
- Realtime, WAV and runtime budgeting compile the same V5 and V6 maps.
- The 192-source mobile ceiling and existing render-memory caps remain unchanged.

## Validation status

Automated tests cover determinism, bounds, shared simultaneous state, role hierarchy, silence response, score immutability, `humanize=0`, hybrid transport, section symmetry and finite unclipped PCM. These checks establish implementation safety, not perceptual realism. Master remains gated by version-matched objective evidence and blind human A/B review on the target playback devices.
