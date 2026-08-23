# Tloque Performance Engine V1

## Objetivo

Separar la intención musical de TloqueScore de la forma concreta en que un renderer produce audio. Una etiqueta como `articulation=legato` expresa intención; sólo debe convertirse en una articulación muestreada cuando el módulo instalado declare que realmente la contiene.

## Flujo propuesto

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
   ├─ Release-sample resolver
   └─ Performance automation
   ↓
Renderer-neutral performance plan
   ├─ Tone.js builtin
   ├─ SpessaSynth SF2/SF3/DLS
   └─ future SFZ / native sampler
   ↓
Unified mix/master chain
```

## Principio de seguridad acústica

El manifest no debe inventar capacidades. Si un banco sólo ofrece sustain, Tloque puede modificar duración, dinámica y controladores, pero no debe llamarlo `true-legato`. Si ofrece un programa dedicado de pizzicato, el resolver puede utilizarlo. Si ofrece transiciones grabadas, round robins o releases, esas capacidades deben declararse de forma explícita.

## InstrumentManifest V1

El contrato inicial vive en `shared/instrument-manifest.ts` y describe:

- id y familia;
- ids semánticos de instrumento (`strings.violin`, etc.);
- programas base compatibles;
- capacidades acústicas verificadas;
- rutas por articulación;
- hooks futuros para keyswitches y CC selectors;
- número de velocity layers y round robins cuando el módulo lo conozca;
- flags de true legato y release samples.

El primer manifest incorporado es `gm-orchestral-strings`. Conserva el comportamiento actual de General MIDI: programas 40–43 como cuerda base, 44 para tremolo y 45 para pizzicato. No declara legato real, spiccato real, armónicos, round robin ni releases.

## PerformanceRoute

`client/src/audio/PerformanceEngine.ts` resuelve una pista + articulación a una ruta concreta. Hoy devuelve un programa compatible y la procedencia de la decisión (`base-program` o `dedicated-articulation`). En siguientes fases crecerá a un `PerformanceEvent` renderer-neutral.

## Round robin

El selector incluido es determinista por `seed + event identity`. Esto mantiene una propiedad importante de TloqueScore: una misma obra y semilla produce la misma interpretación. Cuando un módulo declare, por ejemplo, 6 ataques spiccato alternativos, todos los renderers deberán elegir la misma toma.

## Fases de integración

### Fase 1 — contrato y resolver

- InstrumentManifest V1.
- Resolver semántico por `instrument` con fallback por programa GM.
- Round-robin determinista.
- Pruebas de compatibilidad con las rutas 40/44/45 existentes.

### Fase 2 — performance plan

Crear un plan intermedio por evento con:

- instrumento resuelto;
- articulación solicitada y articulación disponible;
- dinámica continua;
- velocity layer;
- round robin;
- transición legato previa/siguiente;
- release sample;
- timing humanizado;
- curva de vibrato y expresión.

Los renderers dejarán de resolver estas decisiones por su cuenta.

### Fase 3 — renderer parity

`LinearScoreEngine`, `ScoreSampledExporter` y el renderer builtin consumirán el mismo performance plan. La preview y el WAV deben compartir articulación, selección de muestra y automatización.

### Fase 4 — unified mix/master

Extraer la cadena de mezcla a una especificación compartida. El renderer muestreado offline debe pasar por una cadena equivalente a la preview, evitando que el WAV y la escucha de referencia difieran en EQ, dinámica o nivel.

### Fase 5 — módulos premium

Convertir/adaptar bibliotecas sólo después de disponer de manifests verificables. Prioridades:

1. violín solista con múltiples dinámicas, RR, legato y releases;
2. cello solista;
3. piano con capas de velocidad y pedal/resonancia;
4. cuerdas de sección;
5. maderas y metales.

## Criterio de calidad para un violín premium

Un módulo no se considerará `premium-solo-string` sólo por usar samples. Debe cubrir como mínimo:

- sustain en varias dinámicas;
- short notes con al menos 3 round robins;
- pizzicato dedicado;
- tremolo dedicado;
- legato/transiciones reales o una declaración explícita de que no las tiene;
- releases;
- rango y afinación documentados;
- licencia/procedencia verificadas;
- presupuesto de memoria móvil conocido.

Spiccato, harmonics y otras técnicas deben declararse únicamente si existen como recursos reales o si el manifest marca explícitamente el fallback sintético.

## Compatibilidad

TloqueScore V1/V2/V2.1 no necesita cambiar para esta primera fase. `instrument` pasa a ser semánticamente útil, pero `program` continúa funcionando como fallback. Los módulos GM actuales conservan sus programas y partituras.
