# Auditoría de seguridad y producto de Tloque

Fecha: 2026-08-09  
Alcance: código de la rama `agent/adaptive-fonoteca-v1`, API Express, cliente React,
modelo PostgreSQL/Drizzle, pagos, sorteo, biblioteca, tarjetas, audio, Fonoteca,
Oráculo, Gutenberg e internacionalización.

## Resumen ejecutivo

La revisión encontró fallos reales de autorización, concurrencia, privacidad,
validación y configuración. En esta entrega se corrigieron los que podían causar
acceso indebido a arte premium, doble devolución de Papel, rutas de archivos fuera
del almacén, manipulación persistente del cálculo de rareza, filtración de
identificadores internos y pérdida silenciosa de cambios del editor.

El modelo de audiolibro queda separado en dos operaciones:

- **Generar** un capítulo que aún no existe: requiere suscripción Audio activa y
  Papel suficiente. La petición es idempotente y el cobro se hace una sola vez.
- **Reproducir** un capítulo ya generado: lo puede escuchar un suscriptor, el
  autor, un administrador o quien posea el libro o una tarjeta vinculada al libro.
  Para estos propietarios no se exige suscripción ni se vuelve a cobrar Papel.

Por tanto, el primer lector financia la generación y todos los propietarios
legítimos se benefician del mismo caché. Guardar un libro sin comprarlo no concede
el audio; comprar una tarjeta sí desbloquea permanentemente el libro asociado.

## Qué se intentó romper

La revisión combinó búsqueda estática, lectura manual de rutas y esquemas, pruebas
de propiedades, compilación y construcción de producción. Se probaron, entre
otros, estos casos adversariales:

- rutas absolutas, `..`, barras inversas, segmentos vacíos y enlaces simbólicos en
  las claves del almacén de audio;
- repetición de la misma solicitud y terminación simultánea de un trabajo fallido;
- publicación de un proyecto de narración o voz basado en una revisión vieja;
- salto de capítulos, capítulos inexistentes y números fuera del rango entero;
- sorteo con divisiones insolventes, premios no crecientes y aleatoriedad no
  criptográfica;
- lectura de URLs premium desde catálogo, perfil de autor y sincronización;
- reclamación de ejemplares mediante comparación de secretos y exposición del ID
  interno del reclamante;
- redirecciones inseguras del firmador de audio y respuestas externas sin límite;
- APIs desconocidas absorbidas accidentalmente por la aplicación de una sola
  página;
- diferencias de claves o cadenas vacías entre los nueve idiomas completos de UI;
- dependencias de producción conocidas como vulnerables mediante `npm audit`.

La auditoría de código no sustituye una prueba de penetración contra el despliegue
real: no se inspeccionaron secretos, reglas del proveedor de objetos, firewall,
backups ni la configuración viva de PostgreSQL/Stripe/Google.

## Correcciones realizadas

| Área | Problema | Corrección |
|---|---|---|
| Audiolibro | La reproducción estaba ligada sólo a suscripción | Política central de derechos por suscripción, autoría, administración, libro o tarjeta |
| Papel | Dos terminaciones simultáneas podían devolver Papel dos veces | Bloqueo asesor por trabajo y usuario dentro de una transacción |
| Editor avanzado | Dos pestañas podían sobrescribir una revisión | Control optimista bajo bloqueo transaccional y rechazo de publicación obsoleta |
| Archivos | Una clave o enlace simbólico podía escapar del directorio de audio | Validación estricta, `realpath` y comprobación de pertenencia al directorio raíz |
| URLs externas | Redirecciones/fetches sin validación o tiempo límite | Sólo HTTPS seguro, validación posterior, límites de tiempo y tamaño |
| Arte premium | Las URLs ocultas sólo en React seguían llegando por la API | Filtrado servidor por derecho en catálogo, detalle, autor y sincronización |
| Tarjetas | La compra directa no garantizaba el libro asociado | Desbloqueo transaccional permanente del libro al comprar la tarjeta |
| Ejemplares | El API revelaba el ID interno de quien reclamó | Sólo `digitalClaimed` y `claimedByOwner`; comparación del secreto en tiempo constante |
| Progreso | IDs enormes o capítulos inválidos afectaban consultas posteriores | Validación contra libro/capítulos reales, límites y consultas sin cast inseguro |
| Sorteo | Precio anterior y `Math.random()` no correspondían al producto | Boleto de 10 Tinta = 20 MXN, divisiones solventes y aleatoriedad criptográfica |
| Red/CSRF | `same-site` podía aceptarse como `same-origin` | Verificación estricta de origen y `Sec-Fetch-Site` |
| Privacidad | Sesión/cartera/audio/tokens podían almacenarse en cachés intermedios | `Cache-Control: private, no-store` en respuestas sensibles |
| Administración | El correo fundador estaba escrito en el repositorio | `ADMIN_EMAIL` obligatorio y sin valor de ejemplo en producción |
| Identidad | OAuth podía intentar crear una cuenta sin correo verificable | Alta rechazada si Google no entrega un correo verificado y válido |
| Abuso de API | Se podía variar la ruta antes de alcanzar límites específicos | Límite global por IP antes de parsear cuerpos, más límites por mutación |
| Desarrollo | Vite aceptaba cualquier `Host` | Lista limitada de hosts locales, Replit y `APP_URL` |
| CI | No había una barrera automática contra regresiones | Flujo con instalación reproducible, auditoría, pruebas, tipos y build |

## Riesgos que todavía bloquean una salida pública seria

1. **Claves de reclamación almacenadas en texto legible.** El hash no basta porque
   hoy el autor puede volver a descargar/imprimir la clave. Se necesita verificación
   con HMAC y cifrado de sobre para la recuperación, con una clave gestionada fuera
   de PostgreSQL y una migración compatible con copias ya impresas.
2. **Progreso de lectura autodeclarado.** Ya no rompe la base de datos, pero un
   cliente modificado aún puede saltar al último capítulo y manipular una señal de
   rareza. Debe crearse una sesión de lectura firmada en servidor con eventos
   acotados; la rareza no debe consumir el progreso antiguo como señal confiable.
3. **Limitador en memoria.** Protege una instancia, pero no agrega tráfico entre
   varias réplicas. Antes de escalar debe usar Redis o PostgreSQL con ventanas
   compartidas y límites por IP, usuario y operación costosa.
4. **Recursos remotos suministrados por usuarios.** Imágenes o pistas externas
   pueden rastrear la IP del lector o cambiar después de moderarse. Deben ingerirse
   al almacenamiento propio, decodificarse, comprobar MIME/tamaño, escanearse y
   conservar licencia, hash y autor de la carga.
5. **Mensajería todavía no tiene controles de abuso.** No debe lanzarse hasta tener
   bloqueo, silencio, reporte, límites, retención, borrado y herramientas de
   moderación. El cifrado en tránsito y reposo no equivale a cifrado de extremo a
   extremo; no debe prometerse este último sin un diseño específico.
6. **Infraestructura viva no auditada.** Deben verificarse CSP y cookies en el
   dominio final, rotación de secretos, mínimos privilegios de base de datos,
   backups restaurables, logs sin contenido sensible y webhooks reales de pagos.

## Idiomas

Tloque tiene **nueve idiomas completos de interfaz** con las mismas claves y sin
cadenas vacías: español, inglés, francés, alemán, italiano, portugués, japonés,
chino y árabe. Fonoteca/narración usa esos mismos nueve.

El importador de Gutenberg admite **dieciséis códigos**: los nueve anteriores más
ruso, neerlandés, polaco, finés, sueco, latín y griego. Esos siete adicionales no
son todavía idiomas completos de toda la aplicación.

Las pruebas garantizan integridad estructural, no calidad editorial. Antes de
mostrar la etiqueta “verificado”, cada idioma debe tener revisión de un hablante
nativo, glosario de producto, prueba RTL real para árabe y revisión de cortes,
pluralización, fechas, moneda y accesibilidad.

## Arquitectura recomendada para la siguiente entrega

### Ediciones comerciales

La base actual (`book_tokens` y `print_copies`) debe evolucionar sin exponer datos
del comprador. Conviene añadir una entidad de edición y ampliar cada ejemplar:

- `commercial_editions`: libro, nombre de edición, ISBN opcional, tiraje,
  portada/contraportada, estado y fechas.
- `commercial_copies`: edición, folio inmutable, estado (`stock`, `sold`,
  `returned`, `void`), `sold_at`, canal y precio opcional.
- la reclamación digital permanece separada y sólo muestra al autor si fue
  reclamada y cuándo; nunca el ID/email del lector.
- cada cambio de estado genera un evento de auditoría, no un simple `UPDATE` sin
  historia.

La página **Ediciones** debe ofrecer galería y tabla con: edición, folio, estado,
fecha de venta, digital reclamada, fecha de reclamación y menú de acciones. Marcar
“vendido” requiere confirmación y es reversible mediante “devuelto”; anular una
clave impresa requiere una acción administrativa más fuerte.

### Mensajes y notificaciones

Separar conversación de notificación evita convertir cada aviso del sistema en un
mensaje:

- `conversations`, `conversation_members`, `messages` y recibos de lectura;
- `notifications` con tipo, destino interno seguro, `read_at` y clave de
  deduplicación;
- `user_blocks`, `conversation_mutes` y `reports` antes del lanzamiento;
- notificaciones iniciales: venta registrada, copia digital reclamada,
  audiolibro listo/fallido, comentario, respuesta y evento editorial.

No incluir HTML arbitrario ni URLs externas en notificaciones. El servidor debe
producir tipos y parámetros; React decide el texto traducido y el destino a partir
de una lista permitida.

### UI y navegación

La prioridad no es añadir estímulos indiscriminadamente, sino reducir incertidumbre
y recompensar progreso real:

1. barra principal corta: Biblioteca, Explorar, Crear y perfil;
2. bandeja y campana en el encabezado con contadores independientes;
3. área de autor con pestañas Obras, Fonoteca, Audiolibros y Ediciones;
4. una sola jerarquía visual de botones y estados coherentes de carga, vacío,
   éxito y error;
5. coste de Papel visible antes de generar, razón del acceso visible después y
   progreso en segundo plano sin prometer “dos minutos”;
6. insignias por contribuciones verificables —por ejemplo “Primera generación” o
   “Capítulo compartido”— sin tablas de gasto ni mecánicas que presionen al lector.

La siguiente implementación debe empezar por Ediciones y su auditoría de estados;
mensajería debe ir después de los controles de abuso. El rediseño visual general
debe ser un PR separado de estos cambios de seguridad.

## Verificación de esta entrega

- pruebas automatizadas de dominio, seguridad e i18n;
- comprobación TypeScript sin emisión;
- build de producción;
- `npm audit --omit=dev`;
- CI equivalente en cada push y pull request.
