# Auditoría de biblioteca acústica nativa — 2026-08-24

## Alcance

Se revisaron el catálogo curado, los InstrumentManifest, el router `native-auto`, el compilador SFZ/WAV, el selector de muestras, el blending de velocity/pitch, true-legato/releases, el stage/master y las rutas de exportación.

## Estado del inventario

- 28 instrumentos/bancos con fuente curada e identidad semántica indexada.
- Fuentes actuales: VSCO 2 CE, VCSL/VCSL Estuary, Karoryfer Emilyguitar y SFZ Instruments Legato Vocal Tutorial.
- Los instaladores fijan commit, validan WAV RIFF/SFZ, calculan SHA-256 y publican en App Storage.
- `native-auto` enruta por `instrumentId` a un InstrumentManifest concreto; no es un banco descargable por sí mismo.

## Huecos del objetivo premium indexados

Estos identificadores quedan registrados como `missing-source`; no se fingirá que Tloque posee una muestra que no existe:

- `strings.harp`
- `woodwinds.piccolo`
- `woodwinds.english-horn`
- `woodwinds.bass-clarinet`
- `woodwinds.contrabassoon`
- `brass.bass-trombone`
- `keys.celesta`
- `guitar.acoustic`

No se les asignó una URL ni licencia inventada. El siguiente paso para cualquiera de ellos es localizar una fuente legal, fijarla a commit y auditar físicamente sus zonas antes de incorporarla.

## Cobertura física que ahora se indexa en runtime

El auditor `NativeSampleCoverageAudit` calcula para cada manifest publicado:

- número total de zonas y raíces grabadas;
- rango MIDI físico;
- mayor distancia entre raíces;
- transposición máxima necesaria dentro del rango;
- notas MIDI sin cobertura;
- articulaciones disponibles;
- colores de vibrato;
- sordinas;
- perspectivas de micrófono;
- capas de velocity y round robins;
- releases físicos;
- transiciones true-legato.

Clasificación de densidad:

- `dense`: transposición máxima <= 1 semitono y raíces separadas <= 2;
- `good`: transposición máxima <= 2 y raíces <= 4;
- `sparse`: reproducible, pero depende más de pitch-shift;
- `risk`: huecos físicos o necesidad de más de 4 semitonos;
- `missing`: no existe banco reproducible.

Además de describir el banco, el auditor intenta construir el plan real de la partitura contra cada módulo. Así indexa por separado un banco existente que, aun así, no cubre una nota/timbre/articulación solicitada por la obra.

## Hallazgos importantes

1. El mayor límite de realismo sigue siendo la densidad física de las muestras, no la precisión del sintetizador. El pitch-shift amplio produce cambios de formante perceptibles.
2. Ya existen blending equal-power entre capas dinámicas y raíces vecinas, micro-crossfades de frase y una sala común; estos mecanismos reducen costuras pero no sustituyen muestras ausentes.
3. `timbre=natural` puede escoger entre colores abiertos físicamente disponibles, mientras los timbres explícitos permanecen estrictos.
4. True-legato y releases permanecen estrictos: el motor no debe fabricar una transición/release que el banco no contiene.
5. El índice estático ahora prueba que toda fuente curada tenga un InstrumentManifest correspondiente y que éste declare el mismo `instrumentId`.
6. La UI del compositor aún tiene una deuda independiente: puede presentar `native-auto` como si fuera un único módulo descargable. El router y exportador nativo ya conocen que es virtual, pero esa presentación debe eliminarse en una pasada de UI para evitar mensajes engañosos.
7. La calidad Master debe seguir prefiriendo error explícito ante ausencia de bancos físicos, nunca degradación silenciosa a síntesis base.

## Criterio antes del próximo WAV

No merece la pena gastar datos en otra exportación hasta que el Pull incluya esta auditoría. Después, una sola ejecución de la misma obra permitirá comparar sala, blending dinámico, crossfade de raíces, vibrato dinámico y brightness con el motor anterior. El informe de cobertura indicará además qué instrumento sigue siendo responsable de una costura audible y si la solución correcta es código o más muestras.
