# Director Artificial y Partitura avanzada v2

## Frontera de seguridad

El Director Artificial (DA) es un analista editorial. Su salida es JSON validado
y se almacena como una capa lateral al manuscrito. No puede:

- cambiar, corregir ni duplicar el texto canónico;
- generar audio o música;
- seleccionar pistas fuera de la Fonoteca publicada;
- publicar una partitura o un audiolibro;
- reemplazar indicaciones que el autor haya bloqueado.

La propuesta siempre sigue este recorrido:

1. El servidor calcula una cotización y un máximo de Papel.
2. El usuario confirma la reserva.
3. El DA produce dirección de voz y música estructurada.
4. El servidor valida anclas, catálogo, revisión y hash del manuscrito.
5. El autor revisa, edita, bloquea y aplica la propuesta.
6. Al aplicarla se sincronizan los proyectos v1 de voz y música existentes.

## Contrato lateral

`AdvancedDirectionProjectV2` contiene:

- `contentHash`, nunca el manuscrito;
- `voiceProject`, compatible con el editor y compilador de voz v1;
- `musicProject`, compatible con la dirección narrativa v1;
- `voiceNotes`, con emoción, proyección, estado vocal e indicaciones para
  ElevenLabs asociadas por `spanId`;
- `musicNodes`, con `scoreId` y `layerIds` publicados, entrada, salida y
  crossfade asociados por `regionId`;
- procedencia auditable: versión de prompt, proveedor, modelo y fecha.

## Papel e idempotencia

La cotización caduca a los diez minutos y queda ligada a usuario, obra,
capítulo, modo y hash del manuscrito. `requestKey` evita repetir un cobro.
Al ejecutar se reserva el máximo mostrado. Al terminar se cobra el uso medido
hasta ese máximo y se devuelve la diferencia. Si falla el proveedor o una
validación, se devuelve toda la reserva.

Este gasto corresponde únicamente al análisis del DA. La síntesis final con
ElevenLabs conserva su cotización, reserva y caché independientes.

## Compatibilidad y siguientes fases

Esta fase no cambia suscripciones ni reglas de lectura. También mantiene los
editores manuales actuales. Las siguientes fases pueden añadir un lienzo de
texto con anclas visuales, selección avanzada de voces, alineación por marcas
de tiempo y el modelo definitivo autor/lector para financiar el audiolibro,
sin cambiar el contrato ni el manuscrito.
