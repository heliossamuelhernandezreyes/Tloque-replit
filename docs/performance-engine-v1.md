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
SamplerAdapter / native pack selector
   ↓
Renderer
   ├─ live SpessaSynth SF2/SF3/DLS
   ├─ sampled WAV export
   ├─ Tone.js builtin
   └─ Tloque native sample-pack runtime
```

## Principio de seguridad acústica

El manifest no debe inventar capacidades. Si un banco sólo ofrece sustain, Tloque puede modificar duración, dinámica y controladores, pero no debe llamarlo `true-legato`. Si ofrece una técnica dedicada, el resolver puede utilizarla. Si ofrece transiciones grabadas, round robins o releases, esas capacidades se declaran explícitamente.

## InstrumentManifest V1

`shared/instrument-manifest.ts` describe ids semánticos, programas base, capacidades acústicas verificadas y rutas por articulación. Soporta programas, keyswitches, CC selectors, velocity layers, round robins, true legato y release samples.

`gm-orchestral-strings` conserva General MIDI: programas 40–43 como cuerda base, 44 para tremolo y 45 para pizzicato. No declara legato real, spiccato real, armónicos, round robin ni releases.

## VSCO 2 CE · familia de cuerdas

La primera familia acústica abierta se basa en VSCO 2 Community Edition (CC0) y permanece fijada al commit `6dd651d55dde97fd4028699be9d4481f26917891`.

Tloque conserva la identidad real de las grabaciones upstream:

- `vsco2-ce-solo-violin` → `SViolin-KS.sfz` → `strings.violin`;
- `vsco2-ce-viola-section` → `ViolaEns-KS.sfz` → `strings.viola`;
- `vsco2-ce-cello-section` → `CelloEns-KS.sfz` → `strings.cello`;
- `vsco2-ce-solo-contrabass` → `Contrabass-KS.sfz` → `strings.contrabass`.

Viola y cello no se presentan como solistas porque los patches de origen son ensembles. El contrabajo sí conserva identidad Solo Contrabass.

Los keyswitches son locales a cada instrumento. El compilador ya no asume que un número MIDI fijo representa siempre la misma técnica. Prefiere `sw_label` y, para patches antiguos sin etiqueta, puede inferir únicamente desde nombres semánticos de ruta (`spic`, `pizz`, `trem`, etc.). Esto permite que viola use C2-D#2 mientras cello y contrabajo usan regiones de C6 en adelante sin contaminar su semántica.

El parser reconoce round robin desde `seq_length/seq_position`, `group_label` y nombres `_rrN`, porque VSCO no usa el mismo mecanismo en todos los patches. Las velocity layers se preservan desde los rangos reales `lovel/hivel` de cada zona; no se obliga a todos los instrumentos a tener el mismo número de capas.

No se declara true-legato en esta familia: estos patches no contienen transiciones de intervalo grabadas verificadas.

## Paquetes independientes

`shared/curated-sample-packs.ts` registra cada instrumento como descarga independiente. Esto evita obligar a un dispositivo móvil a almacenar toda la familia. El catálogo estima aproximadamente 118–125 MB por instrumento antes de deduplicación.

El router canónico `server/nativeSamplePackRoutes.ts` se registra antes del handler legado y realiza:

1. selección exclusiva de una fuente curada conocida;
2. aceptación explícita de licencia/procedencia;
3. descarga desde el commit fijado;
4. compilación inerte del SFZ;
5. validación RIFF/WAVE;
6. SHA-256 por muestra;
7. deduplicación en App Storage;
8. publicación de un manifest inmutable por SHA;
9. publicación de un alias estable `/api/audio/sample-packs/modules/<moduleId>.json`.

El alias histórico `vsco2-ce` se conserva apuntando al Solo Violin para no romper integraciones previas.

## PerformancePlan y sampler

`client/src/audio/PerformanceEngine.ts` compila decisiones acústicas por evento: manifest, articulación solicitada, ruta real, programa/preset, velocity layer, round robin determinista, posible true-legato, release samples e identidad estable.

`client/src/audio/SamplerAdapter.ts` traduce una decisión a acciones concretas del sampler. SpessaSynth recibe sólo aquello que SF2/SF3/DLS puede expresar universalmente. Las dimensiones no soportadas por ese backend se conservan como metadata.

`client/src/audio/NativeSamplePackEngine.ts` valida paquetes nativos, selecciona zonas por articulación + nota + velocity + RR, calcula transposición desde root/tune y reproduce el WAV mediante WebAudio. Sólo admite muestras publicadas bajo `/api/audio/sample-packs/...`.

`client/src/audio/NativeSampleScoreEngine.ts` consume estos paquetes en reproducción live y funciona por `moduleId`, por lo que los cuatro instrumentos usan el mismo runtime sin código específico por instrumento.

## Paridad de mezcla sampled live/offline

`client/src/audio/ScoreMixMaster.ts` define una única cadena WebAudio compartida por el renderer SpessaSynth en vivo y el render offline: low shelf, high shelf, compresión, makeup gain, peak guard rápido y gain de salida.

El WAV muestreado SoundFont ya no va directamente de SpessaSynth a `destination`. Preview muestreada y exportación comparten especificación de EQ/dinámica/headroom. La exportación WAV directamente desde `TloqueSamplePack` sigue siendo el siguiente bloque pendiente.

## Estado

- Fase 1 · manifest + resolver: completada.
- Fase 2 · PerformancePlan: completada.
- Fase 3 · sampler adapters: completada para programa, keyswitch y CC en live/export SoundFont.
- Fase 4 · sampled mix/master parity: completada.
- Fase 5a · native pack contract/runtime + SFZ compiler: completada.
- Fase 5b · instalador curado + live native playback: completada para violín, viola section, cello section y contrabajo solista VSCO.
- Fase 5c · exportación WAV nativa desde TloqueSamplePack: pendiente.
- Próxima familia sugerida: maderas, reutilizando el mismo catálogo/compilador sin asumir articulaciones de cuerda.

## Validación

La rama incluye pruebas de GM routing, PerformancePlan, sampler adapters, manifests VSCO, keyswitches heterogéneos, SFZ con rutas/archivos con espacios, seguridad, velocity/RR, compatibilidad del alias histórico y selección nativa.

En el head de la expansión a cuerdas, `Audio performance check` y `Core app check` completaron TypeScript, tests y build en verde.

## Compatibilidad

TloqueScore V1/V2/V2.1 no cambia. `instrument` participa en routing acústico y `program` sigue siendo fallback. `module <id>` selecciona explícitamente el protocolo acústico correspondiente; los módulos GM no relacionados conservan su fallback actual.
