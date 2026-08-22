# Estudio de audio V2 · código, módulos y exportación

## Contratos

- Audio: `tloque-audio-2026-08-v2`.
- Compilador nuevo: `tloque-score-compiler-v2`.
- Compatibilidad: las recetas V1 continúan compilando y reproduciéndose con `tloque-score-compiler-v1`.
- Política: únicamente música instrumental. El lenguaje no acepta letras, JavaScript, `eval` ni comandos arbitrarios.

El código TloqueScore es la fuente maestra. Al editarlo se invalida el plan anterior; al compilar se crea un plan determinista con huella, semilla, secciones, tiempos y eventos. La reproducción ejecuta ese plan sin crear un archivo. `Exportar WAV` renderiza una copia sólo bajo demanda.

## TloqueScore V2

V2 permite escribir una obra extensa o una sonata con exposición, desarrollo, recapitulación y coda. Cada sección puede tener tempo propio; los silencios y las transiciones se declaran explícitamente.

```text
TLOQUE_SCORE 2
title "Sonata para el lobby"
tempo 72
meter 4/4
loop false
seed 20260822
quality master
module orchestra-core

track violin synth=pad instrument=strings.violin program=40 role=melody gain=0.24 pan=0.1 attack=0.18 release=1.6

section theme-a form=exposition bars=8 repeat=2 fade=1 tempo=72
use violin
1:1 E4 1 velocity=0.46 articulation=legato
rest 1:2 1
1:3 G4 2 velocity=0.5
end
```

Límites operativos: 256 compases, 16 pistas, 8,192 eventos, 32 secciones y 30 minutos por código. Para obras mayores se guarda cada movimiento como tema separado; esto mantiene la edición y exportación viables en móviles.

## Calidad y módulos descargables

| Nivel | Reproducción/exportación | Almacenamiento |
|---|---|---|
| `core` | Síntesis base; WAV 32 kHz/16-bit al exportar por defecto | Sin descarga |
| `studio` | Banco opcional; WAV 48 kHz/16-bit | Módulo individual en Cache Storage |
| `master` | Banco opcional; WAV 48 kHz/24-bit | Módulo individual en Cache Storage |

Un banco publicado se vuelve módulo al incluir una etiqueta `module:id`, por ejemplo `module:orchestra-core`. Debe declarar URL HTTPS SF2/SF3, tamaño, SHA-256, licencia y procedencia. El administrador o el dispositivo puede descargarlo y retirarlo sin borrar el código musical.

Cuando el código declara un módulo disponible, el reproductor agenda sus notas SF2/SF3 contra el reloj de `AudioContext`. Si el módulo falta durante una previsualización, Tloque puede usar síntesis base; no permite publicar la receta como si tuviera ese banco.

No se incluye ningún banco de terceros en el repositorio. Cada activo debe superar revisión de licencia y procedencia antes de publicarse.

## Exportación WAV

El renderizador PCM trabaja por bloques para no reservar en RAM el audio completo. Incorpora envolventes por instrumento, paneo constante, cola de sala determinista y limitador. Antes de exportar muestra resolución y tamaño estimado. El límite por WAV es 750 MB.

MP3 se admite como entrada, no como exportación V2: WAV evita introducir un codificador con pérdidas y conserva un maestro apto para transcodificación posterior.

## Importación MP3/WAV

La Fonoteca acepta carga directa de MP3 o WAV de hasta 96 MB. El servidor:

1. autentica al administrador antes de leer el cuerpo;
2. valida la firma binaria, no sólo la extensión;
3. calcula SHA-256 y deduplica por contenido;
4. guarda el original en Replit App Storage sin comprimir;
5. registra una URL interna opaca en el activo de Fonoteca.

Se debe crear o conectar un bucket en la herramienta **App Storage** del Repl antes de la primera carga. Los archivos mayores deben usar un CDN autorizado.

## Dependencias y procedencia

- Tone.js, MIT: síntesis base y reproducción V1/V2.
- SpessaSynth, Apache-2.0: reproducción de bancos SF2/SF3.
- `@replit/object-storage` 1.0.0, MIT: almacenamiento durable de originales importados. Véase la [documentación oficial de App Storage](https://docs.replit.com/features/sdks/object-storage-javascript-sdk).

Se excluyen dependencias AGPL/GPL y bancos sin licencia por activo. No se descargan repositorios o instrumentos de GitHub en tiempo de ejecución.

## Validación pendiente fuera de CI

- escucha comparativa con audífonos y altavoces móviles;
- presupuesto de CPU/batería por dispositivo;
- prueba de bancos SF2/SF3 reales y sus programas MIDI;
- prueba de carga y reproducción con el bucket de producción;
- evaluación UX del progreso de exportaciones de 15–30 minutos.
