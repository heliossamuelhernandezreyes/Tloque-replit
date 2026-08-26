# Winter Stress Benchmark v1

## Purpose

`violin-winter-stress-v1` is a deterministic musical stress audition for `strings.violin`. It exists to answer a different question from the 3×3 register/gesture matrix:

> When the violin is pushed through difficult musical gestures, does Hybrid still sound preferable to the exact same sampled performance?

The benchmark is original material. It is inspired only by the performance demands associated with fast baroque violin writing; it does not transcribe or reconstruct a composition.

## What it stresses

1. **Repeated attacks** — checks whether the physical overlay blurs or exaggerates sample transients.
2. **Rapid repetition / tremolo-like motion** — exposes metallic buildup, phasing and unstable bow noise.
3. **Connected legato** — checks continuity between notes without hiding the recorded attack.
4. **Register jumps** — exposes changes in resonator behaviour across the instrument.
5. **p → ff rise** — checks whether expression, pressure, bow position and coupling scale musically.
6. **High-register strong passage** — deliberately stresses the area most likely to become synthetic, harsh or spectrally intrusive.

The score uses a fixed seed, `humanize 0`, `quality studio`, one `strings.violin` track and `native-auto`. Sample and Hybrid therefore receive the same score, sample source, timing and mix. The only intended difference is the physical bowed-string layer.

## Relationship to Master certification

Winter Stress v1 is **not a Master gate by itself** and cannot write Master approval evidence.

The certification order for `strings.violin` is:

1. Run the canonical 3×3 Sample vs Hybrid matrix.
2. If it fails, use bounded local search and keep only a candidate that improves worst-case evidence.
3. Promote a winning tuning into the canonical source profile and increment `engineVersion`.
4. Re-run the complete 3×3 matrix on the exact promoted version.
5. Run a blind human A/B on the canonical matrix.
6. Run Winter Stress v1 as an additional blind musical torture test.
7. If Hybrid loses Winter Stress, do not promote merely because aggregate metrics look good; investigate the offending musical behaviour.
8. Only versioned evidence from the canonical Master workflow may approve the source.

## Interpretation

- **Hybrid wins:** strong perceptual evidence that the physical layer survives difficult musical material. Continue with the formal Master gate.
- **Tie:** useful but insufficient evidence. Prefer more listening or another calibrated run.
- **Sample wins:** treat as a regression signal. Do not hide the result by changing the blind assignment or averaging it away.

The benchmark deliberately complements, rather than replaces, objective metrics. The 3×3 matrix tells us *where* the engine fails; Winter Stress tells us whether the failure is musically obvious when the instrument is under pressure.
