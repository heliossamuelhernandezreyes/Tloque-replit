# Audio installer hardening notes — 2026-08-24

## Hallazgo

El instalador curado actual está deliberadamente restringido a GitHub/raw.githubusercontent.com y a muestras WAV RIFF. Esa decisión es segura y debe mantenerse como comportamiento por defecto, pero ya limita la expansión de la biblioteca premium porque algunas fuentes verificadas viven en Iowa/GitLab o publican FLAC.

## Regla de evolución

No ampliar `TRUSTED_GITHUB_DOWNLOAD_HOSTS` a una allowlist genérica de Internet. Las nuevas procedencias deben declararse como adaptadores de fuente con:

- esquema HTTPS fijo;
- hosts y prefijos de ruta específicos;
- lista de archivos esperados o índice inmutable;
- límite de bytes por archivo y por pack;
- detección por contenido, no sólo extensión;
- SHA-256 local antes de publicar;
- manifest con procedencia/licencia;
- pruebas que aseguren que una redirección sale rechazada si abandona el origen permitido.

## Formatos

FLAC sólo debe activarse cuando el flujo completo preserve la extensión real desde descarga hasta App Storage y la ruta `/api/audio/sample-packs/samples`, incluyendo Content-Type correcto y reproducción/decode del navegador. No renombrar FLAC a `.wav`.

## Bug independiente detectado

La ruta final de instalación construye actualmente el nombre de un pack con texto histórico `Solo Violin`. Debe reemplazarse por el `displayName` de la fuente en una pasada focalizada; no afecta identidad del manifest ni selección de muestras, pero produce metadatos engañosos para instrumentos distintos del violín.
