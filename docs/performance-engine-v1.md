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
Renderer
   ├─ live SpessaSynth SF2/SF3/DLS
   ├─ sampled WAV export
   ├─ Tone.js builtin
   └─ Tloque Native Sample Pack
```

## Principio de seguridad acústica

El manifest no debe inventar capacidades. Si un banco sólo ofrece sustain, Tloque puede modificar duración, dinámica y controladores, pero no debe llamarlo `true-legato`. Si ofrece un programa dedicado de pizzicato, el resolver puede utilizarlo. Si ofrece transiciones grabadas, round robins o releases, esas capacidades deben declararse de forma explícita.

## InstrumentManifest V1

`shared/instrument-manifest.ts` describe ids semánticos, programas base, capacidades acústicas verificadas y rutas por articulación. Soporta programas, keyswitches, CC selectors, velocity layers, round robins, true legato y release samples.

`gm-orchestral-strings` conserva General MIDI: programas 40–43 como cuerda base, 44 para tremolo y 45 para pizzicato. No declara legato real, spiccato real, armónicos, round robin ni releases.

### VSCO 2 CE Solo Violin

La primera referencia acústica abierta es `vsco2-ce-solo-violin`, basada en VSCO 2 Community Edition (CC0) y en el patch `SViolin-KS.sfz` fijado al commit `6dd651d55dde97fd4028699be9d4481f26917891`.

Capacidades verificadas en ese patch: sustain vibrato, tremolo, spiccato y pizzicato; dos rangos de velocity; y ataques alternos donde el SFZ original los define. No se declara true-legato porque el patch no contiene transiciones de intervalo grabadas verificadas.

VSCO no es fallback global. Sólo se activa cuando el módulo se identifica explícitamente como `vsco2-ce-solo-violin`; los bancos GM siguen usando el manifest GM.

## PerformancePlan

`client/src/audio/PerformanceEngine.ts` compila decisiones acústicas por evento: manifest, articulación solicitada, ruta real, programa/preset, velocity layer, round robin determinista, posible true-legato, release samples e identidad estable.

## Paridad de mezcla sampled live/offline

`client/src/audio/ScoreMixMaster.ts` define una única cadena WebAudio compartida por el renderer SpessaSynth en vivo y el render offline: low shelf, high shelf, compresión, makeup gain, peak guard rápido y gain de salida. El WAV muestreado ya no va directamente del sampler a `destination`.

## Tloque Native Sample Pack

`shared/native-sample-pack.ts` define un formato inerte de zonas: articulación, URL interna, root key, rango MIDI, velocity layer, round robin, ganancia, afinación y loop points opcionales.

`client/src/audio/NativeSamplePackEngine.ts` valida el paquete, selecciona físicamente la zona por articulación + nota + velocity + RR, calcula transposición desde `rootMidi/tuneCents` y reproduce el WAV con WebAudio. Sólo admite URLs bajo `/api/audio/sample-packs/`.

`server/sfzSamplePackCompiler.ts` compila el subconjunto curado de SFZ a ese contrato. Rechaza preprocesador, traversal y rutas externas; soporta `default_path` y nombres de muestra con espacios, necesarios para VSCO.

## Instalador curado VSCO

`shared/audio-module-sources.ts` fija el paquete Solo Violin al commit y SFZ exactos. `server/audioModuleInstaller.ts` descarga el SFZ desde `raw.githubusercontent.com` usando exclusivamente ese commit, compila primero las rutas, descarga secuencialmente únicamente los WAV referenciados, valida cabecera RIFF/WAVE, calcula SHA-256 y limita tamaño por muestra y paquete.

`server/audioUploads.ts` expone `POST /api/admin/audio/sample-pack-catalog/vsco2-ce/install`. La instalación:

1. deduplica cada WAV por SHA-256 en App Storage;
2. recompila el SFZ usando URLs internas inmutables;
3. incorpora SHA-256 por zona;
4. publica un manifest inmutable por hash;
5. publica además `/api/audio/sample-packs/modules/vsco2-ce-solo-violin.json` como alias estable del módulo;
6. sirve los WAV y manifests con rutas separadas y cache control.

El navegador nunca consulta GitHub durante reproducción.

## Reproducción nativa end-to-end

`client/src/audio/NativeSampleScoreEngine.ts` conecta TloqueScore al paquete instalado. Precalcula el `PerformancePlan`, determina las zonas necesarias, precarga únicamente esas muestras, crea una cadena de mezcla compartida y agenda los WAV reales con velocity/RR deterministas.

`HybridMusicEngine` detecta módulos acústicos registrados. Si una partitura usa `module vsco2-ce-solo-violin` y no trae un SoundFont explícito, la envía al renderer nativo en vez del sintetizador base.

La pantalla administrativa `VscoInstallerAdmin.tsx`, disponible en `/admin/audio/vsco-violin`, permite instalar y verificar el paquete desde la app con aceptación explícita de procedencia/licencia y muestra al finalizar cantidad de muestras, bytes y SHA del manifest.

## Estado

- Fase 1: manifests + resolver — completada.
- Fase 2: PerformancePlan — completada.
- Fase 3: adapters SoundFont — completada.
- Fase 4: paridad sampled mix/master — completada.
- Fase 5a: contrato/sample runtime/SFZ compiler — completada.
- Fase 5b: instalador curado VSCO + reproducción nativa live — completada.
- Fase 5c: exportación WAV offline usando directamente Native Sample Pack — pendiente; la exportación SoundFont ya conserva la cadena master compartida.

## Validación

La rama incluye pruebas de routing GM, PerformancePlan, sampler adapter, manifest VSCO, perfil de master, validación/selección de zonas nativas, parser SFZ con rutas que contienen espacios y registro curado.

`.github/workflows/audio-performance-check.yml` ejecuta `npm ci`, TypeScript, tests y build para cambios de audio, instalador, servidor y paquetes nativos. El PR debe permanecer en draft hasta que los checks del head final estén verdes.

## Compatibilidad

TloqueScore V1/V2/V2.1 no cambia. `instrument` participa en routing acústico y `program` sigue como fallback. `module <id>` selecciona el protocolo acústico correspondiente sin contaminar módulos GM no relacionados.
