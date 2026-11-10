# Correcciones de la auditoría profunda de Tloque

Base comprobada: `main` en `d135b83a9ce9c201290914b99146ab85962d631e` (PR #127). Implementación: 10 de noviembre de 2026. Este documento describe los cambios de la rama; su publicación en un PR no equivale a desplegarlos.

| Hallazgo | Corrección | Verificación |
| --- | --- | --- |
| F01 · Cartas sin permiso comercial | La compra y su cotización comprueban permisos de coleccionables, monetización, copia permanente y descarga, más un acuerdo económico vigente y revisado para esa edición. El comprador acepta un desglose ligado a su cuenta, saldo, carta y obra antes del débito. | HTTP: rechazo sin permisos/acuerdo/aceptación, cotización obsoleta y compra concurrente. |
| F02 · Audio de obra retenida | Texto, audio y experiencia narrativa comparten resolución de edición. Una retención por derechos o estado de revisión impide la reproducción directa, incluso con suscripción. El audio se verifica contra el texto seleccionado. | HTTP: reproducción válida antes de retención y rechazo posterior, incluido el propietario. |
| F03 · Caché ordinaria con manuscritos | Las consultas guardan metadatos. Al iniciar la sincronización se eliminan los textos de la caché ordinaria antigua. Solo el almacén de descargas explícitas permite recuperar texto sin conexión; los borradores del editor siguen separados. | Hook real de React: conexión, desconexión, caché heredada, descarga denegada y descarga autorizada. |
| F04 · Carta sin edición literaria fija | Las cartas nuevas pagadas guardan `edition_id`, consentimiento y términos económicos. El texto comprado sobrevive a una edición posterior y a un retiro ordinario. La base impide cambiar su identidad. | HTTP + PostgreSQL: edición conservada, un débito concurrente y restricciones de integridad. |
| F05 · Recarga confundida con reintento | Consulta privada de órdenes por ID o clave; conciliación de la intención al abrir el monedero y al regresar de Checkout. Un replay devuelve cero crédito nuevo. Solo las operaciones terminadas liberan su clave. | HTTP: propiedad de orden, replay sin crédito extra y nueva orden; pruebas del ciclo de claves. |
| F06 · Dirección narrativa obsoleta | Cada perfil compilado guarda la huella del manuscrito. La entrega comprueba esa huella y, si el lector la envía, la revisión solicitada. Un perfil incompatible no entrega música ni capas. | HTTP: editar el texto invalida el perfil; comprobación de migración de huellas. |
| F07 · Finalización no sincronizada | `/api/sync/state` incluye `completed`. | HTTP: lectura finalizada persiste y vuelve en la respuesta. |
| F08 · Autores homónimos mezclados | Perfiles y enlaces por ID de cuenta; clásicos en una ruta separada. Los enlaces antiguos ambiguos devuelven candidatos, sin combinar obras o biografías. | HTTP: dos cuentas con el mismo nombre, perfiles independientes y conflicto explícito del enlace antiguo. |
| F09 · Obras ausentes en CardStudio | El taller consulta `/api/books/mine`, con borradores y obras propias fuera de la primera página pública. | HTTP: obra propia ausente del catálogo inicial y presente en el catálogo privado. |
| F10 · Cuota compartida entre cuentas | La barrera inicial por IP tiene un techo mayor; la cuota normal se aplica después de Passport y usa la cuenta como identidad, aunque cambie de IP. Webhooks conservan su validación propia. | HTTP: 300 solicitudes repartidas no bloquean otra cuenta; exceso de una cuenta sí. Prueba de cambio de IP. |
| F11 · Arte premium en Gutenberg | La vista previa importada usa la proyección común y elimina recursos premium sin derecho de acceso. | HTTP: catálogo y vista previa anónima devuelven los mismos campos protegidos vacíos. |
| F12 · Carrera de borradores | Guardado canónico, restauración, retiro y borrador usan el mismo bloqueo. Propiedad y revisión se comprueban después de tomarlo. Una publicación solo elimina el borrador que reconoce expresamente; descartar exige su revisión actual. | HTTP concurrente: borrador antiguo rechazado después de esperar; copias no reconocidas conservadas y descarte antiguo rechazado. |
| F13 · Estado de otro libro en Reader | El lector se reinicia por ID y comprueba identidad antes de mostrar contenido o sincronizar progreso. Una hidratación anterior queda cancelada. | Componente real de React: A → B cargando → B disponible → B inexistente, sin texto o máximo de A en B. |
| F14 · Dependencias vulnerables | Vite 7.3.8 y `postcss-selector-parser` 6.1.6; el override se limita a la dependencia de tipografía. | Auditoría completa npm: cero vulnerabilidades conocidas; compilación y presupuesto de carga correctos. |
| F15 · `main` sin protección | Configuración de protección y aplicador administrativo preparados y validados. Requiere PR, comprobaciones obligatorias, conversaciones resueltas y prohíbe force-push/borrado; también protege al administrador. | **Pendiente de activar en GitHub**: la conexión disponible carece de permisos administrativos. |

## Validación local

- TypeScript y compilación de producción correctos; presupuesto de carga respetado.
- 704 pruebas unitarias/componentes/migración correctas.
- 19 pruebas de renderizado real de audio correctas.
- 25 grupos de pagos/licencias correctos, con 22 llamadas al simulador local de Stripe; ningún pago real.
- 11 grupos de límites de cuenta y permisos correctos y 11 grupos nuevos de regresión de auditoría correctos.
- Migraciones desde vacío hasta `0029` verificadas en PostgreSQL 16.15. La migración nueva también se repite y ensaya sobre registros heredados con PGlite.

Las pruebas de navegador completas y el ensayo de actualización desde `db:push` se ejecutan en GitHub Actions. Los nuevos casos HTTP se incorporan al workflow `Audit regressions` en cada PR y actualización de `main`.

## Puesta en marcha

1. Aplicar la migración `0029` mediante `npm run db:migrate` antes de iniciar este código. No ejecutar `db:push` como sustituto del migrador.
2. Publicar juntos servidor y cliente. Los clientes antiguos sin aceptación de compra de carta recibirán un rechazo explícito y deberán actualizarse.
3. El acuerdo económico actual pasa a `2026-11-09.1` para incluir expresamente las cartas y su reparto histórico del 50% del efectivo atribuido. Las nuevas compras exigen aceptación del titular y revisión de este acuerdo por edición. Las liquidaciones anteriores conservan sus términos congelados. Esta corrección no representa una nueva aprobación jurídica ni configura proveedores de pago.
4. Los perfiles narrativos sin procedencia comprobable necesitan recompilarse y aprobarse de nuevo. La migración solo rellena la huella cuando coincide exactamente la revisión del proyecto fuente.
5. Las cartas históricas conservan `edition_id = null`: no se inventa retroactivamente el texto ni el consentimiento de su adquisición. Conservan el mecanismo histórico de lectura; solo las nuevas compras quedan fijadas con certeza a su edición.
6. Un administrador de GitHub debe activar la protección pendiente. `npm run check:main-protection` valida el archivo local; `node scripts/protect-main.mjs --apply`, desde un entorno autenticado con permiso Administration, aplica y verifica la configuración. El aplicador se detiene si la rama ya está protegida para evitar sobrescribir otra política.

Fuentes de las actualizaciones de seguridad: [aviso de PostCSS](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) y [aviso de Vite/launch-editor](https://github.com/advisories/GHSA-587h-7wmj-h5pm).
