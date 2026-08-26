import { compileTloqueScore } from "./audio"

export const VIOLIN_WINTER_STRESS_ID = "violin-winter-stress-v1" as const
export const VIOLIN_WINTER_STRESS_INSTRUMENT = "strings.violin" as const
export const VIOLIN_WINTER_STRESS_SEED = 20260825

export const VIOLIN_WINTER_STRESS_SEGMENTS = [
  { id: "frost-attacks", label: "Ataques repetidos", stress: "transient-repeat" },
  { id: "bow-tremor", label: "Tremolo mecánico", stress: "rapid-repetition" },
  { id: "legato-thread", label: "Hilo legato", stress: "connected-bow" },
  { id: "register-leaps", label: "Saltos de registro", stress: "register-jump" },
  { id: "dynamic-rise", label: "Ascenso p→ff", stress: "dynamic-ramp" },
  { id: "high-pressure", label: "Agudo bajo presión", stress: "high-register-strong" },
] as const

/**
 * Material original de estrés inspirado únicamente en las exigencias violinísticas
 * asociadas con repertorio barroco rápido. No transcribe ni reconstruye una obra.
 * La partitura es deliberadamente determinista para que Sample vs Hybrid difieran
 * sólo por la capa física del motor.
 */
export function violinWinterStressScoreV1() {
  return `TLOQUE_SCORE 2
title "Tloque Winter Stress v1 · violin"
tempo 168
meter 4/4
loop false
seed ${VIOLIN_WINTER_STRESS_SEED}
humanize 0
quality studio
module native-auto
track solo synth=pad instrument=${VIOLIN_WINTER_STRESS_INSTRUMENT} program=40 role=melody gain=0.32 pan=0 attack=0.012 release=0.85 expression=0.58 brightness=0.54 vibrato=0.045 timbre=natural

section frost-attacks form=development bars=2 repeat=1 fade=0 tempo=168 rubato=0
use solo
1:1 E5 0.25 velocity=0.42 articulation=normal
1:1.5 E5 0.25 velocity=0.58 articulation=normal
1:2 G5 0.25 velocity=0.48 articulation=normal
1:2.5 E5 0.25 velocity=0.64 articulation=normal
1:3 B5 0.25 velocity=0.52 articulation=normal
1:3.5 G5 0.25 velocity=0.70 articulation=normal
1:4 E5 0.25 velocity=0.56 articulation=normal
1:4.5 B4 0.25 velocity=0.74 articulation=normal
2:1 F#5 0.25 velocity=0.46 articulation=normal
2:1.5 F#5 0.25 velocity=0.62 articulation=normal
2:2 A5 0.25 velocity=0.50 articulation=normal
2:2.5 F#5 0.25 velocity=0.68 articulation=normal
2:3 C#6 0.25 velocity=0.56 articulation=normal
2:3.5 A5 0.25 velocity=0.76 articulation=normal
2:4 F#5 0.25 velocity=0.60 articulation=normal
2:4.5 C#5 0.25 velocity=0.80 articulation=normal
end

section bow-tremor form=development bars=2 repeat=1 fade=0 tempo=168 rubato=0
use solo
control 1:1 expression=0.62 brightness=0.60 vibrato=0.035 pressure=0.58 bow=0.42 coupling=0.46 ramp=0.10
1:1 A5 0.20 velocity=0.58 articulation=normal
1:1.25 A5 0.20 velocity=0.62 articulation=normal
1:1.5 A5 0.20 velocity=0.56 articulation=normal
1:1.75 A5 0.20 velocity=0.66 articulation=normal
1:2 A5 0.20 velocity=0.60 articulation=normal
1:2.25 A5 0.20 velocity=0.64 articulation=normal
1:2.5 A5 0.20 velocity=0.58 articulation=normal
1:2.75 A5 0.20 velocity=0.68 articulation=normal
1:3 C6 0.20 velocity=0.62 articulation=normal
1:3.25 C6 0.20 velocity=0.66 articulation=normal
1:3.5 C6 0.20 velocity=0.60 articulation=normal
1:3.75 C6 0.20 velocity=0.70 articulation=normal
1:4 B5 0.20 velocity=0.64 articulation=normal
1:4.25 B5 0.20 velocity=0.68 articulation=normal
1:4.5 B5 0.20 velocity=0.62 articulation=normal
1:4.75 B5 0.20 velocity=0.72 articulation=normal
control 2:1 expression=0.76 brightness=0.70 vibrato=0.045 pressure=0.72 bow=0.30 coupling=0.58 ramp=0.12
2:1 D6 0.20 velocity=0.70 articulation=normal
2:1.25 D6 0.20 velocity=0.74 articulation=normal
2:1.5 D6 0.20 velocity=0.68 articulation=normal
2:1.75 D6 0.20 velocity=0.78 articulation=normal
2:2 C6 0.20 velocity=0.72 articulation=normal
2:2.25 C6 0.20 velocity=0.76 articulation=normal
2:2.5 C6 0.20 velocity=0.70 articulation=normal
2:2.75 C6 0.20 velocity=0.80 articulation=normal
2:3 B5 0.20 velocity=0.74 articulation=normal
2:3.25 B5 0.20 velocity=0.78 articulation=normal
2:3.5 B5 0.20 velocity=0.72 articulation=normal
2:3.75 B5 0.20 velocity=0.82 articulation=normal
2:4 A5 0.20 velocity=0.76 articulation=normal
2:4.25 A5 0.20 velocity=0.80 articulation=normal
2:4.5 A5 0.20 velocity=0.74 articulation=normal
2:4.75 A5 0.20 velocity=0.84 articulation=normal
end

section legato-thread form=development bars=2 repeat=1 fade=0 tempo=144 rubato=0
use solo
control 1:1 expression=0.58 brightness=0.48 vibrato=0.070 pressure=0.48 bow=0.58 coupling=0.50 ramp=0.20
1:1 D5 1 velocity=0.56 articulation=legato
1:2 F#5 1 velocity=0.58 articulation=legato
1:3 A5 1 velocity=0.60 articulation=legato
1:4 C6 1 velocity=0.62 articulation=legato
2:1 B5 1 velocity=0.60 articulation=legato
2:2 G5 1 velocity=0.58 articulation=legato
2:3 E5 1 velocity=0.56 articulation=legato
2:4 D5 1 velocity=0.54 articulation=legato
end

section register-leaps form=development bars=2 repeat=1 fade=0 tempo=160 rubato=0
use solo
1:1 G4 0.50 velocity=0.54 articulation=normal
1:2 E6 0.50 velocity=0.70 articulation=normal
1:3 B4 0.50 velocity=0.58 articulation=normal
1:4 G6 0.50 velocity=0.74 articulation=normal
2:1 D5 0.50 velocity=0.60 articulation=normal
2:2 F#6 0.50 velocity=0.78 articulation=normal
2:3 A4 0.50 velocity=0.62 articulation=normal
2:4 E6 0.50 velocity=0.80 articulation=normal
end

section dynamic-rise form=development bars=2 repeat=1 fade=0 tempo=152 rubato=0
use solo
control 1:1 expression=0.28 brightness=0.38 vibrato=0.035 pressure=0.30 bow=0.70 coupling=0.24 ramp=0
1:1 E5 0.75 velocity=0.24 articulation=normal
1:2 F#5 0.75 velocity=0.32 articulation=normal
control 1:3 expression=0.42 brightness=0.46 pressure=0.42 bow=0.60 coupling=0.34 ramp=0.35
1:3 G5 0.75 velocity=0.40 articulation=normal
1:4 A5 0.75 velocity=0.50 articulation=normal
control 2:1 expression=0.62 brightness=0.58 vibrato=0.060 pressure=0.58 bow=0.46 coupling=0.48 ramp=0.35
2:1 B5 0.75 velocity=0.62 articulation=normal
2:2 C6 0.75 velocity=0.74 articulation=normal
control 2:3 expression=0.88 brightness=0.78 vibrato=0.085 pressure=0.84 bow=0.24 coupling=0.68 ramp=0.35
2:3 D6 0.75 velocity=0.86 articulation=normal
2:4 E6 0.90 velocity=0.96 articulation=normal
end

section high-pressure form=climax bars=2 repeat=1 fade=0 tempo=176 rubato=0
use solo
control 1:1 expression=0.88 brightness=0.82 vibrato=0.090 pressure=0.88 bow=0.18 coupling=0.72 ramp=0.15
1:1 E6 0.35 velocity=0.88 articulation=normal
1:1.5 B6 0.35 velocity=0.94 articulation=normal
1:2 F#6 0.35 velocity=0.90 articulation=normal
1:2.5 C7 0.35 velocity=0.96 articulation=normal
1:3 G6 0.35 velocity=0.91 articulation=normal
1:3.5 D7 0.35 velocity=0.97 articulation=normal
1:4 A6 0.35 velocity=0.92 articulation=normal
1:4.5 E7 0.35 velocity=0.98 articulation=normal
control 2:1 expression=0.76 brightness=0.70 vibrato=0.070 pressure=0.72 bow=0.28 coupling=0.58 ramp=0.15
2:1 D7 0.35 velocity=0.90 articulation=normal
2:1.5 B6 0.35 velocity=0.88 articulation=normal
2:2 G6 0.35 velocity=0.86 articulation=normal
2:2.5 E6 0.35 velocity=0.84 articulation=normal
2:3 B5 0.50 velocity=0.80 articulation=normal
2:3.75 G5 0.50 velocity=0.76 articulation=normal
2:4.5 E5 0.50 velocity=0.72 articulation=normal
end`
}

export function compileViolinWinterStressV1() {
  return compileTloqueScore(violinWinterStressScoreV1())
}
