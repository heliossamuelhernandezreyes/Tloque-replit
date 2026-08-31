/** Original short validation score, not a musical/realism certification. */
export const ORCHESTRAL_QA_SCORE = `TLOQUE_SCORE 2
title "Tloque — espacio y respiración"
tempo 80
meter 4/4
loop false
seed 20260831
humanize 0.2
quality studio
module orchestra-synth
track violins synth=pad instrument=strings.violin-section program=48 role=harmony gain=0.34 pan=0 attack=0.12 release=0.6 expression=0.8 brightness=0.55 vibrato=0.28
track cello synth=bass instrument=strings.cello program=42 role=bass gain=0.35 pan=0 attack=0.08 release=0.5 expression=0.8 brightness=0.35 vibrato=0.15
track flute synth=warm instrument=woodwinds.flute program=73 role=melody gain=0.28 pan=0 attack=0.06 release=0.3 expression=0.8 brightness=0.5 vibrato=0.25
track clarinet synth=warm instrument=woodwinds.clarinet program=71 role=harmony gain=0.22 pan=0 attack=0.04 release=0.3 expression=0.75 brightness=0.4 vibrato=0.1
track horn synth=warm instrument=brass.horn program=60 role=harmony gain=0.25 pan=0 attack=0.08 release=0.4 expression=0.65 brightness=0.4 vibrato=0.06
track piano synth=warm instrument=piano.grand program=0 role=accent gain=0.3 pan=-0.1 attack=0.006 release=0.6 expression=0.8 brightness=0.55 vibrato=0
track harp synth=pluck instrument=strings.harp program=46 role=texture gain=0.28 pan=-0.1 attack=0.006 release=0.8 expression=0.75 brightness=0.5 vibrato=0
track timpani synth=bass instrument=percussion.timpani program=47 role=accent gain=0.24 pan=0 attack=0.006 release=0.5 expression=0.7 brightness=0.35 vibrato=0
section space form=exposition bars=4 repeat=1 fade=0 tempo=80 rubato=0.04
use violins
control 1:1 expression=0.45 ramp=0
control 1:2 expression=0.85 ramp=6
control 3:2 expression=0.5 ramp=6
1:1 C4,E4,G4 4 velocity=0.45 articulation=legato
2:1 C4,F4,A4 4 velocity=0.52 articulation=legato
3:1 B3,D4,G4 4 velocity=0.65 articulation=legato
4:1 C4,E4,G4 4 velocity=0.42 articulation=tenuto
use cello
1:1 C3 4 velocity=0.5 articulation=legato
2:1 F2 4 velocity=0.5 articulation=legato
3:1 G2 4 velocity=0.6 articulation=legato
4:1 C3 4 velocity=0.4 articulation=tenuto
use flute
1:2 E5 1 velocity=0.42 articulation=legato
1:3 G5 2 velocity=0.48 articulation=legato
2:1 A5 2 velocity=0.5 articulation=legato
2:3 G5 1 velocity=0.42
3:2 D5 1 velocity=0.5 articulation=legato
3:3 B4 2 velocity=0.44 articulation=legato
4:1 C5 3 velocity=0.38 articulation=tenuto
use clarinet
1:1 G3 4 velocity=0.4
2:1 A3 4 velocity=0.45
3:1 D4 4 velocity=0.5
4:1 G3 4 velocity=0.35
use horn
2:1 F3 4 velocity=0.4
3:1 G3,B3 4 velocity=0.55
4:1 E3,G3 4 velocity=0.38
use piano
1:1 C4,E4,G4 1 velocity=0.5
3:1 B3,D4,G4 1 velocity=0.6
4:1 C4,E4,G4 2 velocity=0.4
use harp
1:1 C4 1 velocity=0.4
1:2 E4 1 velocity=0.4
1:3 G4 1 velocity=0.4
1:4 C5 1 velocity=0.4
4:1 C4 1 velocity=0.35
4:2 E4 1 velocity=0.35
4:3 G4 1 velocity=0.35
use timpani
1:1 C3 1 velocity=0.3
3:1 G2 1 velocity=0.5
4:1 C3 1 velocity=0.3
end`
