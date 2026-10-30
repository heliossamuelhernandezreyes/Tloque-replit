# Tloque: permisos, privacidad y preparación comercial

Fecha de implementación: 30 de octubre de 2026. Basado en la revisión jurídica
preliminar del 29 de octubre. Este paquete no acredita permisos públicos ni
aprobación de proveedores, y no reemplaza dictámenes profesionales.

## Qué implementa

- Los términos, privacidad y licencia se sirven desde un único texto canónico.
- Publicar o cambiar una versión expresiva exige una declaración afirmativa,
  procedencia y opciones individuales. Empiezan todas desmarcadas.
- La escritura de la obra, su revisión y el comprobante se confirman en la misma
  transacción. Si falta permiso o cambió el documento, todo se revierte.
- El comprobante guarda usuario, obra, revisión, documento íntegro, versión,
  SHA-256 de documentos y contenido, categoría, reparto propuesto y fecha.
- No se crean aceptaciones para usuarios/obras anteriores por migración.
- Gutenberg importa como borrador; la publicación requiere revisar la edición,
  traducción y alcance territorial y confirmar los permisos desde el editor.
- Una preferencia de comentarios no crea una aceptación ficticia. Los permisos
  se resuelven por huella de contenido, autor, categoría y recursos de la obra.
- Nuevos permisos de impresión requieren la elección personal o comercial.
- Nuevas solicitudes de audiolibro y publicación de perfiles de voz requieren
  autorización de audio para esa versión. El documento no acredita derechos de
  una voz concreta ni cumplimiento de un proveedor.
- Una novela de un capítulo utiliza `type=book` y conserva 90/10 para nuevas
  operaciones; `type=story` usa 50/50. Las instantáneas de órdenes pasadas no se
  reescriben. La clasificación por capítulos queda solo para entradas antiguas
  sin categoría explícita.
- Las nuevas compras y el sorteo tienen controles adicionales de habilitación.
  Cobros, liquidaciones y sorteos siguen requiriendo sus configuraciones previas.
- Cualquier persona puede presentar solicitudes de privacidad y descargar un
  comprobante sin iniciar sesión. Recibir no verifica identidad ni ejecuta datos.
- La bandeja administrativa exige `managePrivacy`, disponible para `full`; roles
  de finanzas/catálogo/legado no reciben acceso por inferencia.

## Datos y revisiones pendientes

Configura únicamente datos públicos de atención legítimos del responsable:

| Variable | Dato |
|---|---|
| `LEGAL_OPERATOR_NAME` | Nombre legal de persona física o razón social real. |
| `LEGAL_OPERATOR_ADDRESS` | Domicilio válido de atención y cumplimiento. |
| `LEGAL_PRIVACY_EMAIL` | Correo atendido para solicitudes y seguimiento. |
| `LEGAL_SUPPORT_PHONE` | Teléfono de atención requerido para habilitar comercio. |
| `LEGAL_PUBLICATION_REVIEW_REF` | Referencia real de revisión del texto/flujo de publicación. |
| `LEGAL_COMMERCIAL_REVIEW_REF` | Acuerdo comercial, fiscal, editorial y de consumidor aprobado. |
| `TINTA_LEGAL_REVIEW_REF` | Dictamen del circuito efectivo de créditos y liquidaciones. |
| `GACHA_LEGAL_REVIEW_REF` | Dictamen de la mecánica exacta del sorteo. |
| `GACHA_AUTHORIZATION_REF` | Expediente/resultado aplicable de su autorización pública. |
| `GACHA_PROCESSOR_APPROVAL_REF` | Aceptación expresa compatible del procesador. |

Las referencias son declaraciones operativas del responsable, no una verificación
automática ante autoridades. No usar `true`, valores de prueba ni inventar
expedientes para abrir funciones. Conservar documentos y condiciones exactas,
verificar su alcance y revisar nuevamente ante cambios del modelo o del texto.

Sin identidad/revisión no se abren nuevas publicaciones; sí pueden guardarse
borradores y leerse contenidos disponibles. Sin revisión comercial/Tinta no se
abren nuevas compras. Sin referencias específicas no se activa el sorteo aunque
la base tenga `enabled=true`; tampoco puede habilitarlo su preparación de beta.

## Rutas

| Ruta | Función |
|---|---|
| `/privacy`, `/terms` | Documentos actuales, accesibles sin cuenta. |
| `/privacy/requests` | Formulario público y comprobante descargable. |
| `/legal/receipts` | Permisos propios y descarga íntegra. |
| `/admin/privacidad` | Bandeja reservada a privacidad. |
| `GET /api/legal/documents` | Texto, versión, huella y estado de habilitación. |
| `GET /api/legal/receipts` | Solo comprobantes del usuario autenticado. |
| `POST /api/privacy/requests` | Alta con límite de solicitudes, sin datos adjuntos. |
| `GET/PATCH /api/admin/privacy/requests[/id]` | Listado/actuaciones con permiso específico. |

Un folio público no permite consultar contenido privado. Cambiar un estado
administrativo no envía correo, prueba que se respondió ni elimina información.
El responsable debe verificar identidad, atender plazos y contestar por su canal
real; la bandeja guarda las actuaciones en `privacy_request_events`.

## Migración y despliegue

1. Revisar los cambios y obtener un respaldo recuperable de PostgreSQL.
2. Instalar con `npm ci`, ejecutar `npm run db:preflight` y `npm run db:migrate`.
3. `0024` añade tablas de aceptación/solicitudes/eventos e impide editar o borrar
   evidencias por el CRUD ordinario. No acepta permisos ni elimina manuscritos.
4. Desplegar código y migración como una misma entrega, y verificar los documentos
   públicos, contacto y bandeja con cuentas de roles diferentes.
5. Resolver obligaciones e ingresos anteriores expresamente antes de sustituir
   una instalación comercial: los controles pueden bloquear nuevas solicitudes
   de liquidación si falta habilitación. No confundirlo con extinción de deuda.
6. Mantener el sorteo y cobros cerrados hasta revisión efectiva. No copiar la
   configuración de `scripts/fixtures/legal-config.mjs`: es exclusivamente QA.

## Límites que esta entrega no resuelve

- No constituye sociedad, alta fiscal, registro de marca ni obtiene permisos.
- Falta resolver la marca TLOQUE y su análisis cultural, precio único, ISBN,
  depósito, facturación, retenciones y base comercial de reparto.
- No audita cada traducción, muestra, fuente, imagen, voz o modelo del catálogo.
- Las elecciones offline, traducción y coleccionables quedan registradas; falta
  completar su control específico en todos los recorridos. No anunciar esa
  aplicación como terminada. La obtención de permisos no reemplaza derechos
  concretos del activo o términos del proveedor.
- No convierte una casilla de mayoría de edad en un sistema de verificación.
  La contratación con representante/tutor requiere un recorrido adicional.
- No completa la depuración de manuscritos/versiones/respaldos tras baja. El
  aviso describe la retención actual y permite solicitar revisión sin cuenta.
  Falta fijar fundamento, bloqueo, periodos y procedimiento de purga por clase.
- La conservación de evidencias tampoco es indefinida por defecto: sus accesos,
  plazos y supresión justificada deben incluirse en ese procedimiento. El trigger
  de inmutabilidad protege el CRUD ordinario; no sustituye dicha política.
- No implementa todavía contratación ni cancelación de suscripciones recurrentes.
- Las compras históricas y cachés no se consideran saneados automáticamente.
- No es DRM: un archivo ya entregado o una impresión física no pueden retirarse
  remotamente. Una orden válida o una infracción requiere tratamiento propio.

## Verificación

`npm run check`, `npm test`, `npm run build`, `npm run check:bundle`.
Las pruebas nuevas ejecutan todas las migraciones en PostgreSQL embebido PGlite,
repetición de `0024`, restricciones e inmutabilidad, transacciones de permisos y
HTTP de privacidad con roles. Usan datos sintéticos y no llaman a OAuth/Stripe.
Las pruebas de interfaz comprueban decisiones desmarcadas, confirmación afirmativa,
cierre por configuración pendiente y recepción sin sesión. No equivalen a una
prueba visual en Android ni a un ensayo de despliegue en Replit.

Los ensayos existentes de seguridad/pagos conservan PostgreSQL y procesos reales
en CI, con referencias y declaraciones simuladas explícitas para sus fixtures.
