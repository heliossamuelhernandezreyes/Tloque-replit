# Siguiente tramo de biblioteca premium

Una vez verde la integración Martin HD28, el siguiente cambio debe implementar `ProvenanceSource`/adaptadores sin mezclarlo con DSP.

Orden recomendado:

1. `direct-https-fixed` + Iowa Bass Clarinet.
2. Reutilizar el adaptador para Iowa Bass Trombone.
3. `gitlab-commit`/origen inmutable + A Sampled Celesta.
4. Soporte FLAC end-to-end + FreePats nylon.
5. Continuar búsqueda de English Horn y Contrabassoon sin degradar el umbral Master.

Cada incorporación debe incluir: manifest, fuente fijada, prueba de licencia/procedencia, prueba de compilación física, integridad de `NATIVE_LIBRARY_INDEX` y una auditoría de demanda sobre una partitura real antes de declarar el módulo listo para Master.
