# Physical control automation parity

This revision completes continuous TloqueScore 2.2 control automation for the two hybrid families that still had partial in-note behavior.

## Air column · `air-column-overlay-v1.1`

`pressure` now continuously drives excitation, fundamental level, harmonic balance, breath and bore feedback. `embouchure` continuously drives harmonic balance, breath, damping and all modeled formant frequencies. Persistent `brightness` is resolved at each control point instead of falling back to the event-start value when a later control omits brightness.

## Sympathetic resonance · `sympathetic-resonance-v1.1`

`pressure`, `pluck`, `coupling`, `pedal` and `damper` now continuously drive absolute physical targets. Pedal/damper changes affect body gain, damping, wet level and the final resonant tail. Partial/body targets are calculated from immutable profile values, preventing repeated controls from multiplying already-modified gains.

The final tail is determined from the known physical state at note release, so a pedal or damper change during the note can legitimately alter decay without creating an unbounded oscillator lifetime.

## Evidence policy

This historical revision changed the air-column and sympathetic families. Bowed strings remained `bowed-string-overlay-v1` at that point; Orchestral Hybrid V4 later supersedes it with `bowed-string-overlay-v2-continuous-waveguide` and intentionally invalidates the earlier A/B evidence.

All revised overlays remain Studio-only until the exact new engine version passes objective sampled-vs-hybrid screening and human A/B review.
