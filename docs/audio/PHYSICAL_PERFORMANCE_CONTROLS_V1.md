# Physical Performance Controls v1

Tloque's acoustic engine uses one semantic performance state across sampled+physical hybrid families.

## Compatibility with TLOQUE_SCORE 2.1

No new score tokens are required in this version. Existing controls remain valid and are translated deterministically:

- `expression` → player pressure / excitation strength.
- `brightness` → bow or pluck position for strings/plucked instruments, and embouchure/tone geometry for winds/brass.
- `pedal=down|up` → continuous pedal/damper state for sympathetic-resonance instruments.
- expression + pedal → sympathetic coupling strength.
- `vibrato` and `bend` remain direct continuous performance controls.

This is a compatibility bridge, not a claim that brightness and bow position are universally identical. A future `TLOQUE_SCORE 2.2` may expose dedicated `pressure`, `embouchure`, `bowPosition`, `pluckPosition`, `damper`, and `coupling` commands while preserving 2.1 behavior.

## Family semantics

### Bowed strings

The recorded sample owns attack and instrument identity. The physical overlay uses pressure, bow position, sympathetic coupling, vibrato and pitch bend to shape bow friction, harmonic balance, string feedback and body modes. Pizzicato/spiccato/staccato remain sample-only.

### Winds and brass

The recorded sample owns attack, reed/lip identity and recorded articulation. Pressure controls excitation/breath; embouchure changes damping, harmonic balance, feedback stability and formant placement. Short attacks remain sample-only.

### Piano, celesta, harp and acoustic guitar

The recorded transient remains untouched. The physical layer starts after the attack and uses pedal/damper, pluck-position/tone and sympathetic coupling to control body modes and decay. Tloque does not synthesize a replacement hammer, mallet or pluck attack.

### Full reed models

English Horn and Contrabassoon remain full physical models because no redistribution-clean Master sample base has been accepted. Their existing expression/brightness/vibrato/bend controls already map to pressure, bore/radiation behavior and embouchure-like tone shaping; they remain governed by their dedicated model calibration gate.

## Master policy

Hybrid overlays are Studio until they pass both stages:

1. Objective sampled-vs-hybrid screening for transient preservation, sustain continuity, dynamic preservation, bounded spectral deviation and controlled tail extension.
2. Human A/B review where the hybrid version is explicitly preferred.

Evidence is tied to the exact hybrid `engineVersion`. Changing the engine invalidates prior approval. Local Acoustic Lab reports do not self-promote code to Master; reviewed JSON evidence must be versioned in the repository approval registry.
