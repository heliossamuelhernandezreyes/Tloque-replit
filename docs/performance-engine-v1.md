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
   └─ future premium sampler
```

## Principio de seguridad acústica

El manifest no debe inventar capacidades. Si un banco sólo ofrece sustain, Tloque puede modificar duración, dinámica y controladores, pero no debe llamarlo `true-legato`. Si ofrece un programa dedicado de pizzicato, el resolver puede utilizarlo. Si ofrece transiciones grabadas, round robins o releases, esas capacidades deben declararse de forma explícita.

## InstrumentManifest V1

El contrato vive en `shared/instrument-manifest.ts` y describe id/familia, ids semánticos de instrumento, programas base compatibles, capacidades acústicas verificadas y rutas por articulación. También reserva hooks para keyswitches y CC selectors, número de velocity layers y round robins, true legato y release samples.

El primer manifest incorporado es `gm-orchestral-strings`. Conserva General MIDI: programas 40–43 como cuerda base, 44 para tremolo y 45 para pizzicato. No declara legato real, spiccato real, armónicos, round robin ni releases.

## PerformancePlan

`client/src/audio/PerformanceEngine.ts` compila decisiones acústicas por evento. Cada decisión conserva manifest, articulación, ruta concreta, programa/preset, origen de la ruta, velocity layer, round robin determinista, posible transición true-legato, release samples e identidad estable del evento.

## SamplerAdapter

`client/src/audio/SamplerAdapter.ts` traduce una decisión acústica a acciones concretas de sampler. El contrato conserva acciones de programa, keyswitch, controlador, velocity layer, round robin, true-legato y releases.

El adaptador de compatibilidad SpessaSynth sólo deja pasar lo que SF2/SF3/DLS puede expresar explícitamente de manera universal: programa, keyswitch y CC. Las decisiones premium que el backend no entiende permanecen como metadata; Tloque no las aproxima falsamente.

Tanto `ScoreSampledExporter` como `LinearScoreEngine` consumen ahora `PerformancePlan` + `SamplerAdapter`. Cuando una ruta del manifest declara keyswitch o controlador, tanto el MIDI/WAV como la reproducción SoundFont en vivo emiten esas órdenes inmediatamente antes de la nota. El manifest GM actual no declara esas órdenes, por lo que conserva exactamente el comportamiento anterior.

## Estado

Fase 1 (manifest + resolver): completada.

Fase 2 (PerformancePlan): completada.

Fase 3 (sampler adapters): completada para programa, keyswitch y CC tanto en live playback como en exportación. Velocity layer, RR, true-legato y releases quedan preservados para un backend premium que pueda seleccionar esas dimensiones directamente.

El siguiente trabajo es unified mix/master y, después, integrar una biblioteca acústica premium real que exponga múltiples dinámicas, round robins, legato y releases.

## Validación

La rama incluye pruebas de routing GM, PerformancePlan y sampler adapter. GitHub no reporta checks automáticos para esta rama, por lo que el PR permanece en borrador hasta ejecutar `npm run check`, `npm test` y `npm run build` en un entorno de proyecto.

## Compatibilidad

TloqueScore V1/V2/V2.1 no cambia. `instrument` participa en el routing acústico, pero `program` continúa como fallback. Los módulos GM actuales conservan sus programas y partituras.
