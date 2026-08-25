# Hybrid render parity v1

Realtime playback, offline A/B validation and final WAV export must route every hybrid family through the same physical-overlay dispatcher.

Rules:

- `bowed-string-resonator` -> bowed-string overlay.
- `air-column-resonator` -> air-column overlay.
- `sympathetic-resonance` -> sympathetic-resonance overlay.
- The A/B reference render A is always sample-only.
- Candidate B uses the exact registered overlay for that instrument family.
- Studio playback/export may use registered Studio overlays.
- Master playback/export uses a hybrid overlay only when the exact `engineVersion` has approved, versioned A/B evidence. Otherwise it preserves the validated sample base.
- Full physical models without a sample base keep their separate strict Master evidence gate.

This contract exists to prevent family fallthrough (for example piano/celesta/harp/guitar accidentally using the air-column model) and to keep realtime and exported audio semantically aligned.
