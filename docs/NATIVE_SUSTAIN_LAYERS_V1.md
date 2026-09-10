# Dinámica grabada durante notas sostenidas

## Alcance

El selector nativo ya mezclaba capas grabadas y raíces vecinas al atacar una nota. Sus pesos quedaban fijos, aunque `expression` cambiara durante el sustain. Ahora las rampas de expresión también mueven los pesos de las capas existentes durante esa misma nota. El filtro tímbrico y la envolvente musical siguen siendo etapas independientes.

No se añadieron modelos generativos, dependencias, APIs, compras, muestras ni respuestas de impulso. Los archivos de prueba contienen PCM sintetizado localmente, no grabaciones acústicas ni evidencia de una escucha humana.

## Contratos

| Capa | Versión |
|---|---|
| Lenguaje / compilador | `TLOQUE_SCORE 2` / `tloque-score-compiler-v2.3-classical-import`, sin cambios |
| Esquema de bancos | `TloqueSamplePack` versión 1, sin migración |
| Selector sostenido | `tloque-native-layer-dynamics-v1` |
| Player nativo | `tloque-native-sample-player-v4-sustain-layers` |
| Perfil común | `tloque-score-audio-v10-sustain-layers` |
| Concierto nativo | `tloque-native-concert-v5-sustain-layers` |
| Skill copiable | 3.9.1 |

## Recorrido

1. El plan conserva la selección original de ataque. Muestrea la expresión escrita durante la nota, usando el mismo intérprete de la orquesta completa y su ponderación velocity/expresión.
2. El selector calcula qué grabaciones intervienen en algún punto de la trayectoria. Fija articulación, color, micrófono, round robin y raíz por capa; no vuelve a consultar/decodificar el banco por cada punto de control.
3. Todos esos buffers comienzan en el mismo ataque musical. Una capa que entra después comienza con peso cero; no se dispara otra vez ni reinicia su transitorio.
4. Una ganancia separada recibe la curva mediante `setValueCurveAtTime`, sobre el reloj de audio. Conserva el último peso durante la cola y se desconecta al terminar la fuente.
5. Realtime y WAV reciben exactamente el mismo `nativeSampleVoiceEnvelope`. La precarga incluye todas las capas seleccionadas, incluso las inicialmente inaudibles. El release grabado, cuando existe, se selecciona según la intensidad final del sustain.

La interpolación usa pesos seno/coseno de potencia unitaria en los puntos de control; esto no garantiza que grabaciones correlacionadas sumen con idéntica sonoridad perceptual. La ganancia propia del banco, velocity, balance del conductor, expresión y master siguen sus contratos separados. No se aplica dos veces la expresión como amplitud de muestra.

## Elegibilidad y límites

- Sólo notas clasificadas como sostenidas por `OrchestralDynamics` (duración interpretada de al menos 0.28 s, instrumento sin decay y articulación compatible).
- Se activa si la expresión escrita realmente cambia durante la nota. `brightness` por sí solo mantiene la mezcla inicial.
- Ataques de piano, arpa y guitarra, staccato, spiccato, pizzicato y one-shots mantienen su selección inicial. Transiciones true-legato y releases siguen siendo grabaciones físicas estrictas, no curvas que inventan otra articulación.
- Un banco de una sola capa o una trayectoria de pesos constante conserva la ruta estática, sin ganancia de automatización adicional.
- Hasta 4096 puntos por curva, con la cadencia nominal existente de 32 Hz. Hasta 8 fuentes seleccionadas por nota sostenida, incluyendo raíces interpoladas. Un recorrido mayor se rechaza con un diagnóstico, no se presenta como completo.
- El violín solista VSCO sigue usando una sola raíz por capa para no añadir doblaje entre raíces. Otras fuentes conservan el selector de raíces anterior.
- No se amplía la duración física de un WAV ni se inventan puntos de loop. La calidad, afinación, duración y coherencia de las grabaciones siguen limitando el resultado.
- No se elevan los límites existentes de memoria del render: 220 MiB para su buffer y 300 MiB para buffer más muestras decodificadas. El límite de 192 fuentes sintéticas sigue independiente y sin cambios; no debe confundirse con un límite global de samples nativos.
- La exportación nativa estricta/Master falla si cualquier capa necesaria no se puede cargar/decodificar. La recuperación de escucha Studio mantiene su indicación existente de fuente degradada; no certifica sonido acústico.

## Certificación

Los informes A/B híbridos registran también `sampleRendererVersion`. Un informe anterior o de otro player no puede aprobar Master. La lista de aprobaciones sigue vacía: los tests no conceden aprobaciones humanas ni activan overlays experimentales en Master.

## Verificación

`tests/native-sustain-layers.test.ts` prueba potencia de mezcla, selección física, determinismo, límites, trayectoria interrumpida, precarga, paridad de envolventes y selección final de release.

`tests/audio-render/native-sustain-layers.test.ts` renderiza PCM real con fuentes de prueba identificables: verifica el cambio espectral dentro de la nota, ausencia de reinicios adicionales, cola sin reaparición de una capa apagada, one-shots intactos, determinismo y exportación nativa a 24 bits/48 kHz. También simula una capa tardía ausente y exige que el render estricto falle.

Pendiente: comparación A/B a sonoridad igualada con los bancos realmente instalados, auriculares/altavoces y dispositivos móviles representativos. Estas pruebas técnicas no miden belleza musical ni demuestran que un banco concreto suene más natural. Convolución medida, nuevos bancos y stems individuales no forman parte de este cambio.
