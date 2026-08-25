# Hybrid calibration promotion checklist

A candidate from the Acoustic Lab is experimental. Before promoting it into a registered engine profile:

1. Confirm the candidate improves `passingCells` or worst normalized margin without creating a new worse failure.
2. Inspect the triggering cell and verify the changed axes are physically plausible for that family.
3. Re-run the same 3x3 matrix at least once to exclude a one-off render/noise artifact.
4. Promote only the tuning values that materially contributed to the improvement.
5. Translate the temporary scales into the family/instrument profile; do not retain `calibrationTuning` in `NATIVE_HYBRID_SOURCES`.
6. Increment the relevant `engineVersion` because acoustic behavior changed.
7. Invalidate all previous approval evidence for that engine version.
8. Run a fresh 3x3 matrix and blind A/B against sample-only.
9. Require the normal Master evidence gate. A `calibrationCandidateId` can never pass Master.

The calibrator is a bounded search assistant, not an automatic deployment mechanism.
