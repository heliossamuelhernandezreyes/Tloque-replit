# Tloque Performance Engine V1

## Objetivo

Separar la intención musical de TloqueScore de la forma concreta en que un renderer produce audio. Una etiqueta como `articulation=legato` expresa intención; sólo debe convertirse en una articulación muestreada cuando el módulo instalado declare que realmente la contiene.

## Flujo actual

```text
TloqueScore
   ↓
Compiled score
   ↓
Performance Engine
   ├─ Instrument manifest resolver
   ├─ Articulation resolver
   ├─ Dynamic / velocity layer resolver
   ├─ Deterministic round-robin selector
   ├─ Legato transition resolver
   └─ Release-sample resolver
   ↓
Renderer-neutral PerformancePlan
   ↓
SamplerAdapter
   ├─ program change
   ├─ keyswitch
   ├─ controller selector
   └─ capability metadata (velocity/RR/legato/releases)
   ↓
Renderer
   ├─ live SpessaSynth SF2/SF3/DLS
   ├─ sampled WAV export
   ├─ Tone.js builtin
   └─ Tloque native sample-pack runtime
```

## Principio de seguridad acústica

El manifest no debe inventar capacidades. Si un banco sólo ofrece sustain, Tloque puede modificar duración, dinámica y controladores, pero no debe llamarlo `true-legato`. Si ofrece un programa dedicado de pizzicato, el resolver puede utilizarlo. Si ofrece transiciones grabadas, round robins o releases, esas capacidades deben declararse de forma explícita.

## InstrumentManifest V1

`shared/instrument-manifest.ts` describe ids semánticos, programas base, capacidades acústicas verificadas y rutas por articulación. Soporta programas, keyswitches, CC selectors, velocity layers, round robins, true legato y release samples.

`gm-orchestral-strings` conserva General MIDI: programas 40–43 como cuerda base, 44 para tremolo y 45 para pizzicato. No declara legato real, spiccato real, armónicos, round robin ni releases.

### VSCO 2 CE Solo Violin

La primera referencia acústica abierta es `vsco2-ce-solo-violin`, basada en VSCO 2 Community Edition (CC0) y en el patch `SViolin-KS.sfz` fijado al commit `6dd651d55dde97fd4028699be9d4481f26917891`.

Capacidades verificadas en ese patch:

- C2 / MIDI 36: sustain vibrato;
- C#2 / MIDI 37: tremolo;
- D2 / MIDI 38: spiccato;
- D#2 / MIDI 39: pizzicato;
- dos rangos de velocity en esas técnicas;
- dos ataques alternos en spiccato y pizzicato.

No se declara true-legato: el patch no contiene transiciones de intervalo grabadas verificadas. Las técnicas no presentes resetean el sampler a sustain normal, pero continúan marcadas como fallback y no como articulaciones acústicas dedicadas.

VSCO no es un fallback global. Sólo se activa cuando el módulo se identifica explícitamente como `vsco2-ce-solo-violin`; los bancos GM siguen usando exclusivamente el manifest GM.

## PerformancePlan

`client/src/audio/PerformanceEngine.ts` compila decisiones acústicas por evento: manifest, articulación solicitada, ruta real, programa/preset, velocity layer, round robin determinista, posible true-legato, release samples e identidad estable.

## SamplerAdapter

`client/src/audio/SamplerAdapter.ts` traduce una decisión a acciones concretas del sampler. SpessaSynth recibe sólo aquello que SF2/SF3/DLS puede expresar universalmente: programa, keyswitch y CC. Las dimensiones no soportadas por ese backend se conservan como metadata.

Tanto `ScoreSampledExporter` como `LinearScoreEngine` consumen `PerformancePlan + SamplerAdapter`. Los selectores de articulación se emiten antes de cada nota en live playback y en MIDI/WAV.

## Paridad de mezcla sampled live/offline

`client/src/audio/ScoreMixMaster.ts` define una única cadena WebAudio compartida por el renderer SpessaSynth en vivo y el render offline:

- low shelf;
- high shelf;
- compresión;
- makeup gain;
- peak guard rápido de alta relación;
- gain de salida.

El WAV muestreado ya no va directamente de SpessaSynth a `destination`. Preview muestreada y exportación comparten la misma especificación de EQ/dinámica/headroom. Esta paridad se refiere a los renderers muestreados; el renderer Tone.js builtin conserva su cadena propia.

## Tloque Native Sample Pack

Para no obligar a convertir SFZ/WAV a SoundFont se añadió un formato seguro de paquete nativo (`shared/native-sample-pack.ts`). Una zona contiene articulación, URL interna de muestra, root key, rango de notas, rango de velocity, velocity layer, RR, gain, tune y loop points opcionales.

`client/src/audio/NativeSamplePackEngine.ts` valida el paquete, selecciona zonas por articulación + nota + velocity + RR, calcula transposición desde root/tune y reproduce la muestra con WebAudio. Las URLs remotas arbitrarias están prohibidas: un pack sólo puede apuntar a `/api/audio/sample-packs/...`.

`server/sfzSamplePackCompiler.ts` compila un subconjunto inerte de SFZ a zonas Tloque. Rechaza `#include/#define`, traversal `..` y rutas inseguras. No evalúa código ni macros SFZ en el navegador.

El siguiente bloque de implementación es el instalador curado: descargar el SFZ y WAV de VSCO desde el commit fijado, verificar cada WAV/SHA-256, copiarlos a App Storage y publicar el JSON del pack interno. Hasta completar ese instalador, el manifest y el runtime VSCO están preparados pero las muestras VSCO no se distribuyen todavía desde Tloque.

## Estado

Fase 1 (manifest + resolver): completada.

Fase 2 (PerformancePlan): completada.

Fase 3 (sampler adapters): completada para programa, keyswitch y CC en live y export.

Fase 4 (sampled mix/master parity): completada.

Fase 5a (VSCO manifest + native pack contract/runtime + SFZ compiler): completada.

Fase 5b (curated VSCO sample installer + end-to-end native playback/export): pendiente.

## Validación

La rama incluye pruebas de GM routing, PerformancePlan, sampler adapters, VSCO routing, mix/master profile, native sample-pack validation/selection y compilador SFZ curado.

`.github/workflows/audio-performance-check.yml` ejecuta TypeScript, tests y build para cambios de audio. El entorno conectado todavía no reporta un run/check para el último head, por lo que el PR permanece en borrador y no debe fusionarse hasta observar esos checks o ejecutar la validación en un entorno de proyecto.

## Compatibilidad

TloqueScore V1/V2/V2.1 no cambia. `instrument` participa en el routing acústico y `program` sigue siendo fallback. `module <id>` puede seleccionar el protocolo acústico correspondiente sin contaminar módulos GM no relacionados.
