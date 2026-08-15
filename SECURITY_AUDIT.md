# Auditoría de seguridad y confiabilidad

Fecha de revisión: 8 de agosto de 2026.

Alcance: cliente React, API Express, autenticación, PostgreSQL/Drizzle,
integraciones externas, pagos, Fonoteca, cartas, marcos y sorteo. Esta revisión
combina análisis estático, comprobación de dependencias, TypeScript, pruebas
unitarias, build de producción y arranque controlado del artefacto compilado.

## Hallazgos corregidos

| Riesgo | Severidad | Corrección aplicada |
| --- | --- | --- |
| Secreto de sesión débil, cookie genérica y cierre por GET | Crítica | Secreto mínimo obligatorio en producción, cookie segura `HttpOnly`/`SameSite`, rotación de sesión y cierre por POST con destrucción del servidor. |
| OAuth construido con `Host` o dominio heredado | Alta | Origen canónico mediante `APP_URL`, HTTPS obligatorio en producción y credenciales verificadas al arrancar. |
| Inicio OAuth sin correlación de estado | Alta | `state` obligatorio en la estrategia de Google y sesión de servidor para validar el retorno. |
| Mutaciones autenticadas expuestas a CSRF | Alta | Verificación de `Origin`/Fetch Metadata para POST, PUT, PATCH y DELETE; excepción limitada al webhook firmado. |
| SSRF en importación Gutenberg y diccionario | Alta | Dominios, protocolos, idiomas, tamaños, identificadores y tiempos de uso acotados. |
| Asignación masiva e IDOR sobre libros/perfiles | Alta | Listas permitidas de campos, identidad del autor impuesta por sesión y comprobaciones de propietario/administrador. |
| Doble débito, doble entrega o saldos negativos por carreras | Crítica | Transacciones, bloqueos de usuario/obra, débitos condicionales e índices de idempotencia. |
| Webhook Stripe aceptaba confirmaciones insuficientes | Crítica | Firma y ventana anti-replay, importe/divisa/estado exactos, referencia de proveedor, bloqueos e idempotencia. Stripe no cobra en producción sin secreto de webhook. |
| Duplicación de cartas de apoyo bajo concurrencia | Alta | Otorgamiento perezoso e idempotente dentro de un bloqueo por usuario. |
| Límites de cartas vulnerables a carreras | Alta | Máximo 6 por obra y 24 sueltas por autor verificados dentro de transacciones con advisory locks. |
| Arte de carta y paquetes de marco sin límites robustos | Alta | Fuentes de imagen seguras, límites de tamaño/profundidad, rechazo de claves peligrosas y validación geométrica/color. |
| Taller de marcos aceptaba mensajes amplios y construía HTML con datos editables | Alta | Token de puente por sesión, origen y ventana exactos, iframe limitado y creación de nodos con `textContent`. |
| Borrado de carta dejaba copias o rompía historial | Alta | Copias eliminadas en cascada; tiradas históricas conservadas con referencia nula. |
| Borrado físico de obra comprometía compras/ganancias | Alta | Baja lógica que preserva contabilidad y oculta la obra de superficies públicas. |
| Fonoteca permitía una arquitectura propensa a URL arbitrarias | Alta | Catálogo oficial administrado, metadatos/licencia, favoritos y asignaciones por ID publicado con control de propiedad. |
| Descarga dinámica de generadores PDF desde CDN | Alta | Dependencias fijadas en el lockfile y cargadas desde el bundle local. |
| Respuestas 500 y logs podían revelar datos internos | Media | Redacción global de errores y logs limitados a método, ruta, estado y duración. |
| Sin cabeceras de aislamiento ni política de contenido | Media | CSP, HSTS bajo HTTPS, `nosniff`, anti-frame, referrer/permissions policy y excepción mínima para el taller embebido. |
| Rate limit sin poda ni límite de memoria | Media | Tamaño máximo, barrido periódico, claves acotadas y `Retry-After`. |
| Clave de reclamo en la consulta del QR | Media | La clave viaja en fragmento, se captura en cliente y se elimina de la URL antes de cualquier solicitud. Se conserva lectura de PDFs beta y también se limpia. |
| Duplicados de sorteo creaban Papel y la selección podía fallar | Alta | Papel queda reservado a uso de IA; el motor prefiere cartas no poseídas y usa una selección SQL válida sin alterar probabilidades. |
| Catálogo enviaba el texto íntegro de todas las obras | Media | Respuesta resumida con metadatos, conteo y apertura acotada; contenido completo solo al abrir una obra. |
| Sorteo ausente o beta peligrosa en producción | Alta | Fila inicial apagada, configuración idempotente y beta administrativa bloqueada salvo autorización explícita. |

No se cambiaron el precio del boleto, probabilidades base, reparto económico,
piedad ni umbrales de rareza. Solo se corrigió la selección cuando una rareza
no tiene inventario: usa la rareza solvente disponible más baja en vez de
convertir una porción grande de tiradas válidas en reembolsos.

## Verificación

La entrega se considera lista cuando pasan, en este orden:

```bash
npm ci
npm audit
npm run check
npm test
npm run build
git diff --check
```

El build de producción también se comprobó sirviendo la portada y el taller de
marcos, verificando sus CSP y políticas de frame diferenciadas. El resultado
exacto de la última corrida se registra en el pull request.

## Controles operativos pendientes

Estos puntos dependen del entorno y no pueden resolverse solo con código:

1. Hacer respaldo y aplicar la migración antes de desplegar.
2. Usar secretos nuevos y aleatorios; no copiar valores de desarrollo.
3. Registrar en Google exactamente el callback
   `APP_URL/api/auth/google/callback`.
4. Registrar y probar el webhook de Stripe en un entorno de staging con una
   compra real de prueba y un reenvío del mismo evento.
5. Ejecutar pruebas de concurrencia contra una copia PostgreSQL representativa,
   especialmente compras, cartas y sorteo.
6. El rate limit actual es por proceso. Si Tloque escala a varias réplicas,
   añadir un limitador compartido (por ejemplo Redis) o una regla equivalente
   en el proxy/WAF.
7. CSP permite imágenes, audio y conexiones HTTPS externas porque el producto
   admite portadas y audio oficial alojados fuera del origen. El administrador
   debe mantener una política de procedencia/licencias; una allowlist de CDN
   propio sería el siguiente endurecimiento.
8. El taller permanece en el mismo origen por compatibilidad. El puente ya
   valida token/origen/ventana, pero un subdominio aislado permitiría retirar
   `allow-same-origin` y reducir todavía más el impacto de un fallo futuro.
9. Las claves impresas de reclamo deben poder volver a mostrarse al propietario
   para regenerar su PDF. Antes de producción conviene cifrarlas en reposo con
   una clave operativa separada y un procedimiento documentado de rotación.

El análisis reduce riesgos conocidos, pero no constituye una garantía de que
no existan vulnerabilidades futuras. Conviene repetir `npm audit`, las pruebas y
la revisión de rutas en cada actualización relevante.
