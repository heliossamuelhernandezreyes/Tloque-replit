# Blind hybrid A/B · TloqueScore 2.2

Hybrid Master evidence now requires a genuinely blind human comparison.

## Procedure

1. Generate a new A/B run in Acoustic Lab.
2. Tloque renders the verified sample-only reference and the same score with the registered physical overlay.
3. The UI randomly assigns those renders to labels `A` and `B` using browser cryptographic randomness when available.
4. The reviewer can listen to A and B without seeing which engine is behind either label.
5. The reviewer chooses A, B, or tie.
6. The vote is locked and only then does the UI reveal `A = sampled|hybrid` and `B = sampled|hybrid`.
7. A new run is required for another vote.

The saved report records the resolved real preference plus `humanReviewMode="blind-ab"`. Reports from the older labeled workflow, legacy reports without a review mode, ties, sample preferences, failed objective metrics, or reports from another engine version cannot approve Master.

## Probe contract

The A/B probe now exercises TloqueScore 2.2 physical controls appropriate to each family:

- bowed strings: `pressure`, `bow`, `coupling`;
- winds/brass: `pressure`, `embouchure`;
- piano/celesta: `pedal`, `damper`, `coupling`;
- harp/guitar: `pluck`, `damper`, `coupling`.

A remains sample-only. B is the identical sampled render plus the exact family-correct overlay. The automatic metrics remain screening criteria only; the blind listening decision is a separate required evidence axis.
