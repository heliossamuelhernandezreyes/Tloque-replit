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
   ├─ Tone.js builtin
   ├─ SpessaSynth SF2/SF3/DLS
   └─ future premium sampler
```

## Principio de seguridad acústica

El manifest no debe inventar capacidades. Si un banco sólo ofrece sustain, Tloque puede modificar duración, dinámica y controladores, pero no debe llamarlo `true-legato`. Si ofrece un programa dedicado de pizzicato, el resolver puede utilizarlo. Si ofrece transiciones grabadas, round robins o releases, esas capacidades deben declararse de forma explícita.

## InstrumentManifest V1

El contrato vive en `shared/instrument-manifest.ts` y describe id/familia, ids semánticos de instrumento, programas base compatibles, capacidades acústicas verificadas y rutas por articulación. También reserva hooks para keyswitches y CC selectors, número de velocity layers y round robins, true legato y release samples.

El primer manifest incorporado es `gm-orchestral-strings`. Conserva General MIDI: programas 40–43 como cuerda base, 44 para tremolo y 45 para pizzicato. No declara legato real, spiccato real, armónicos, round robin ni releases.

## PerformancePlan

`client/src/audio/PerformanceEngine.ts` compila decisiones acústicas por evento. Cada decisión conserva manifest, articulación, ruta concreta, programa/preset, origen de la ruta, velocity layer, round robin determinista, posible transición true-legato, release samples e identidad estable del evento.

También existe `PerformanceRoutingPlan`, que concentra asignación de programas y canales. `ScoreAudioMath.scoreSampledChannelPlan()` delega a esta capa, de modo que el playback SoundFont y la exportación dejan de mantener reglas GM separadas.

## SamplerAdapter

`client/src/audio/SamplerAdapter.ts` traduce una decisión acústica a acciones concretas de sampler. El contrato conserva acciones de programa, keyswitch, controlador, velocity layer, round robin, true-legato y releases.

El adaptador de compatibilidad SpessaSynth sólo deja pasar lo que SF2/SF3/DLS puede expresar explícitamente de manera universal: programa, keyswitch y CC. Las decisiones premium que el backend no entiende permanecen como metadata; Tloque no las aproxima falsamente.

`ScoreSampledExporter` ya consume `PerformancePlan` y `SamplerAdapter`. Cuando una ruta del manifest declara keyswitch o controlador, el MIDI exportado emite esas órdenes inmediatamente antes de la nota. El manifest GM actual no declara esas órdenes, por lo que conserva exactamente el comportamiento anterior.

## Determinismo

Round robin se selecciona mediante `seed + event identity`. Velocity layer se obtiene de la velocidad compilada. Una misma obra, semilla y manifest generan las mismas decisiones acústicas.

## Estado de integración

### Fase 1 — contrato y resolver · completada

- InstrumentManifest V1.
- Resolver semántico por `instrument` con fallback por programa GM.
- Round-robin determinista.
- Pruebas de compatibilidad 40/44/45.

### Fase 2 — PerformancePlan · completada

- decisiones por evento;
- velocity layer;
- round robin;
- detección de transición true-legato monofónica;
- release-sample metadata;
- routing compartido;
- exportación muestreada consumiendo PerformancePlan completo;
- perfil de audio `tloque-score-audio-v6-performance`.

### Fase 3 — sampler adapters · implementada en el camino MIDI/WAV

- contrato renderer-neutral de acciones de sampler;
- adapter de compatibilidad SpessaSynth;
- keyswitches y CC selectors exportables desde el manifest;
- preservación de metadata RR/velocity/legato/releases sin falsear soporte;
- pruebas específicas del adapter.

La reproducción SoundFont en vivo sigue usando el routing compartido del Performance Engine. La activación en vivo de keyswitch/CC y un backend premium capaz de seleccionar RR/velocity/legato/releases directamente son el siguiente subpaso antes de incorporar una biblioteca acústica avanzada.

### Fase 4 — renderer parity y unified mix/master

Extraer la cadena de mezcla a una especificación compartida. El renderer muestreado offline debe pasar por una cadena equivalente a la preview, evitando diferencias en EQ, dinámica, ambiente o nivel.

### Fase 5 — módulos premium

Prioridades: violín solista, cello solista, piano con capas/pedal/resonancia, cuerdas de sección, maderas y metales.

## Criterio de calidad para violín premium

Un módulo no se considera `premium-solo-string` sólo por usar samples. Debe cubrir sustain en varias dinámicas, short notes con al menos 3 round robins, pizzicato y tremolo dedicados, legato/transiciones reales o ausencia explícita, releases, rango/afinación documentados, licencia/procedencia verificadas y presupuesto de memoria móvil conocido.

## Validación

La rama incorpora pruebas unitarias de routing GM, PerformancePlan, velocity layers, round robin, true-legato, releases y sampler adapters. GitHub no reporta checks automáticos para esta rama, por lo que el PR permanece en borrador hasta ejecutar `npm run check`, `npm test` y `npm run build` en un entorno de proyecto.

## Compatibilidad

TloqueScore V1/V2/V2.1 no cambia. `instrument` participa en el routing acústico, pero `program` continúa como fallback. Los módulos GM actuales conservan sus programas y partituras.
