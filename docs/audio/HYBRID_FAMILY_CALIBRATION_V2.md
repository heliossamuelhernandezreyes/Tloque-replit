# Hybrid family calibration v2

La calibración semi-automática ya no trata al overlay como un único fader. Un candidato experimental puede mover un conjunto pequeño y acotado de ejes físicos, siempre disparado por la peor celda/métrica de la matriz 3x3.

## Ejes efímeros

- `wetScale`: presencia total del overlay.
- `feedbackScale`: persistencia del resonador/waveguide; rango muy estrecho para evitar inestabilidad.
- `dampingScale`: frecuencia efectiva de amortiguamiento/tone; controla brillo físico, no un EQ del sample.
- `textureScale`: arco/aire/armónicos de excitación.
- `bodyScale`: resonancias de cuerpo/formantes/tabla.
- `decayScale`: duración física de la cola/release.

Todos parten de `1.0` y tienen límites conservadores. Los candidatos viven únicamente en la corrida experimental; `NATIVE_HYBRID_SOURCES` no se modifica.

## Mapeo por familia

### Bowed strings

- intrusión espectral: bajar `wet`, `texture` y `damping`.
- ataque dañado: bajar `wet` y `texture`.
- dinámica degradada: bajar `wet` y `feedback`.
- continuidad insuficiente: subir `wet`, `feedback` y `body`.
- cola insuficiente: subir `wet`, `feedback` y `decay`.

### Air column

- intrusión espectral: bajar `wet`, `damping` y `texture`.
- ataque dañado: bajar `wet` y `texture`.
- dinámica degradada: bajar `wet` y `feedback`.
- continuidad insuficiente: subir `wet`, `feedback` y `body`.
- cola insuficiente: subir `wet`, `feedback` y `decay`.

### Sympathetic resonance

- intrusión espectral: bajar `wet`, `body` y `damping`.
- ataque dañado: bajar `wet` y `body`.
- dinámica degradada: bajar `wet` y `body`.
- continuidad insuficiente: subir `wet`, `body` y `decay`.
- cola insuficiente: subir `wet`, `body` y `decay`.

## Seguridad y causalidad

Una propuesta responde a una sola peor celda y no cambia parámetros arbitrarios. La siguiente matriz decide si la dirección fue correcta. Un candidato puede mostrar mejora objetiva, pero su reporte contiene `calibrationCandidateId` y nunca es evidencia Master.

Para promover una mejora:

1. revisar que el peor caso realmente mejore y que no se creen nuevas regresiones;
2. incorporar conscientemente la afinación al perfil del instrumento/familia;
3. subir `engineVersion` porque cambió el comportamiento acústico;
4. descartar la evidencia anterior;
5. ejecutar nuevamente la matriz 3x3 completa;
6. realizar un nuevo A/B ciego;
7. sólo entonces registrar evidencia Master.

El objetivo es optimización trazable, no búsqueda automática ilimitada.
