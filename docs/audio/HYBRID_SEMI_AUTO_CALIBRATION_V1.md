# Hybrid semi-automatic calibration v1

Tloque can now turn a failed 3×3 hybrid A/B matrix into a bounded temporary tuning candidate.

## Loop

1. Run the normal blind A/B matrix.
2. Find the single worst failing cell+metric.
3. Map that failure to a conservative wet-level direction:
   - spectral intrusion, damaged attack or damaged dynamics -> reduce wet;
   - insufficient continuity or insufficient tail -> increase wet.
4. Clamp every proposal to a narrow range around the registered source; no optimizer can jump to arbitrary gains.
5. Re-render the exact same 3×3 matrix with a cloned source carrying only the candidate wet value.
6. Compare passing cells and worst normalized margin before/after.
7. Reject candidates that do not improve the worst-case objective result.

## Governance

A calibration candidate is experimental evidence, not a new engine revision. Candidate reports carry `calibrationCandidateId`, and `hybridMasterEvidenceValid()` explicitly rejects any report carrying one. A successful candidate must be promoted deliberately into the registered source and accompanied by an engine-version bump before a fresh blind A/B run can become Master evidence.

This prevents browser-local optimizer output from silently changing production sound or certifying itself.

## Scope of v1

V1 tunes only the global physical overlay wet level because it is shared by all three current physical-layer families and has a predictable monotonic effect on intrusion vs contribution. The report still identifies the precise register, gesture and metric that triggered the proposal. Later revisions may add bounded family-specific dimensions (feedback, damping, formant/brightness balance) only after their effect is independently measurable and versioned.
