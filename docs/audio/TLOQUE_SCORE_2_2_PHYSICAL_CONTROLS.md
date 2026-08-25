# TloqueScore 2.2 · physical controls

The source header remains `TLOQUE_SCORE 2`. New compilations emit `tloque-score-compiler-v2.2`; stored `v2` and `v2.1` recipes remain valid.

Dedicated physical axes are written on normal `control` lines:

```tloque-score
control 1:1 pressure=0.72 bow=0.28 coupling=0.45 ramp=0.5
control 2:1 embouchure=0.62 pressure=0.58 ramp=0.25
control 3:1 pedal=down damper=0.08 coupling=0.86
control 4:1 pluck=0.34 damper=0.55 coupling=0.42
```

All dedicated physical values use `0..1`.

- `pressure`: excitation pressure/energy. Used by bowed strings, winds and brass.
- `embouchure`: mouth/reed/lip configuration axis for winds and brass.
- `bow`: normalized bow contact/position axis for bowed strings.
- `pluck`: normalized pluck/contact position for harp and guitars.
- `damper`: damping amount; `0` is open/free, `1` is strongly damped.
- `coupling`: sympathetic/body coupling amount.
- `pedal=down|up` remains available and supplies pedal state. Explicit `damper` or `coupling` can refine the pedal-derived defaults.

## Compatibility

When a dedicated field is absent, Tloque keeps the v2.1 bridge:

- `expression` -> physical pressure.
- `brightness` -> bow/pluck position or embouchure depending on family.
- `pedal` -> damper and sympathetic coupling defaults.

Dedicated values are sparse persistent overrides. `pressure=0.8` changes only pressure; a later `brightness=` change does not overwrite it. The override remains active until another explicit `pressure=` control appears.

The expressive controls still keep their original musical meaning. Physical axes should be used only when the score needs a performance gesture that cannot be expressed honestly through expression, brightness, articulation, velocity or recorded timbre.

## Family guidance

Bowed strings: prefer `pressure`, `bow`, and optionally `coupling`. Do not use physical controls to fake pizzicato or a recorded articulation that exists in the sample pack.

Woodwinds and brass: prefer `pressure` and `embouchure`; keep values smooth and use `ramp` for phrase-shaped changes.

Piano/celesta: use `pedal`, `damper`, and `coupling`. The sampled attack remains authoritative; the physical layer is resonance/body behaviour.

Harp/guitar: use `pluck`, `damper`, and `coupling`. Do not increase coupling merely to make the instrument louder.

Master policy is unchanged: dedicated controls do not auto-approve a physical/hybrid engine. Master still requires the exact engine version to satisfy its source/evidence gate; otherwise Tloque preserves the validated sample base.
