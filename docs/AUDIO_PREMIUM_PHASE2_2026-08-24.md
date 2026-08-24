# Audio premium · fase 2 — 2026-08-24

## Cambio de criterio

`quality master` deja de significar solamente “usar el renderer de mayor calidad”. Para bancos nativos también exige que la cobertura física de la obra sea suficientemente segura.

Antes de decodificar cientos de MB, el exportador ejecuta dos puertas:

1. preflight de presencia e identidad de manifests;
2. auditoría física por combinación semántica de articulación, vibrato, sordina, trigger y micrófono.

Master se detiene si falta un banco, el manifest es inválido, la partitura no puede construir su plan o una combinación utilizada queda clasificada como `risk`. Un banco `sparse` queda como advertencia para futuras herramientas de UI, pero no bloquea por sí solo.

## Por qué

El objetivo es impedir que una exportación etiquetada Master esconda una biblioteca insuficiente mediante pitch-shift agresivo. Los modos inferiores conservan su política de fallback para iteración rápida; Master no.

## Siguiente trabajo

1. Exponer el informe de readiness en el Compositor antes de pulsar Exportar.
2. Tratar `native-auto` como router virtual en la UI, no como asset SoundFont único.
3. Buscar fuentes legales para los ocho `missing-source` del índice maestro.
4. Priorizar densificación de cualquier combinación `risk` que aparezca en una obra real.
5. Después de quedar verde el readiness, hacer un único WAV Master de comparación.
