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
   ├─ shared sampled routing → live SoundFont playback
   └─ shared sampled routing → sampled WAV export
   ↓
future unified mix/master
```

## Principio de seguridad acústica

El manifest no debe inventar capacidades. Si un banco sólo ofrece sustain, Tloque puede modificar duración, dinámica y controladores, pero no debe llamarlo `true-legato`. Si ofrece un programa dedicado de pizzicato, el resolver puede utilizarlo. Si ofrece transiciones grabadas, round robins o releases, esas capacidades deben declararse de forma explícita.

## InstrumentManifest V1

El contrato vive en `shared/instrument-manifest.ts` y describe id/familia, ids semánticos de instrumento, programas base compatibles, capacidades acústicas verificadas y rutas por articulación. También reserva hooks para keyswitches y CC selectors, número de velocity layers y round robins, true legato y release samples.

El primer manifest incorporado es `gm-orchestral-strings`. Conserva General MIDI: programas 40–43 como cuerda base, 44 para tremolo y 45 para pizzicato. No declara legato real, spiccato real, armónicos, round robin ni releases.

## PerformancePlan

`client/src/audio/PerformanceEngine.ts` ya compila decisiones acústicas por evento. Cada decisión conserva:

- manifest resuelto;
- articulación solicitada;
- programa/preset seleccionado;
- si la ruta es base o articulación dedicada;
- velocity layer;
- round robin determinista;
- posible transición true-legato y nota previa;
- presencia de release samples;
- identidad estable del evento.

También existe `PerformanceRoutingPlan`, que concentra la asignación de programas y canales. `ScoreAudioMath.scoreSampledChannelPlan()` delega a este plan, por lo que el playback SoundFont y el exportador WAV muestreado dejan de mantener reglas GM separadas.

## Determinismo

Round robin se selecciona mediante `seed + event identity`. Velocity layer se obtiene de la velocidad compilada. Una misma obra, semilla y manifest generan las mismas decisiones acústicas. Esto conserva la reproducibilidad de TloqueScore.

## Estado de integración

### Fase 1 — contrato y resolver · completada

- InstrumentManifest V1.
- Resolver semántico por `instrument` con fallback por programa GM.
- Round-robin determinista.
- Pruebas de compatibilidad 40/44/45.

### Fase 2 — PerformancePlan · completada en contrato y routing

- decisiones por evento;
- velocity layer;
- round robin;
- detección de transición true-legato monofónica;
- release-sample metadata;
- routing compartido entre preview SoundFont y WAV muestreado.

Las bibliotecas actuales todavía no exponen RR/legato/releases reales, por lo que esos campos permanecen metadata hasta instalar un sampler/banco que pueda consumirlos.

### Fase 3 — sampler adapters · siguiente

Añadir adaptadores de manifest para keyswitches, CC selectors y/o regiones de samples. En esta fase `PerformancePlan.roundRobin`, `velocityLayer`, `trueLegato` y `releaseSamples` empezarán a seleccionar recursos acústicos reales, no sólo describirlos.

### Fase 4 — renderer parity y unified mix/master

Extraer la cadena de mezcla a una especificación compartida. El renderer muestreado offline debe pasar por una cadena equivalente a la preview, evitando diferencias en EQ, dinámica, ambiente o nivel.

### Fase 5 — módulos premium

Prioridades:

1. violín solista con múltiples dinámicas, RR, legato y releases;
2. cello solista;
3. piano con capas de velocidad y pedal/resonancia;
4. cuerdas de sección;
5. maderas y metales.

## Criterio de calidad para violín premium

Un módulo no se considera `premium-solo-string` sólo por usar samples. Debe cubrir como mínimo sustain en varias dinámicas, short notes con al menos 3 round robins, pizzicato y tremolo dedicados, legato/transiciones reales o ausencia explícita, releases, rango/afinación documentados, licencia/procedencia verificadas y presupuesto de memoria móvil conocido.

Spiccato, harmonics y otras técnicas sólo se declaran cuando existen como recursos reales o cuando el manifest indica explícitamente el fallback.

## Compatibilidad

TloqueScore V1/V2/V2.1 no cambia. `instrument` ahora participa en el routing acústico, pero `program` continúa siendo fallback. Los módulos GM actuales conservan sus programas y partituras.
