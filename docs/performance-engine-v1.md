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
   ├─ full per-event plan → sampled WAV export
   └─ shared manifest routing → live SoundFont playback
   ↓
future sampler adapters + unified mix/master
```

## Principio de seguridad acústica

El manifest no debe inventar capacidades. Si un banco sólo ofrece sustain, Tloque puede modificar duración, dinámica y controladores, pero no debe llamarlo `true-legato`. Si ofrece un programa dedicado de pizzicato, el resolver puede utilizarlo. Si ofrece transiciones grabadas, round robins o releases, esas capacidades deben declararse de forma explícita.

## InstrumentManifest V1

El contrato vive en `shared/instrument-manifest.ts` y describe id/familia, ids semánticos de instrumento, programas base compatibles, capacidades acústicas verificadas y rutas por articulación. También reserva hooks para keyswitches y CC selectors, número de velocity layers y round robins, true legato y release samples.

El primer manifest incorporado es `gm-orchestral-strings`. Conserva General MIDI: programas 40–43 como cuerda base, 44 para tremolo y 45 para pizzicato. No declara legato real, spiccato real, armónicos, round robin ni releases.

## PerformancePlan

`client/src/audio/PerformanceEngine.ts` compila decisiones acústicas por evento. Cada decisión conserva manifest, articulación, programa/preset, origen de la ruta, velocity layer, round robin determinista, posible transición true-legato, release samples e identidad estable del evento.

También existe `PerformanceRoutingPlan`, que concentra asignación de programas y canales. `ScoreAudioMath.scoreSampledChannelPlan()` delega a esta capa, de modo que el playback SoundFont y la exportación dejan de mantener reglas GM separadas.

`ScoreSampledExporter` ya consume el `PerformancePlan` completo por evento. El playback SoundFont en vivo consume todavía la porción de routing compartida; la metadata RR/velocity/legato/releases se activará en vivo cuando entren los sampler adapters capaces de seleccionar esos recursos.

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

### Fase 3 — sampler adapters · siguiente

Añadir adaptadores de manifest para keyswitches, CC selectors y/o regiones de samples. En esta fase `roundRobin`, `velocityLayer`, `trueLegato` y `releaseSamples` empezarán a seleccionar recursos acústicos reales también en reproducción en vivo.

### Fase 4 — renderer parity y unified mix/master

Extraer la cadena de mezcla a una especificación compartida. El renderer muestreado offline debe pasar por una cadena equivalente a la preview, evitando diferencias en EQ, dinámica, ambiente o nivel.

### Fase 5 — módulos premium

Prioridades: violín solista, cello solista, piano con capas/pedal/resonancia, cuerdas de sección, maderas y metales.

## Criterio de calidad para violín premium

Un módulo no se considera `premium-solo-string` sólo por usar samples. Debe cubrir sustain en varias dinámicas, short notes con al menos 3 round robins, pizzicato y tremolo dedicados, legato/transiciones reales o ausencia explícita, releases, rango/afinación documentados, licencia/procedencia verificadas y presupuesto de memoria móvil conocido.

## Compatibilidad

TloqueScore V1/V2/V2.1 no cambia. `instrument` participa en el routing acústico, pero `program` continúa como fallback. Los módulos GM actuales conservan sus programas y partituras.
