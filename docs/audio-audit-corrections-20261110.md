# Correcciones de la auditoría de audio

Base auditada: `ab3b533b63451b2e84746f4d67590596c0b78eca`. Implementación: PR #129.

## Correspondencia de hallazgos

| Hallazgo | Corrección | Regresión |
|---|---|---|
| A01/A06: pausa de transiciones | Pausar todos los decks y conservar el progreso del fundido | Primitivas controladas y medios reales en Chromium |
| A02: maestro cero deja el saliente | Ganancias por deck separadas del maestro; cero inmediato | Primitivas controladas y Chromium |
| A03: estado después de ended | Finalización limitada al deck propietario | Evento ended real en Chromium |
| A04: cargas tardías | Generaciones por backend, abort de recursos, cierre de contextos y propiedad del estado | Stop/pause/dispose procedural real; cierre de módulos durante worklet loading; propietario nativo reemplazado |
| A05: capas tardías | Instantánea score/capas y coalescencia de setters antiguos | Selección de backend con el coordinador real |
| A07: capas desfasadas al arrancar | Preparar todas antes de iniciar cualquier reloj de medio | Dos WAV reales, uno servido con 600 ms de demora |
| A08: otra intención con la misma clave | Comparación con identidad del job y cacheKey; serialización de la clave | HTTP con reintentos, conflicto entre capítulos y peticiones concurrentes |
| A09: trabajo retirado entregado | Revalidación de obra, derechos, perfil y voces al claim, heartbeat y complete; devolución transaccional | HTTP con retirada durante cola/procesamiento, perfil obsoleto y control autorizado |
| A10: rampa de tempo cero | BPM inmediato por asignación; rampas positivas para transiciones | Tone real, sin sustituir su rampa para hacer pasar la prueba |
| A11: SHA ignorado | Verificación previa a decode y reparación de caché corrupta | Rechazo previo al decoder; WAV real válido e inválido en Chromium |
| A12: compás avanza en pausa | Planificación acotada con timestamps del reloj de audio | Tick de pared durante contexto pausado no emite eventos ni avanza fase |

## Observaciones asociadas

El audiolibro participa en el ducking con una identidad propia; el fin de otra voz no restaura la música mientras quede una voz activa. El componente de capítulo se remonta con su identidad para no conservar una clave de solicitud de otro capítulo.

La exportación reserva memoria de PCM a partir de la cabecera WAV antes de decodificar, comparte presupuesto entre módulos y decodifica secuencialmente cuando existe ese presupuesto. Las comprobaciones agregadas anteriores permanecen. El presupuesto no equivale a una medición de memoria del proceso del navegador.

La duración del compás nativo incluye el denominador. La finalización de un módulo no-loop y la retirada de un deck nativo consultan el reloj de audio, que se congela al suspender el contexto.

## Ejecución

La suite normal incluye los casos de controles y recursos (`npm test`). La suite de señal sigue siendo `npm run test:audio:render`.

`node scripts/check-audio-playback-browser.mjs` sirve WAV sintéticos y ejecuta Chromium mediante Playwright 1.62.1. La CI instala su navegador y adjunta `audio-playback-regressions`.

`CI=true DATABASE_URL=... node --import tsx scripts/check-audio-regressions.mjs` requiere PostgreSQL local y una base desechable llamada `tloque_audit`. No llama al proveedor de voz ni consume saldo de una cuenta real. La CI lo ejecuta después de las regresiones generales de auditoría.

Los nuevos resultados usan `passed: true` para comportamiento correcto. Esto difiere de las reproducciones originales, cuyo `confirmed: true` confirmaba el defecto.

## Contratos y alcance

Music Brain score/plan/timeline siguen en v1, reglas `tloque-music-brain-2026-08-v1.2` y conocimiento `tloque-music-knowledge-2026-08-v1`. No se importaron fuentes musicales, bancos o dependencias de producción nuevos ni se alteró el contrato del manuscrito o la partitura. Los cambios de interpretación inmediata de tempo y compás se limitan a su reproducción correcta.

La validación técnica no sustituye escucha comparativa, sesiones largas, Safari/iOS, interrupciones de sistema ni medidas de batería, temperatura y memoria en el Poco X7 Pro. La fusión en GitHub tampoco acredita un despliegue de producción.
