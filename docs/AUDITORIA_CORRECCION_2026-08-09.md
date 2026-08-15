# Auditoría y corrección de Tloque — 2026-08-09

## Alcance

Se auditó el ZIP `tloque_codigo (15).zip` sin utilizar ni modificar su base de
datos. La revisión cubrió arranque del navegador, servidor Express, Vite,
autenticación, autorización, sesiones, cabeceras, pagos, economía interna,
almacenamiento, integraciones externas, migraciones, dependencias, compilación y
pruebas automatizadas.

Huella SHA-256 del ZIP recibido:

`6ecbebaecdb8e8281441556d3b611edb6f063be234d8e426727d44e84353c3e6`

## Falla reproducida

El servidor sí iniciaba y entregaba HTML, pero su Content Security Policy
declaraba `script-src 'self'`. Vite y los complementos de Replit insertan dos
scripts inline durante el desarrollo: el preámbulo de React Refresh y el visor
de errores. El navegador bloqueaba ambos; React abortaba antes de montar la
interfaz y el visor que debía explicar el fallo tampoco podía aparecer. El fondo
negro del HTML era lo único restante.

## Correcciones aplicadas

1. CSP compatible con Vite y Replit sólo en desarrollo. Producción conserva
   `script-src 'self'`, `frame-ancestors 'none'` y `X-Frame-Options: DENY`.
2. Preview de Replit permitido únicamente desde `replit.com` durante desarrollo.
3. Estado inicial visible en HTML; un fallo de JavaScript ya no parece una
   pantalla vacía.
4. Error Boundary de raíz y recuperación si un módulo o proveedor React falla.
5. Verificación de sesión con límite de 12 segundos, reintento visible y
   distinción entre «sin sesión» e «indisponibilidad del servidor».
6. La sincronización inicial ya no produce promesas rechazadas sin manejar.
7. Stripe sólo se habilita cuando existen tanto la clave como el secreto del
   webhook. Así no puede cobrar sin entregar la compra.
8. La beta que acredita Tinta gratis exige `PAYMENTS_BETA_MODE=true` incluso en
   desarrollo; un Repl público ya no crea moneda por omisión.
9. Límites conservadores para pool, conexión y consultas PostgreSQL.
10. `ADMIN_EMAIL` ausente ya no inserta `admin@example.com` en desarrollo.
11. Validación explícita de `PORT` y manejo de fallo de arranque.
12. Activos con hash reciben caché inmutable; el HTML siempre se revalida.
13. Se restauró el zoom del navegador para accesibilidad móvil.
14. Se eliminó una descarga duplicada de Google Fonts.
15. El volumen de sonidos del Orb System ahora controla todos los sonidos desde
    una salida maestra, no sólo algunos.
16. Se eliminaron 35 imports, parámetros, variables y funciones sin uso y se
    activó su detección permanente en TypeScript.

## Verificación

- Instalación reproducible con `npm ci`: correcta.
- TypeScript estricto, incluyendo código muerto: correcto.
- Pruebas: 55 aprobadas, 0 fallidas.
- Build de producción: correcto, 2,470 módulos transformados.
- Auditoría npm completa y sólo producción: 0 vulnerabilidades conocidas.
- Prueba HTTP de desarrollo: `/`, `/src/main.tsx` y `/api/auth/me` responden.
- El HTML transformado contiene el preámbulo de Vite y la CSP ahora lo permite.
- Producción no contiene React Refresh ni el complemento de errores de Replit.
- Búsqueda de secretos: no se encontraron claves reales en el código.

## Controles que ya estaban correctamente implementados

- Sesiones PostgreSQL, cookies HttpOnly y SameSite.
- Protección de mutaciones contra origen cruzado.
- Autorización de administrador y propiedad de autor en servidor.
- Separación lector/autor/administrador en las rutas sensibles.
- Webhook Stripe firmado, con ventana anti-replay y verificación de monto,
  moneda, sesión y orden.
- Transacciones y advisory locks en operaciones económicas y sorteo.
- URLs de imagen/audio acotadas y rechazo de protocolos peligrosos.
- Importador Gutenberg con allowlist, sin redirecciones y límites de tamaño.
- Acceso a audiolibros por suscripción, autoría, compra o tarjeta.
- Claves y rutas de almacenamiento de audiolibros validadas.
- Exportación de cuenta sin claves impresas ni secretos de pago.

## Riesgos deliberadamente no transformados en esta entrega

Estos cambios necesitan una decisión de producto, infraestructura o migración y
no deben mezclarse con la reparación de arranque:

- `claim_key` de ejemplares sigue en texto plano. Debe migrarse después a
  HMAC/hash con compatibilidad para ejemplares ya impresos.
- El rate limiter es local a una instancia. Antes de escalar horizontalmente
  debe moverse a PostgreSQL o Redis.
- Las migraciones 0001–0007 son incrementales sobre la base original; no son un
  bootstrap completo para una base vacía.
- Oráculo, Stripe y audiolibros permanecen inactivos hasta configurar sus
  Secrets y, en audiolibros, worker y almacenamiento.
- El bundle inicial todavía es grande. Conviene dividir SettingsContext,
  `server/routes.ts` y módulos de edición en una fase de rendimiento separada.

## Base de datos

Esta entrega no añade tablas, columnas ni índices. No requiere SQL y no debe
volver a ejecutar migraciones ya registradas. Los datos actuales se conservan.
