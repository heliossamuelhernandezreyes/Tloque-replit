# Tloque Performance Engine

## Invariantes

- General MIDI sigue siendo el fallback compatible; los módulos premium se activan explícitamente.
- `InstrumentManifest` describe únicamente capacidades verificadas de la librería.
- `PerformancePlan` compila por evento articulación, programa/selector, velocity layer, round-robin, true legato y release samples.
- `tloque-universal-performance-director-v2` segmenta frases por track, respeta silencios y secciones, localiza un clímax estable y aplica jerarquía métrica, contorno y respiración/arco sin reescribir la partitura.
- `performedEventValues` es el contrato único de tiempo, duración y velocity para reproducción SoundFont, MIDI/WAV, muestras nativas y síntesis orquestal.
- Los keyswitches son locales al instrumento. Nunca se interpretan como números universales entre librerías.
- Live y WAV muestreado comparten `NativeSampleScorePlan` y `createSampledMixMaster`.
- Live y WAV sintético comparten `buildOrchestralSynthRenderUnits`; las cuerdas V3 agrupan únicamente legatos monofónicos de una misma frase y cortan en silencios, acordes y nuevos ataques.

## VSCO 2 Community Edition

Fuente fijada: `sgossner/VSCO-2-CE` commit `6dd651d55dde97fd4028699be9d4481f26917891`, licencia CC0-1.0.

### Cuerdas

- Solo Violin
- Viola Section
- Cello Section
- Solo Contrabass

### Maderas

- Flute
- Clarinet
- Oboe
- Bassoon

### Metales

- Trumpet
- Tenor Trombone
- F Horn
- Tuba

### Percusión afinada

- Timpani: hits con velocity layers y dos RR físicos; `TimpaniRolls.sfz` se expone como `articulation=tremolo` porque es un roll grabado real.
- Glockenspiel
- Marimba
- Xylophone
- Tubular Bells

Los instrumentos de láminas/campanas no declaran capas ni RR si el SFZ upstream no las contiene.

### Percusión orquestal semántica

`GM-StylePerc.sfz` se instala como `vsco2-ce-orchestral-percussion`, asociado a `instrument=percussion.orchestral-kit`. Sus teclas MIDI son selectores internos de muestras, no alturas musicales expuestas al autor.

TloqueScore acepta golpes explícitos sólo en ese track, por ejemplo:

```text
module vsco2-ce-orchestral-percussion
track perc synth=pluck instrument=percussion.orchestral-kit program=0 role=accent gain=0.45 pan=0 attack=0.001 release=2 expression=1 brightness=0.5 vibrato=0
section hits form=custom bars=1 repeat=1 fade=0 tempo=80 rubato=0
use perc
hit 1:1 bass-drum 0.5 velocity=0.8
hit 1:2 snare-hit 0.25 velocity=0.6
hit 1:3 crash-cymbal 1 velocity=0.7
end
```

Nombres semánticos iniciales: bass drum, snare taps/hit/roll y variantes, crash/suspended cymbal, tambourine shake/hit/roll, cowbell, suspended-cymbal-stick, triángulos pequeños/grandes abiertos o apagados y sleigh bells.

Un nombre desconocido falla al compilar. `hit` en un track melódico también falla, evitando que la percusión no afinada se disfrace como melodía.

Los `hit` son one-shots físicos. La duración escrita conserva el significado rítmico del evento, pero no corta artificialmente el WAV de un plato, bombo, caja o triángulo. Live mide la duración real de la muestra seleccionada para determinar el final acústico. El exportador decodifica primero sólo las zonas necesarias, calcula la duración física corregida por `playbackRate` y dimensiona el `OfflineAudioContext` hasta el final real del último one-shot más la cola de mastering. Los instrumentos melódicos siguen limitados por su duración musical normal.

## Instalación nativa

- descarga sólo desde commit fijado
- SFZ se trata como datos inertes
- rechazo de preprocesador, traversal y rutas remotas/absolutas
- validación RIFF/WAVE
- SHA-256 por SFZ, muestra y manifest publicado
- deduplicación por contenido en App Storage
- aliases estables `/api/audio/sample-packs/modules/<moduleId>.json`

## Exportación

Los módulos nativos se renderizan con `OfflineAudioContext` usando exactamente el mismo plan acústico del live. El master WAV no imprime ducking ni fades narrativos dependientes de la lectura. Preview usa 32 kHz/16-bit; Studio/Master 48 kHz/24-bit, con límite de 220 MB de buffers float para proteger navegadores móviles. Para one-shots, el límite de memoria se calcula después de conocer la cola física real de las muestras seleccionadas.

El perfil general `tloque-score-audio-v7-universal-performance` garantiza que live y exportación consuman la misma interpretación. `humanize=0` conserva neutralidad exacta; un valor positivo activa variación determinista y el Director V2 dentro de límites acotados.

Native Hybrid Performance V3 conserva esa misma interpretación y compila los legatos monofónicos de cuerdas frotadas en unidades físicas de frase. La capa sampleada mantiene todos sus eventos; sólo el resonador subordinado comparte una vida waveguide hasta un `rest`, una ruptura de frase, un acorde o una articulación no frotada.

## Estado

Cuerdas, maderas, metales, percusión afinada y percusión orquestal semántica quedan integrados sobre la misma ruta nativa sampled live/WAV. El siguiente crecimiento del motor debe modelar dimensiones tímbricas explícitas —por ejemplo mute/vibrato— únicamente donde existan grabaciones upstream verificadas, sin convertir colores distintos en articulaciones ficticias.
