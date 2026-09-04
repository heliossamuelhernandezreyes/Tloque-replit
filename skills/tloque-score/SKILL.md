---
name: tloque-score
description: Write, revise, repair, or explain deterministic instrumental TloqueScore 2 for Tloque's Audio Laboratory. Use when an AI must turn a musical request into valid score code, orchestrate semantic instruments, select orchestral synthesis or native rendering, add physical performance controls, or fix compiler diagnostics.
metadata:
  version: "3.1.0"
  compiler: "tloque-score-compiler-v2.2"
---

# TloqueScore 2 · instrucciones para IA

## Tu trabajo, en una frase

Convierte lo que pide el usuario en **una partitura instrumental válida**, completa y lista para pegar en el Laboratorio de Tloque.

## Regla de salida

Cuando el usuario pida crear, cambiar o reparar una obra:

1. Devuelve **un solo bloque** con etiqueta `tloque-score`.
2. La primera línea del bloque debe ser exactamente `TLOQUE_SCORE 2`.
3. No escribas explicaciones antes ni después del bloque.
4. Dentro del bloque no escribas Markdown, JavaScript, letras, voces, URLs ni comandos inventados.
5. Devuelve la obra completa. Nunca devuelvas un parche o sólo las líneas cambiadas.

Si el usuario sólo pide una explicación, puedes responder con prosa y no necesitas crear una partitura.

## Compatibilidad actual

- Skill: `3.1.0`
- Lenguaje fuente: `TLOQUE_SCORE 2`
- Compilador: `tloque-score-compiler-v2.2`
- Síntesis orquestal: `orchestra-synth` / `tloque-orchestral-synth-v2.1`
- Dinámica tímbrica continua: `tloque-orchestral-dynamics-v2`
- Director interpretativo: `tloque-universal-performance-director-v2`
- Perfil común live/WAV: `tloque-score-audio-v7-universal-performance`
- Sala estéreo diseñada: `tloque-concert-stage-v3`
- Enrutador de bancos grabados: `native-auto`
- Síntesis clásica heredada: `builtin`

No cambies el encabezado a `TLOQUE_SCORE 2.2` ni a `TLOQUE_SCORE 3`. El encabezado correcto sigue siendo `TLOQUE_SCORE 2`.

## Haz esto, en este orden

### Paso 1 · Entiende el encargo

Decide antes de escribir notas:

- propósito y emoción;
- duración aproximada;
- si debe repetir en bucle;
- tempo y compás;
- forma musical;
- instrumentos y función de cada uno;
- fuente de interpretación.

Si falta un dato, elige un valor musical razonable. No detengas la composición por detalles pequeños.

### Paso 2 · Elige una sola fuente

| Si el usuario necesita… | Escribe… | Significa… |
|---|---|---|
| Una obra orquestal que funcione sin descargar bancos | `module orchestra-synth` | Síntesis orquestal V2. Es la opción recomendada por defecto. |
| Instrumentos grabados y los bancos ya están instalados | `module native-auto` | Cada `instrument=` busca su banco físico verificado. |
| El sonido sintético clásico | `module builtin` | Motor heredado, menos orquestal. |
| Un módulo concreto que el usuario confirmó como instalado | `module id-confirmado` | Usa únicamente el ID exacto dado por el usuario o por Tloque. |

Nunca inventes un ID de módulo. `quality master` con `orchestra-synth` produce un WAV sintético de alta resolución; no certifica que suene como una grabación acústica. `quality master` con `native-auto` exige todos los bancos físicos usados por la obra.

### Paso 3 · Copia esta estructura

Esta plantilla es pequeña, completa y compilable. Sustituye sus valores, tracks y notas; conserva el orden.

```tloque-score
TLOQUE_SCORE 2
title "Título de la obra"
tempo 72
meter 4/4
loop false
seed 20260902
humanize 0.08
quality master
module orchestra-synth

track melody synth=pad instrument=strings.violin program=40 role=melody gain=0.26 pan=0.12 attack=0.08 release=1.2 expression=0.72 brightness=0.56 vibrato=0.12 timbre=natural

section opening form=exposition bars=2 repeat=1 fade=1 tempo=72 rubato=0.04
use melody
control 1:1 expression=0.48 brightness=0.44 pressure=0.52 bow=0.38 coupling=0.30 ramp=0
1:1 E4 2 velocity=0.48 articulation=legato
control 1:3 expression=0.76 brightness=0.62 pressure=0.70 bow=0.54 coupling=0.42 ramp=2
1:3 G4 2 velocity=0.54 articulation=legato
2:1 B4 2 velocity=0.58 articulation=tenuto
2:3 E5 2 velocity=0.50 articulation=normal
end
```

### Paso 4 · Escribe globals, tracks y secciones

El orden siempre es:

1. `TLOQUE_SCORE 2`
2. ajustes globales;
3. todos los `track`;
4. una o más `section`;
5. dentro de cada sección: `use`, controles, notas, silencios o golpes;
6. un único `end` para cerrar cada sección.

No declares un `track` después de abrir la primera sección.

### Paso 5 · Interpreta, no sólo coloques notas

- Da a cada track una función clara: melodía, armonía, bajo, pulso, textura o acento.
- Elige el compás real y el `role=` correcto: el Director usa ambos para decidir jerarquía métrica y cuánto debe sobresalir cada voz.
- Escribe frases con dirección: inicio, crecimiento, punto alto y resolución.
- Usa dinámicas con `expression`, no sólo con `gain`.
- Usa `brightness`, vibrato, articulación, registro y silencios con intención.
- Para un crescendo dentro de una nota larga, coloca un `control` después del inicio de la nota y usa `ramp=`.
- Deja respirar a vientos y metales. Una pista solista de viento debe ser monofónica.
- Escribe `rest` donde el intérprete deba cortar arco, respiración o frase. No confíes en un hueco accidental.
- Evita que todos los instrumentos toquen todo el tiempo.
- Conserva el mismo `seed` al revisar una obra para mantener la interpretación determinista.

### Paso 6 · Revisa antes de responder

Comprueba cada punto:

- [ ] Hay un solo encabezado y dice `TLOQUE_SCORE 2`.
- [ ] Hay entre 1 y 16 tracks, todos declarados antes de las secciones.
- [ ] Hay al menos una sección y al menos una nota o golpe.
- [ ] Cada sección termina una sola vez con `end`.
- [ ] Cada `use` nombra un track existente.
- [ ] Cada compás local está entre `1` y `bars=` de su sección.
- [ ] Cada tiempo cabe en el compás. En 4/4, `4:4.75` es válido y `4:5` no lo es.
- [ ] Cada nota está entre C1 y C8, es decir MIDI 24..108.
- [ ] Cada eje físico corresponde a la familia del instrumento.
- [ ] No hay comandos, instrumentos, timbres o módulos inventados.
- [ ] La respuesta contiene la obra completa en un solo bloque y nada más.

## Gramática exacta

### Ajustes globales

```text
title "Texto de hasta 160 caracteres"
tempo 32..180
meter 2..12/4 | 2..12/8
loop true | false
seed 0..2147483647
humanize 0..1
quality core | studio | master
module builtin | orchestra-synth | native-auto | id-instalado-confirmado
```

Usa `humanize` con moderación. `0.04..0.14` activa variación determinista y el Director Universal V2: segmentación por pista, arco de frase, clímax, pulso fuerte/débil, contorno melódico y respiración/arco según familia. `humanize 0` desactiva esos cambios y conserva tiempo, duración y velocity neutrales. El Director nunca cambia notas, articulaciones o timbres escritos y no convierte síntesis en una grabación real.

### Track

Escribe cada track en una sola línea:

```text
track id synth=warm|pad|bell|pluck|bass instrument=instrumento.id program=0..127 role=melody|harmony|bass|pulse|texture|accent gain=0..1 pan=-1..1 attack=0.001..8 release=0.01..12 expression=0..1 brightness=0..1 vibrato=0..1 timbre=natural|non-vibrato|vibrato|expression-vibrato|mute|harmon-mute|straight-mute
```

El `id` empieza con una letra minúscula y sólo usa minúsculas, números, `_` o `-`. `instrument=` es la identidad semántica; no es la ruta de un archivo ni el ID de almacenamiento de un banco.

### Sección

```text
section id form=exposition|development|recapitulation|coda|interlude|custom bars=1..128 repeat=1..4 fade=0..16 tempo=32..180 rubato=0..0.35
```

- `bars=` es la longitud local antes de repetir.
- `repeat=` repite la sección al compilar.
- El total compilado no puede superar 256 compases.
- Puede haber como máximo 32 secciones.
- Cierra cada sección únicamente con `end`.

### Elegir track

```text
use track-id
```

Todo lo que sigue pertenece a ese track hasta el próximo `use`.

### Nota o acorde

```text
bar:beat C3,Eb3,G3 duration velocity=0.01..1 articulation=normal|legato|staccato|tenuto|accent|spiccato|pizzicato|tremolo|harmonic timbre=...
```

- Una nota: `2:1 G4 2 velocity=0.58 articulation=tenuto`
- Un acorde: `2:1 C3,E3,G3 4 velocity=0.48`
- Usa sostenidos o bemoles como `F#4` o `Bb3`.
- `duration` admite `0.03125..64` tiempos.
- `timbre=` en una nota sustituye el timbre del track sólo para esa nota.
- Un evento admite de 1 a 12 notas.

### Silencio

```text
rest bar:beat duration
```

Ejemplo: `rest 3:3 2`. El silencio es explícito y ayuda a separar frases. No escribas una nota con velocity cero.

### Control expresivo o físico

```text
control bar:beat expression=0..1 brightness=0..1 vibrato=0..1 pedal=down|up bend=-2..2 pressure=0..1 embouchure=0..1 bow=0..1 pluck=0..1 damper=0..1 coupling=0..1 ramp=0..16
```

Una línea necesita al menos un valor. Sólo escribe los valores que cambian. El nuevo valor persiste hasta que otro control del mismo eje lo cambie. `ramp=` expresa la transición en tiempos.

Usa los ejes por familia:

| Familia | Controles adecuados |
|---|---|
| Cuerdas frotadas | `expression`, `brightness`, `vibrato`, `pressure`, `bow`, `coupling` |
| Vientos madera y metales | `expression`, `brightness`, `vibrato`, `pressure`, `embouchure` |
| Piano y celesta | `expression`, `brightness`, `pedal`, `damper`, `coupling` |
| Arpa y guitarras | `expression`, `brightness`, `pluck`, `damper`, `coupling` |

`pressure` no es volumen. `bow` y `pluck` no son un ecualizador genérico. `embouchure` no es un control genérico de tono. `coupling` modela acoplamiento resonante, no un aumento de ganancia. No añadas todos los ejes a todos los instrumentos sólo porque el compilador acepta los números.

### Percusión orquestal sin altura

Primero declara un track con `instrument=percussion.orchestral-kit`. Después usa:

```text
hit bar:beat nombre-del-golpe duration velocity=0.01..1
```

Nombres permitidos:

```text
bass-drum
snare-taps
snare-hit
snare-roll
snare-hit-alt
snare-roll-alt
crash-cymbal
suspended-cymbal
tambourine-shake
tambourine-hit
tambourine-roll
cowbell
suspended-cymbal-stick
triangle-muted-small
triangle-open-small
triangle-muted-large
triangle-open-large
sleigh-bells
```

No conviertas esos nombres en notas falsas. Un golpe de una sola toma conserva su ataque definido por `velocity`; los controles continuos no inventan una interpretación dentro de ese golpe.

## Cómo aprovechar la síntesis orquestal V2

Con `module orchestra-synth`:

- no hacen falta bancos descargados;
- las notas largas responden a cambios continuos de `expression` y `brightness` dentro de la nota;
- notas consecutivas, monofónicas y con `articulation=legato` pueden enlazarse con una transición sintetizada;
- un acorde, un silencio o una interrupción rompe ese enlace;
- esa transición no es true legato grabado y no debes describirla así;
- `strings.violin` representa un solista sintético y `strings.violin-section` una pequeña sección sintética;
- la sala es estéreo y diseñada, no una respuesta de impulso medida, surround ni HRTF personalizada;
- el grafo admite como máximo 192 fuentes simultáneas, incluidas las colas; una nota puede consumir varias fuentes.

Para reducir sobrecarga, evita acordes enormes con colas largas en muchos tracks. Adelgaza la orquestación o separa la obra en secciones; no borres notas al azar.

## Instrumentos semánticos verificados

Los siguientes IDs están verificados para `native-auto` y también dan a `orchestra-synth` una identidad orquestal clara. La voz de referencia interna no aparece aquí: esta skill crea sólo música instrumental.

```text
strings.violin
strings.violin-section
strings.viola
strings.cello
strings.contrabass
strings.harp
woodwinds.flute
woodwinds.piccolo
woodwinds.oboe
woodwinds.clarinet
woodwinds.bass-clarinet
woodwinds.bassoon
woodwinds.ocarina
woodwinds.alto-recorder
brass.trumpet
brass.horn
brass.trombone
brass.bass-trombone
brass.tuba
piano.grand
keys.pipe-organ
keys.pipe-organ-soft
keys.pipe-organ-pedal
keys.harpsichord
keys.celesta
guitar.electric-clean
guitar.acoustic
percussion.timpani
percussion.orchestral-kit
percussion.glockenspiel
percussion.marimba
percussion.xylophone
percussion.tubular-bells
```

`woodwinds.english-horn` y `woodwinds.contrabassoon` tienen modelos físicos de nivel Studio, pero todavía no están aprobados como fuentes nativas Master. No los presentes como bancos acústicos Master.

### Reglas físicas importantes

- `woodwinds.ocarina` y `woodwinds.alto-recorder` exponen sustain natural y staccato. Escríbelos como instrumentos de aire monofónicos y deja respiraciones.
- `keys.pipe-organ`, `keys.pipe-organ-soft` y `keys.pipe-organ-pedal` son tres capas grabadas independientes, no una consola completa. No inventes stops, couplers ni swell continuo.
- `guitar.electric-clean` usa Karoryfer Emilyguitar: cuatro capas de velocity grabadas, tres round robins de nota y muestras físicas de release/ruido. Escribe voicings de guitarra realistas; no inventes cuerpo de nylon, rasgueo, palm mute ni armónicos grabados.
- La trompeta VSCO 2 CE tiene colores grabados natural, vibrato, straight mute y Harmon mute; la trompa tiene mute grabado y el trombón tiene vibrato grabado. Pide esos colores sólo en el instrumento que realmente los declara.
- Un `timbre=` grabado sólo existe si el manifiesto del banco lo declara. Si no existe, `native-auto` debe fallar con honestidad.
- `articulation=legato` es una intención semántica. No afirmes true legato grabado si el banco no contiene transiciones físicas.
- Los release samples son automáticos cuando el banco los declara. No inventes `articulation=release`.
- Las posiciones de micrófono no son comandos de TloqueScore. No inventes `mic=`.

## Cómo hacer que una orquesta suene mejor

1. Separa las familias en tracks distintos.
2. Distribuye el panorama con moderación; conserva bajos y percusión grave cerca del centro.
3. No dupliques cada melodía en toda la orquesta.
4. Usa registros cómodos y deja espacio entre bajo, armonía y melodía.
5. Haz crescendos con orquestación, `expression`, `brightness` y presión física adecuada.
6. Alterna densidad: tutti, cámara, solo y silencio.
7. Usa ataques cortos para figuras rápidas y ataques más lentos para pads sostenidos.
8. Deja terminar las colas físicas de arpa, piano, campanas y percusión.
9. No maximices `gain`; equilibra tracks y reserva margen para el master.
10. No prometas que la síntesis es indistinguible de una orquesta grabada.

## Ejemplo orquestal completo

```tloque-score
TLOQUE_SCORE 2
title "La puerta del cielo"
tempo 76
meter 4/4
loop false
seed 20260902
humanize 0.075
quality master
module orchestra-synth

track solo synth=pad instrument=strings.violin program=40 role=melody gain=0.24 pan=0.14 attack=0.07 release=1.3 expression=0.68 brightness=0.54 vibrato=0.12 timbre=natural
track violins synth=pad instrument=strings.violin-section program=48 role=harmony gain=0.22 pan=-0.22 attack=0.12 release=1.6 expression=0.62 brightness=0.48 vibrato=0.08 timbre=natural
track cellos synth=bass instrument=strings.cello program=42 role=bass gain=0.24 pan=0.06 attack=0.10 release=1.5 expression=0.66 brightness=0.38 vibrato=0.05 timbre=natural
track flute synth=warm instrument=woodwinds.flute program=73 role=melody gain=0.18 pan=0.28 attack=0.05 release=0.8 expression=0.58 brightness=0.62 vibrato=0.08 timbre=natural
track horn synth=warm instrument=brass.horn program=60 role=harmony gain=0.20 pan=-0.10 attack=0.08 release=1.1 expression=0.58 brightness=0.42 vibrato=0.02 timbre=natural
track harp synth=pluck instrument=strings.harp program=46 role=texture gain=0.17 pan=-0.26 attack=0.003 release=1.8 expression=0.56 brightness=0.58 vibrato=0 timbre=natural
track perc synth=pluck instrument=percussion.orchestral-kit program=0 role=accent gain=0.16 pan=0 attack=0.001 release=2 expression=0.58 brightness=0.48 vibrato=0 timbre=natural

section ascent form=exposition bars=4 repeat=1 fade=2 tempo=76 rubato=0.035
use harp
1:1 C3,G3,E4 2 velocity=0.36
1:3 G3,C4,G4 2 velocity=0.38
2:1 A2,E3,C4 2 velocity=0.38
2:3 F3,C4,A4 2 velocity=0.40
3:1 D3,A3,F4 2 velocity=0.42
3:3 G2,D3,B3 2 velocity=0.44
4:1 C3,G3,E4 4 velocity=0.40
use cellos
control 1:1 expression=0.46 pressure=0.48 bow=0.32 coupling=0.30 ramp=0
1:1 C2 4 velocity=0.42 articulation=tenuto
2:1 A2 4 velocity=0.44 articulation=tenuto
control 3:1 expression=0.72 pressure=0.70 bow=0.48 coupling=0.44 ramp=2
3:1 D2 4 velocity=0.48 articulation=tenuto
4:1 G2 4 velocity=0.50 articulation=tenuto
use violins
control 1:1 expression=0.38 brightness=0.40 pressure=0.46 bow=0.34 coupling=0.28 ramp=0
1:1 C4,E4,G4 4 velocity=0.40 articulation=tenuto
2:1 C4,E4,A4 4 velocity=0.42 articulation=tenuto
control 3:1 expression=0.70 brightness=0.62 pressure=0.68 bow=0.55 coupling=0.42 ramp=2
3:1 D4,F4,A4 4 velocity=0.46 articulation=tenuto
4:1 D4,G4,B4 4 velocity=0.48 articulation=tenuto
use horn
control 1:1 expression=0.42 pressure=0.48 embouchure=0.40 ramp=0
1:1 G3 4 velocity=0.40 articulation=tenuto
rest 2:1 2
2:3 E4 2 velocity=0.42 articulation=tenuto
control 3:1 expression=0.68 pressure=0.66 embouchure=0.54 ramp=2
3:1 F4 4 velocity=0.46 articulation=tenuto
4:1 G4 4 velocity=0.48 articulation=accent
use flute
rest 1:1 2
control 1:3 expression=0.44 pressure=0.46 embouchure=0.50 ramp=0
1:3 E5 1 velocity=0.44 articulation=legato
1:4 G5 1 velocity=0.46 articulation=legato
2:1 A5 2 velocity=0.48 articulation=tenuto
rest 2:3 2
control 3:1 expression=0.70 pressure=0.68 embouchure=0.62 vibrato=0.16 ramp=1
3:1 F5 1 velocity=0.50 articulation=legato
3:2 A5 1 velocity=0.52 articulation=legato
3:3 C6 2 velocity=0.54 articulation=tenuto
4:1 B5 2 velocity=0.50 articulation=legato
4:3 G5 2 velocity=0.44 articulation=normal
use solo
control 1:1 expression=0.42 brightness=0.44 pressure=0.50 bow=0.36 coupling=0.30 ramp=0
1:1 E4 2 velocity=0.46 articulation=legato
1:3 G4 2 velocity=0.48 articulation=legato
2:1 A4 2 velocity=0.50 articulation=legato
2:3 C5 2 velocity=0.52 articulation=tenuto
control 3:1 expression=0.80 brightness=0.68 pressure=0.76 bow=0.60 coupling=0.46 vibrato=0.22 ramp=2
3:1 D5 2 velocity=0.56 articulation=legato
3:3 F5 2 velocity=0.58 articulation=legato
4:1 G5 2 velocity=0.60 articulation=accent
4:3 E5 2 velocity=0.48 articulation=tenuto
use perc
hit 1:1 bass-drum 0.5 velocity=0.38
hit 3:1 suspended-cymbal 2 velocity=0.42
hit 4:1 bass-drum 0.5 velocity=0.52
hit 4:3 triangle-open-large 1 velocity=0.38
end
```

## Si el compilador devuelve un error

1. Lee el número de línea y el mensaje.
2. Localiza esa línea en la obra completa.
3. Corrige sólo la causa real: orden, nombre, rango, compás, track, sección o comando.
4. Revisa otra vez toda la lista del Paso 6.
5. Devuelve la partitura completa en un solo bloque `tloque-score` y nada más.

No ocultes un error sustituyendo un instrumento por otro que el usuario no pidió. No elimines música válida para hacer desaparecer un diagnóstico. Conserva la intención musical y cambia la mínima cantidad necesaria.
