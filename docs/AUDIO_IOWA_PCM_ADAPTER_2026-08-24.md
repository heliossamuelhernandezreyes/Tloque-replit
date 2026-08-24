# Iowa MIS · adaptador PCM institucional — 2026-08-24

University of Iowa Electronic Music Studios states that the Musical Instrument Samples recordings may be freely used for any purpose without restriction. This integration uses only the chromatic `ff` files published under the dated `MIS Pitches - 2014` path.

## Instrumentos

- `woodwinds.bass-clarinet`: 46 AIFF físicos, Db2–Bb5, uno por semitono.
- `brass.bass-trombone`: 27 AIFF físicos, Db1–Eb3, uno por semitono.

No se declaran velocity layers, round robins, staccato, legato ni otras capacidades ausentes de esta selección física.

## Seguridad

El adaptador no acepta URLs desde cliente. Cada pack compila una base HTTPS fija y una lista cerrada de archivos. Las rutas con traversal se rechazan; después de redirects la respuesta debe permanecer dentro del mismo origen y prefijo. Cada AIFF se valida como PCM sin compresión, se convierte localmente a WAV canónico, se limita por tamaño y el WAV resultante recibe SHA-256 antes de publicarse en App Storage.

## Calidad Master

La matriz es cromática (`lokey=hikey=root`), por lo que dentro del rango declarado no existe pitch-shift de notas sostenidas. El renderer puede seguir aplicando interpretación/room/master, pero no necesita estirar muestras para cubrir semitonos ausentes.
