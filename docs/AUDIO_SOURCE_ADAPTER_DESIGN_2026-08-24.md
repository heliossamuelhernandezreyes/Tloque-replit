# Diseño de adaptadores de fuentes acústicas

## Objetivo

Permitir que Tloque incorpore bibliotecas verificadas fuera de GitHub (por ejemplo Iowa MIS o GitLab) sin convertir el instalador en un descargador arbitrario.

## Modelo propuesto

Separar tres conceptos que hoy aparecen acoplados:

1. **ProvenanceSource**: dónde viven los bytes y bajo qué identidad inmutable/licencia se aceptan.
2. **MappingProfile**: cómo nombres/índices físicos se convierten en raíces, capas, round robins, trigger, micrófono y articulación.
3. **InstrumentManifest**: qué capacidades semánticas ofrece el instrumento a `native-auto`.

Un `ProvenanceSource` no debe aceptar una URL suministrada por el cliente. Las URLs pertenecen al catálogo compilado del servidor y deben validarse contra un adaptador concreto.

## Adaptadores iniciales

### `github-commit`

Es el comportamiento existente: `github.com/<owner>/<repo>` + SHA de commit + paths relativos. Continúa siendo el default.

### `direct-https-fixed`

Para colecciones institucionales como Iowa. Cada pack declara una lista cerrada de URLs HTTPS, host esperado y, cuando sea posible, SHA-256 esperado. Una redirección fuera del host/prefijo permitido es error.

### `gitlab-commit`

Para bibliotecas como A Sampled Celesta. Debe resolver únicamente archivos asociados a proyecto + commit fijado y rechazar URLs LFS/release cuya inmutabilidad no pueda demostrarse.

## Invariantes

- Nunca degradar Master por ausencia de fuente.
- Nunca aceptar una URL arbitraria desde UI para un pack curado.
- Hash SHA-256 de cada asset antes de App Storage.
- Límite individual y total de bytes.
- Validación magic/header del formato físico.
- El manifest publicado registra procedencia y revisión fijada.
- Una fuente verificada pero no instalable permanece fuera de `INSTRUMENT_MANIFEST_REGISTRY` si su `instrumentId` puede ser seleccionado por `native-auto`.
