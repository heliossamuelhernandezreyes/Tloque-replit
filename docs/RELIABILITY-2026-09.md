# Correcciones de la auditoría de Tloque — septiembre de 2026

Esta entrega desarrolla los hallazgos F01–F22 de la auditoría del 24 de
septiembre. Prioriza conservar el trabajo del autor, la edición adquirida y
la integridad de los saldos. La presentación y los portales 3D siguen usando
el motor existente.

## Actualizar Replit

Detén la ejecución anterior con Stop o Ctrl+C para liberar el puerto 5000.
Desde la rama `main`, con el árbol de trabajo limpio:

```sh
git pull --ff-only origin main
node --version
npm ci
npm run replit
```

El proyecto usa **Node 24** (`.replit`, `.nvmrc`, `engines` y CI). Si la shell
todavía muestra Node 20, recarga el entorno de Replit para aplicar el módulo
`nodejs-24` antes de instalar y arrancar. No ejecutes Run y otro servidor en
Shell a la vez. Si Git informa divergencia o cambios locales, consérvalos y
reconcílialos; esta guía no requiere `reset --hard`.

`npm run replit` aplica las migraciones, compila y arranca. Producción utiliza
`npm run start:migrated`. Se requiere el `DATABASE_URL` existente. Si existen
claves antiguas de ejemplares sin cifrar, el migrador exige el
`CLAIM_KEY_SECRET` estable de la instalación; no lo sustituyas por otro.

Las migraciones **0019–0023** se ejecutan en una transacción con bloqueo y
verificación de checksums. No se modifican migraciones históricas. Conviene
conservar una copia completa de PostgreSQL antes de actualizar: el registro
interno de migración no es un respaldo de toda la base. No usar `db:push`
para sustituir este recorrido, porque los triggers de conservación también
forman parte del contrato.

## Cambios y cobertura

| Hallazgo | Comportamiento de esta entrega | Verificación |
| --- | --- | --- |
| F01 | Aprobar, rechazar y revertir una liquidación comparten bloqueo; el rechazo no libera una transferencia en curso | Concurrencia PostgreSQL con tres servidores y Stripe simulado; pruebas de estados y antigüedad |
| F02 | Cada adquisición congela arte, receta y marco; archivar evita nuevas emisiones y conserva copias | Comprar, modificar, archivar y volver a consultar; FK impide borrar la plantilla adquirida |
| F02 | Retirar una obra conserva la última edición publicada para quien la adquirió; no entrega borradores posteriores | Lectura, restauración de biblioteca y progreso; otro lector recibe 404 |
| F03 | Al fallar la verificación de sesión se pueden abrir descargas locales de la última cuenta | Chromium con arranque nuevo y API indisponible, IndexedDB y aislamiento entre cuentas |
| F04 | `connect-src` permite HTTPS para los recursos externos que acepta el editor | Cabeceras de producción y validación de fuentes; el origen externo sigue necesitando CORS |
| F05 | Node 24 en Replit, npm y todos los workflows | Compilación, inicio y CI en Node 24 |
| F06 | Asignación de worker con token y vencimiento, heartbeat y devolución única de reservas expiradas | Recuperación concurrente, heartbeat válido/ajeno/vencido y resultado tardío |
| F07–F08 | Actualizaciones parciales conservan estado editorial y enlaces sociales omitidos | API real y PostgreSQL |
| F09 | Terminar una lectura es una acción explícita, válida también para un solo capítulo | Progreso inicial frente a finalización y persistencia local |
| F10 | La alternativa de audio continúa dentro de la misma tarea; no espera una tarea encolada detrás de sí misma | Ejecución del motor híbrido real con transporte de audio simulado |
| F11 | Oráculo reserva Papel e identidad de solicitud antes de llamar al proveedor | Dos solicitudes concurrentes, reproducción de resultado y devolución de reserva vencida |
| F12–F13 | Un borrador nuevo recibe identidad estable en servidor; la cola serializa guardados locales y remotos | Reintentos concurrentes crean una sola obra privada; revisiones protegen contra sobrescrituras |
| F14 | El proyecto JSON de tarjeta incluye sus tres imágenes; deshacer y recuperación usan el mismo documento | Ida y vuelta del esquema y Chromium: capas, deshacer, importar, aplicar y guardar |
| F15 | Exportación ampliada y declaración explícita de conservación al eliminar cuenta | Exportación con historial, proyectos y copias de recuperación; aislamiento de archivos por cuenta |
| F16 | Catálogo con cursor y búsqueda en servidor; listas administrativas sin manuscritos | Más de 120 obras, páginas sin duplicados y búsqueda de una obra fuera de la primera página |
| F17 | Historial paginado de metadatos y deduplicación de actualizaciones idénticas | API de revisiones sin snapshots; exportación conserva las versiones completas |
| F18 | Inventario de modelos por cuenta, cuota acumulada y reserva antes de subir | Cargas concurrentes hasta el límite; repetir el mismo hash no duplica cuota |
| F19 | Actualización de dependencias transitivas vulnerables | `npm audit --omit=dev` |
| F20 | Gutenberg conserva códigos públicos de error y el identificador de petición | Catálogo y navegador; el wrapper ya no sustituye esos mensajes seguros |
| F21 | Traducción y procedencia se guardan con la edición y aparecen en ficha e impresión | Composición de página de créditos desde metadatos persistidos |
| F22 | El presupuesto inicial suma todo el grafo de importaciones estáticas | Gate de bundle completo, sin cargar 3D desde el shell inicial |

Los workflows son la evidencia ejecutable: Core app check, Account and
permission boundaries, Payment and licence boundaries, Audio performance
check y Print edition check. Usan bases desechables y proveedores simulados;
no cobran dinero ni sintetizan audio con proveedores reales. Las pruebas de
audio no equivalen a una escucha humana ni a medir un teléfono físico.

## Conservación y recuperación

**Tarjetas.** Las compras anteriores se congelan con la versión existente al
migrar; no es posible recuperar arte que ya se hubiera sobrescrito antes.
Las compras futuras guardan su propia versión. Las imágenes embebidas y las
recetas quedan dentro del snapshot; una URL externa puede cambiar o dejar de
existir. Para permanencia de los bytes hay que alojar los recursos bajo
control de Tloque. Las escenas importadas conservan referencias a modelos,
no empaquetan sus GLB dentro del JSON de tarjeta.

**Obras.** Una retirada del catálogo permite leer la última edición pública a
sus adquirentes. El estado de moderación `review` permanece restringido a
autor y administración. Esto no promete disponibilidad absoluta ante una
retirada por derechos o moderación, ni congela una edición de texto distinta
para cada fecha de compra.

**Borradores e historial.** La copia de recuperación cloud más reciente es
privada; una confirmación de versión canónica la sustituye. Los cambios reales
conservan revisiones completas sin vencimiento automático. No se eliminan
versiones publicadas ni puntos de recuperación de forma silenciosa. La
paginación y deduplicación reducen transferencia y duplicados, pero la
compactación de manuscritos y recursos repetidos sigue siendo trabajo de
almacenamiento posterior. Las copias locales requieren este dispositivo;
el JSON exportado permite trasladar un proyecto de tarjeta.

**Eliminar cuenta.** Se eliminan datos de perfil, progreso, guardados,
notificaciones y copias de recuperación cloud; se revocan sesiones. La
interfaz limpia el espacio local de esa cuenta. Los comentarios conservan su
texto bajo «Cuenta eliminada». Obras, manuscritos, revisiones, proyectos,
créditos editoriales, colecciones y registros económicos se conservan; las
obras salen del catálogo. Esta política se muestra antes de confirmar y en
la exportación. No se presenta como borrado integral de toda referencia al
autor ni como dictamen jurídico.

La exportación incluye datos propios de servidor y, desde la interfaz, los
borradores de editor, tarjetas y preferencias locales de la cuenta. No incluye
secretos de pago, tokens de worker, claves de reclamación ni identificadores
privados de voces del proveedor. Los binarios remotos se representan mediante
referencias; no es un archivo autosuficiente de todo el almacenamiento.

## Límites operativos

- **Liquidaciones:** una asignación activa dura dos minutos. Un resultado
  incierto se reintenta con la misma clave sólo durante las primeras 23 horas.
  Después se exige conciliación con el proveedor; no desbloquear ganancias
  ni crear otra transferencia a ciegas. Stripe puede retirar claves de
  idempotencia después de 24 horas.
- **Oráculo:** reserva durable con vencimiento de tres minutos. Se devuelve
  el excedente después del resultado; fallo o vencimiento devuelve la reserva
  una vez. El límite conservador de entrada y los 4.000 tokens máximos de
  salida evitan iniciar un trabajo sin presupuesto. Un fallo requiere una
  nueva solicitud explícita, no un reintento oculto al proveedor.
- **Audiolibros:** workers deben adoptar el [contrato de asignación](AUDIOBOOK_WORKER.md)
  antes de habilitar generación. No se activa automáticamente un servicio
  externo al instalar esta entrega.
- **Modelos:** 20 MiB por GLB, 200 MiB y 50 hashes por cuenta. Cuota global de
  2 GiB por defecto, configurable con `TLOQUE_MODEL_QUOTA_BYTES`. Reservas de
  subidas fallidas cuentan hasta revisión; reintentar el mismo hash no cobra
  cuota otra vez. Los objetos anteriores no tienen propietario reconstruido
  automáticamente. No hay limpieza destructiva de objetos referenciados.
- **Sin conexión:** requiere haber abierto la aplicación y guardado el libro
  previamente. El navegador debe conservar shell e IndexedDB. La identidad
  local permite leer esas descargas; no concede permisos de API ni admin.

Referencias operativas: [Node.js releases](https://nodejs.org/en/about/previous-releases),
[Stripe idempotency](https://docs.stripe.com/api/idempotent_requests) y
[módulos de Replit](https://github.com/replit/nixmodules/blob/main/pkgs/modules/default.nix).
