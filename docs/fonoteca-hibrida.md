# Fonoteca híbrida

La Fonoteca no es un repositorio de archivos de audio. Es el catálogo oficial
que publica referencias, licencias, clasificación musical y recetas pequeñas.
El administrador publica; el autor sólo elige activos publicados por ID.

## Fuentes admitidas

- `stream`: una grabación HTTPS para música terminada, como la del lobby.
- `procedural`: una receta JSON v1 que Tone.js interpreta localmente. No
  descarga una canción ni consume almacenamiento proporcional a su duración.
- `soundfont`: la misma receta ejecutada con un banco SF2/SF3/DLS opcional en
  un `AudioWorklet`. El lector decide si descarga y conserva el banco.

Las recetas guardan raíz MIDI, escala, BPM, densidad, brillo, movimiento,
semilla y preset. El servidor deriva de ellas tonalidad, modo, textura,
emoción y etiquetas para que el catálogo no dependa de analizar un MP3.

## Motores y licencias

- [Tone.js](https://github.com/Tonejs/Tone.js), MIT, es el motor procedural.
- [spessasynth_lib](https://github.com/spessasus/spessasynth_lib), Apache-2.0,
  reproduce bancos SF2/SF3/DLS fuera del hilo principal.

El código de ambos llega por npm. Sus dependencias están fijadas en el lockfile.
Los bancos de instrumentos tienen licencia propia: nunca deben copiarse al
repositorio. Cada activo debe conservar `license`, `sourceName`, `sourceUrl` y,
cuando sea posible, tamaño y SHA-256 del banco.

## Reproducción móvil

Nada inicia automáticamente. El contexto de audio sólo se abre tras un gesto
del usuario. El lector elige por obra entre Original Tloque, la recomendación
externa de Spotify o silencio. La preferencia se recuerda, pero no se usa para
arrancar sonido sin otro toque en una nueva sesión.

Las pistas y bancos pueden guardarse en Cache Storage. Un SHA-256 publicado se
comprueba antes de conservar un banco. Si Web Audio o AudioWorklet no existen,
se utiliza la pista HTTPS de respaldo cuando el administrador haya publicado
una.

## Responsabilidad del Director Artificial

El Director Artificial sólo propone metadatos y selecciona partituras/capas ya
publicadas. No escribe el manuscrito, no sube audio y no genera música de obra.
La única excepción futura prevista es acompañamiento continuo de audiolibro,
que debe vivir en una ruta y política de producto separadas.
