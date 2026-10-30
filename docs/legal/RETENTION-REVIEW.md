# Revisión de conservación y supresión

Estado: procedimiento preparatorio, sin purga automática ni plazos aprobados.

Referencia de contraste: [LFPDPPP, texto de la Cámara de Diputados](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf),
consultado el 30 de octubre de 2026, arts. 10, 24–25 y 28. La decisión particular
debe revisar también las obligaciones contractuales y fiscales aplicables.

Cerrar una cuenta actualmente seudonimiza el perfil, revoca sesiones, elimina
progreso/guardados/borradores de recuperación y retira obras. No elimina todos
los manuscritos, proyectos ni archivos externos. Este comportamiento está
declarado en el aviso; no acredita por sí solo que toda conservación sea válida.

## Preparar un expediente concreto

1. Verificar proporcionalmente la identidad y facultades de quien solicita.
   El correo o folio, por sí solos, no prueban titularidad. No copiar documentos
   sensibles a las notas de la bandeja.
2. Ejecutar en el entorno correcto y con acceso autorizado:
   `npm run legal:retention:inventory -- --user-id 123`.
   Usa una transacción de solo lectura y devuelve conteos por relación, sin
   manuscritos, contactos, claves de objetos ni datos bancarios.
3. Completar los datos de abajo por categoría; la herramienta no decide qué
   conservar y no suma relaciones solapadas como si fueran personas distintas.
4. Delimitar bloqueos/reclamaciones y prestaciones previamente adquiridas;
   conservar solo lo necesario conforme a la decisión fundamentada del caso.
5. Revisar manualmente archivos, proveedores, respaldos, sesiones y referencias
   no declaradas como claves foráneas. El inventario no los inspecciona.
6. Aprobar y ensayar un procedimiento separado sobre una copia recuperable.
   Registrar qué se suprimió o bloqueó, excepciones, comprobación y respuesta.
   Cambiar el estado a «Respondida» no sustituye esa actuación.

## Matriz a completar con el responsable y su asesor

| Categoría | Decisión que falta |
|---|---|
| Perfil, sesiones, biblioteca y progreso | Confirmar la supresión y réplicas, con excepción documentada si existe. |
| Manuscrito actual, versiones y proyectos | Distinguir borradores privados de ediciones previamente entregadas; justificar campos y periodos mínimos. |
| Licencias y actuaciones de privacidad | Finalidad probatoria concreta, campos mínimos, acceso, vencimiento y supresión justificada. La inmutabilidad ordinaria no fija plazo indefinido. |
| Órdenes, ganancias, liquidaciones e incidencias | Obligación aplicable, saldo/reclamación pendiente, fundamento y cómputo del periodo correspondiente. |
| Tarjetas, impresiones y desbloqueos entregados | Alcance de la autorización y solución ante retiro o infracción; evitar exponer una versión privada posterior. |
| Imágenes, voces, audio, cachés y proveedores | Ubicación, contratos, subencargados, procedimiento y constancia de eliminación o bloqueo. |
| Respaldos y registros técnicos | Rotación, vencimiento, acceso y tratamiento si se restaura un respaldo anterior a una supresión. |
| Solicitudes no vinculadas a cuenta | Relación verificada con la persona y minimización; no enlazarlas automáticamente por un correo no comprobado. |

No ejecutar `DELETE` general, desactivar triggers ni decidir plazos copiando un
ejemplo. Falta aprobar esta matriz y construir la purga que corresponda a esas
decisiones. Una migración o un cambio de configuración no ejecuta ese trámite.
