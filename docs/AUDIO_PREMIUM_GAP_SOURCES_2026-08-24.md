# Fuentes verificadas para huecos de audio premium — 2026-08-24

## Criterio

Un instrumento sólo deja `missing-source` cuando Tloque puede instalar una fuente cuya procedencia y permiso de redistribución sean verificables y cuyo audio pueda pasar por el mismo pipeline de hashes, App Storage y auditoría física que el resto de `native-auto`.

No se aceptan como Master fuentes cuya descarga sea pública pero cuyo permiso para redistribuirse como sampler sea ambiguo.

## Integrado en esta rama

### `guitar.acoustic` — Discord SFZ GM · Martin HD28

- Autor de las muestras/SFZ: Jeff Learman.
- El SFZ fuente declara explícitamente `Creative Commons CC0`.
- Repositorio: `sfzinstruments/Discord-SFZ-GM-Bank`.
- Commit fijado: `7a9c478fe331f94f246d33332f0adedb25bbbe27`.
- Material instalado: 15 WAV físicos de Martin HD28, de MIDI 40 a 83, con rangos generados a partir de las raíces reales.
- Tloque no simula strumming ni articulaciones no grabadas.

## Verificados, pendientes de adaptador de fuente

### `woodwinds.bass-clarinet` — University of Iowa MIS

La colección de Musical Instrument Samples contiene clarinete bajo real con cobertura extensa y grabaciones a varias dinámicas. La procedencia y permiso de uso son aptos para el objetivo de Tloque, pero el instalador curado actual sólo admite repositorios GitHub fijados. Debe entrar mediante un adaptador HTTPS explícitamente allowlisted, nunca relajando la política global de hosts.

### `brass.bass-trombone` — University of Iowa MIS

Misma estrategia que Bass Clarinet. La colección ofrece trombón bajo real y cobertura cromática útil. Integrar únicamente después de fijar una lista explícita de URLs/huellas y conservar el preflight de tamaño y formato.

### `keys.celesta` — A Sampled Celesta

Banco de celesta real con material de audio/SFZ publicado CC0. El repositorio fuente está en GitLab y parte del flujo de assets no encaja todavía con el descargador GitHub-only. Requiere un adaptador GitLab/LFS específico o una fuente de release inmutable y verificable.

### `guitar.acoustic-nylon` — FreePats Spanish Classical Guitar

Fuente CC0 y SFZ bien mapeado. El repositorio GitHub publica sus muestras como FLAC, mientras el sample-pack interno de Tloque actualmente valida y sirve WAV. El manifest queda modelado pero no se registra en `native-auto` hasta que el pipeline soporte FLAC de forma completa (detección, extensión, Content-Type, almacenamiento y pruebas), para impedir que el router seleccione un banco no instalable.

## Huecos que deben permanecer explícitos

### `woodwinds.english-horn`

No se encontró todavía una fuente de calidad con procedencia y permiso de redistribución como sampler suficientemente claros. Sonatina/Philharmonia pueden servir como referencia acústica, no como pack Master redistribuido por Tloque.

### `woodwinds.contrabassoon`

Mismo criterio: conservar `missing-source` hasta tener una fuente defendible. No degradar silenciosamente a otra muestra ni declarar Master mediante pitch-shift agresivo.

## Próximo trabajo

1. Crear un adaptador curado de `direct-https` con allowlist por fuente, no por host global abierto.
2. Añadir verificación de hashes esperados cuando el upstream no ofrezca commits inmutables.
3. Integrar Iowa Bass Clarinet y Bass Trombone con manifests y pruebas de cobertura.
4. Integrar A Sampled Celesta mediante un origen inmutable verificable.
5. Añadir soporte FLAC end-to-end antes de activar FreePats nylon.
6. Ejecutar `NativePremiumReadiness` sobre una obra real y densificar sólo los módulos que la demanda de la partitura marque como riesgo.
