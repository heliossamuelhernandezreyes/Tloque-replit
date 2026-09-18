# Auditoría: reembolsos, compras y permisos de ejemplares

Este bloque corrige F02, F04 y la parte de ciclo de licencia de F05 de la auditoría del 16 de septiembre (PR #114). Continúa la separación de cuentas/permisos y no-store de PR #115. No cambia precios, porcentajes de reparto ni habilita pagos reales.

## Contratos económicos

- Compras de tokens y recargas requieren `Idempotency-Key` (16–128 caracteres, letras, números, `_` y `-`). La clave se guarda por cuenta y operación con la huella de sus parámetros. Repetirla devuelve la misma orden, token o Checkout; cambiar parámetros devuelve 409. La UI la conserva si se pierde conexión o falla el servidor y la elimina al confirmar el resultado. Los detalles y claves de copias se reconstruyen desde los registros cifrados; no se guardan secretos en respuestas de idempotencia.
- Checkout usa siempre la misma clave de proveedor y el mismo cuerpo persistido, incluida la caducidad. Un timeout no marca arbitrariamente la orden como fallida. Pasado el vencimiento se exige una nueva intención. Los checkouts históricos siguen aceptando su webhook; un apoyo duplicado pagado sigue el flujo de reembolso existente.
- `checkout.session.completed` y `checkout.session.async_payment_succeeded` validan sesión, importe, moneda y estado de pago. Acreditar y aplicar incidencias anteriores ocurre dentro de la misma transacción. Todos los caminos comparten el orden de bloqueos pago → propietario.
- Reembolsar un paquete añade un movimiento compensatorio: nunca edita el historial. Una devolución parcial retira la proporción acumulada de unidades, redondeada hacia arriba. La devolución total retira exactamente el paquete, bonos incluidos, y su respaldo monetario. Cada nueva notificación aplica solo la diferencia pendiente.
- Si esa Tinta ya se gastó, el saldo puede ser negativo. No se permiten gastos sin saldo suficiente. Las siguientes recargas compensan primero esa deuda. El historial conserva el respaldo consumido y su ajuste; una incidencia abierta sigue bloqueando liquidaciones a autores hasta conciliación.
- Reembolsos y disputas simultáneos reservan importes acumulados con un máximo del pago original. Si una disputa incluye importe ya devuelto, la reserva se conserva hasta conciliar; nunca se debita más de un paquete por esa recarga. `funds_restored` libera solo la incidencia restaurada. `liability_reconciled` cierra la revisión administrativa pero mantiene la pérdida, sin recrear crédito.

## Webhooks y licencias

Los eventos de incidencia se deduplican por ID. `charge.refunded` aporta un total acumulado: una notificación antigua no reduce una devolución ya aplicada. Las disputas se verifican contra el objeto actual de Stripe, sin ordenar por `event.created`. Si Stripe no responde, se conserva una suspensión preventiva y se responde 500 para que reintente; ese evento no se marca como procesado.

Un permiso es `active`, `suspended` (disputa o devolución parcial) o `revoked` (reembolso total). Se bloquean las nuevas activaciones y el uso comercial de permisos no activos. La lista del propietario conserva el historial, omite la clave y deshabilita la impresión. El botón de imprimir consulta de nuevo el estado antes de iniciar una exportación. Se puede registrar una devolución física aun con permiso suspendido.

Una copia ya reclamada por otra persona conserva el acceso digital: el reembolso del vendedor no castiga al lector. El comprador del permiso pierde su acceso derivado solo cuando no tiene otro apoyo válido o una copia reclamada que lo justifique. Ganar una disputa restaura el mismo permiso y sus claves, sin emitir otros ejemplares. El acceso a tarjetas ya otorgadas no se modifica en este bloque.

Esta validación controla nuevas operaciones en Tloque. Un PDF ya exportado, una copia impresa o contenido descargado no se puede retirar técnicamente. La aplicación no incorpora DRM.

## Migración y operación

1. Detener la app para evitar procesos usando simultáneamente esquemas distintos.
2. Actualizar el repositorio e instalar las dependencias habituales si cambió el lockfile.
3. Ejecutar `npm run db:migrate` con `DATABASE_URL` y el `CLAIM_KEY_SECRET` persistente existente.
4. Arrancar una sola instancia del flujo habitual y recargar las pestañas del navegador.

La migración **0018** añade las columnas, índices y recibos de eventos. Compensa también las recargas históricas con incidencias registradas, recalcula permisos afectados y conserva las reclamaciones de terceros. Todo se aplica dentro de la transacción del migrador. No elimina datos ni regenera secretos. Las operaciones ajenas a Tloque o devoluciones nunca notificadas por Stripe necesitan conciliación externa: la migración no puede inferirlas.

En Stripe, el endpoint de pagos debe recibir los eventos Checkout mencionados arriba y `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn` y `charge.dispute.funds_reinstated`. Se mantiene la verificación HMAC del cuerpo original. La resolución manual exige capacidad `manageFinance` y una nota; solo debe marcarse `funds_restored` con evidencia de recuperación del dinero.

## Verificación reproducible

- Pruebas unitarias: redondeo/cotas, devoluciones parciales, pérdidas conciliadas, restauraciones superpuestas, moneda inválida, precios y firma HMAC.
- `scripts/check-payment-boundaries.mjs`: tres procesos reales de la app, Passport, PostgreSQL 16 y transporte Stripe simulado únicamente en CI. Comprueba concurrencia entre instancias, respuesta de proveedor perdida, compras/recargas beta y Stripe, reembolso después de gastar, eventos anteriores al Checkout, disputas fuera de orden, caída del proveedor, bloqueos QR, protección del lector, restauración y migración histórica repetida.
- Workflow `Payment and licence boundaries`: base desechable `tloque_payments`; sin credenciales de producción, pagos reales ni servicios de Replit. Los resultados se conservan como artefacto de CI.
- Siguen siendo obligatorios los controles generales de tipos, unidad, build, migraciones, límites de permisos/cuentas y pruebas de navegador, audio e impresión del repositorio.

## Pendientes de la auditoría

Este bloque no declara terminada la auditoría integral. F06 (retorno al QR después del login y dominio canónico de PDFs), F07 (portadas externas bajo CSP), importación de GLB con animaciones, PDF/X y la revisión visual integral conservan su seguimiento pendiente. Los estados de permiso y el saldo pendiente sí son visibles en la UI desde este bloque.

## Fuentes primarias

- [Stripe: entrega, duplicados y orden de webhooks](https://docs.stripe.com/webhooks).
- [Stripe: reembolsos y eventos](https://docs.stripe.com/refunds).
- [Stripe: funcionamiento de disputas](https://docs.stripe.com/disputes/how-disputes-work).
