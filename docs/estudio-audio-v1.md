# Estudio de audio V1

## Alcance

La Fonoteca es el registro único de procedencia, licencia, estado y metadatos,
pero no obliga a que todos los sonidos compartan reproductor:

- **Música:** pistas lineales, TloqueScore, síntesis procedural y SoundFonts.
- **Ambiente:** fondos largos asignables a lectura.
- **Interfaz:** microsonidos breves disparados por eventos estables.
- **Voz:** permanece en el pipeline de audiolibro; no se mezcla con recetas musicales.

La música de lectura continúa bajo Music Brain y Dirección Artificial. Los
sonidos de botones, orbes y páginas no son decisiones narrativas del Music
Brain y nunca se insertan como capas musicales.

## TloqueScore V1

`TLOQUE_SCORE 1` es un lenguaje declarativo instrumental. El servidor compila
el texto a un `LinearScorePlan` acotado y el cliente ejecuta solamente ese plan.
No se usa `eval`, `Function`, WebAssembly suministrado por el administrador ni
código JavaScript arbitrario.

Límites V1:

- 32–180 BPM; compases con denominador 4 u 8.
- Hasta 32 compases, 8 pistas, 512 eventos y 6 notas simultáneas por evento.
- Registro MIDI 24–108.
- Sintetizadores permitidos: `warm`, `pad`, `bell`, `pluck`, `bass`.
- Sin letras, muestras vocales ni comandos externos.
- Compilador: `tloque-score-compiler-v1`.

El plan lleva huella determinista del fuente. Al guardar, el servidor recompila
el texto y rechaza un plan que no corresponda a él.

## Sonidos de interfaz

`audio_event_bindings` relaciona un ID estable (`ui.orb.tap`,
`ui.page.turn`, etc.) con un activo `system` publicado. La asignación guarda
volumen y cooldown sin duplicar el activo. El cliente descarga un manifiesto
pequeño, precarga archivos y conserva un fallback local si la base no está
disponible o la migración aún no se aplicó.

Una receta `UiSoundRecipe V1` admite hasta ocho voces acotadas de oscilador o
ruido, envolvente y filtro. Las voces se programan contra `AudioContext.currentTime`.
El sonido nunca es necesario para entender una acción y respeta el control de
efectos y volumen existente.

## Procedencia y licencias

Esta fase no incorpora audio ni código de repositorios externos. Los activos
iniciales de interfaz son recetas originales de Tloque, marcadas como
`Propio · Tloque`; Tone.js y SpessaSynth conservan las dependencias ya aprobadas
en el proyecto. Todo archivo o SoundFont nuevo sigue requiriendo URL HTTPS,
licencia, procedencia y, cuando se conoce, tamaño y SHA-256.

## Operación

Después de desplegar esta versión se ejecuta una vez:

```bash
npm run db:push
```

La migración `0011_audio_studio_and_ui_fonoteca.sql` amplía los tipos de fuente,
crea las asignaciones y registra los sonidos incorporados. Después puede usarse
`npm run build` de forma normal.
