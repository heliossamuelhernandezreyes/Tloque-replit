# Permisos y separación de cuentas — 17 de septiembre de 2026

Primer bloque de corrección de la auditoría de `0e88f6c`: F01 (revocación), F03
(datos locales compartidos) y F08 (sobrescritura sin revisión). También se aplica
`Cache-Control: private, no-store` a las respuestas API, incluido el estado QR;
esto solo aborda la parte de caché de F05.

## Comportamiento

- Cada petición autenticada consulta el rol actual en PostgreSQL. No reutiliza
  una lista de administradores en memoria. Un error de consulta impide continuar.
- Los permisos se asocian al objeto de usuario resuelto por el servidor. Campos
  `isAdmin`, `role` o `capabilities` enviados por el cliente no conceden acceso.
- Un rol de audio, marcos o finanzas no permite leer o editar manuscritos privados
  ajenos. La excepción editorial corresponde a `manageCatalog`.
- La interfaz administrativa muestra las áreas autorizadas y permite asignar un
  rol explícito. El fundador configurado mediante `ADMIN_EMAIL` conserva acceso.

| Rol | Facultades administrativas |
| --- | --- |
| Catálogo | Catálogo, manuscritos y Gutenberg |
| Visual | Marcos y recursos visuales |
| Audio | Fonoteca, recursos de sonido y diagnóstico |
| Finanzas | Pagos, liquidaciones, incidencias y administración del sorteo |
| Accesos | Asignar, cambiar y retirar roles, incluido el rol completo |
| Completo | Todas las anteriores |
| Anterior (`legacy`) | Facultades operativas anteriores; no puede delegar permisos |

La migración 0017 conserva los administradores existentes como `legacy` y pone
`catalog` como valor predeterminado para nuevas altas. El fundador debe revisar
los roles anteriores y reducirlos según la función de cada persona.

## Privacidad en el dispositivo

Las preferencias privadas, progreso, biblioteca, tarjetas y borradores se guardan
en espacios identificados por la cuenta. IndexedDB utiliza una base por cuenta.
Salir no borra el borrador propio; otra cuenta no lo recibe. Borrar una cuenta
limpia sus espacios, sin borrar los de otros usuarios ni los bancos públicos.

Una página mantiene una sola identidad durante toda su vida. Un cambio de cuenta
en otra pestaña bloquea el contexto, cancela peticiones pendientes y recarga.
Las escrituras llevan `X-Tloque-Account`: si la cookie pertenece a otra cuenta,
el servidor responde 409 antes de modificar datos; si falta el contexto en una
escritura autenticada, responde 428. Esta cabecera no sustituye la autenticación.
Las respuestas que llegan tarde tampoco pueden consumirse en el nuevo contexto.

Los clientes anteriores deben recargar: `/api/auth/me` requiere la versión
`accounts-v1` en `X-Tloque-Client` y responde 426 a versiones anteriores. Los
callbacks de Google y webhooks anónimos conservan su flujo propio.

**Datos locales anteriores:** se conservan las claves y bases antiguas, pero no
se importan automáticamente porque no registraban un propietario fiable. Los
manuscritos sincronizados se recuperan desde el servidor; un borrador que solo
existía en el almacenamiento antiguo necesita recuperación explícita. No limpiar
los datos del navegador para resolverlo. Este bloque no incluye esa interfaz de
recuperación ni garantiza lectura offline después de cerrar y reabrir la app.

## Conflictos de edición

`PUT /api/books/:id` exige `expectedRevision` entero positivo. Omitirlo devuelve
400; intentar guardar una revisión superada devuelve 409 y no altera el
manuscrito. El editor utiliza la revisión canónica que cargó. Un fallo de cuota
al actualizar la caché no convierte una escritura exitosa en un falso error de
guardado del servidor.

## Comprobaciones reproducibles

- `npm run check`, `npm test`, `npm run build`, `npm run check:bundle`.
- Diez regresiones en `tests/account-boundaries.test.ts`: cuentas distintas,
  borradores, cambio de pestaña, respuestas tardías, almacenamiento bloqueado,
  contexto de petición, roles y revisión obligatoria.
- Workflow `Account and permission boundaries`: PostgreSQL 16 desechable, dos
  procesos reales de la app compilada y sesiones Passport. Comprueba matriz de
  roles, revocación entre instancias, fallo de consulta, escrituras cruzadas,
  revisiones y cabeceras de caché. No usa cuentas ni proveedores reales.
- Los workflows existentes comprueban migración repetida, actualización desde
  `db:push`, arranque compilado, interfaz visual, Gutenberg e impresión. Sus
  fixtures usan los nuevos permisos y espacios de almacenamiento.

Los resultados definitivos corresponden al commit y las ejecuciones enlazadas
en el PR; la presencia de un script por sí sola no certifica que haya pasado.

## Actualización en Replit

Detener primero la app con **Stop** y cualquier proceso iniciado manualmente.
En Shell, una vez integrados los cambios en `main`:

```sh
git pull --ff-only origin main
npm run db:migrate
```

Si ambos comandos terminan correctamente, iniciar una sola instancia con **Run**
(o `npm run replit` en Shell). No iniciar las dos a la vez: ambas usan el puerto
5000. Recargar las pestañas de Tloque para cargar el cliente nuevo. No se requieren
nuevos secretos ni Replit Agent. Si el pull informa divergencias, conservar los
cambios y resolverlas; no usar `reset --hard`.

## Pendiente de los siguientes bloques

Reembolsos y saldos, idempotencia y anulación de licencias, retorno tras login del
QR, dominio público para impresión, importador GLB y animaciones, perfiles
profesionales de PDF/color, accesibilidad y rendimiento. Estas correcciones no
certifican que toda la auditoría esté resuelta.
