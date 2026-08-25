# Hybrid Local Search v1

Hybrid Local Search extends the semi-automatic calibration coach without allowing unconstrained optimization.

For a failed 3x3 register × gesture report, Tloque first derives the same family-specific causal hypothesis used by the single-candidate calibrator. It then evaluates three bounded strengths around that hypothesis:

- gentle: 0.65x of the proposed move away from neutral
- nominal: 1.00x
- assertive: 1.30x

Every physical tuning axis is re-clamped through the shared HybridCalibrationTuning bounds before rendering. Candidates are rendered sequentially to keep mobile memory pressure bounded. The search may stop early when a candidate reaches 9/9 passing cells with a positive worst normalized margin.

Selection is lexicographic and worst-case oriented:

1. more passing 3x3 cells wins;
2. if passing-cell count ties, the larger worst normalized metric margin wins;
3. if no candidate beats the baseline, there is no winner and the current production profile is retained.

No averages are used to hide a weak register/gesture cell.

All local-search reports remain calibration candidates and therefore carry calibrationCandidateId. They are not Master evidence. A winning candidate is only a promotion recommendation. Promotion still requires deliberately incorporating the tuning into the real family/instrument profile, bumping engineVersion, then running a fresh full 3x3 blind A/B with no calibrationCandidateId.
