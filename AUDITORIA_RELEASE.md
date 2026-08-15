# Auditoría del paquete Tloque para Replit

Fecha: 2026-08-09  
Repositorio: `heliossamuelhernandezreyes/Tloque`  
Fuente: rama `agent/experience-v2`  
Commit fijado: `d936238a4d270d98b8e47bdf3551bb28be9caadc`

## Reconstrucción verificable

- El ZIP recibido contenía 172 archivos de código.
- Los 172 se compararon individualmente con el commit fijado.
- 164 coincidían byte por byte.
- Ocho tenían el mismo texto y un salto de línea final adicional; se
  normalizaron al blob exacto de GitHub.
- Se recuperaron 32 archivos operativos ausentes desde GitHub: lockfile,
  builder, pruebas, CI, documentos y migraciones `0001` a `0006`.
- Cada archivo recuperado se verificó contra su blob de GitHub.
- `0007_catalog_indexes.sql` formaliza cinco índices que antes estaban en el
  archivo mal nombrado `server/migrations/add_indexes.sql.`.

El paquete no mezcla ramas: el código de aplicación corresponde al commit
fijado; los únicos archivos nuevos son el instalador, el migrador, `0007`, esta
auditoría y las instrucciones de Replit.

## Validaciones ejecutadas

| Control | Resultado |
| --- | --- |
| Instalación limpia con lockfile | Aprobada |
| TypeScript (`npm run check`) | Aprobado |
| Pruebas automatizadas | 50/50 aprobadas |
| Build cliente y servidor | Aprobado |
| Auditoría de dependencias de producción | 0 vulnerabilidades conocidas |
| CI del commit en GitHub con Node 20 | Aprobada |
| Barrido de secretos y claves privadas | Sin credenciales reales |
| Migraciones `0001`–`0007` sobre esquema anterior | Aprobadas |
| Segunda ejecución de las migraciones | Aprobada |
| Verificación de tablas y columnas nuevas | Aprobada |

## Controles de seguridad revisados

- Autorización de administrador en servidor, no derivada sólo de la interfaz.
- Propiedad de obra validada antes de editar música, voz, cartas y ediciones.
- Sesión HTTP-only, `SameSite=Lax`, cookie segura en producción y PostgreSQL
  como almacén de sesiones.
- Protección de mismo origen para mutaciones y excepción limitada al webhook.
- CSP, HSTS en HTTPS, `nosniff`, políticas de frames y respuestas sensibles sin
  caché.
- URLs externas limitadas a HTTPS; Gutenberg restringido a sus dominios y sin
  redirecciones; límites de tiempo y tamaño.
- Claves de ejemplares retiradas de respuestas públicas y comparación en tiempo
  constante durante el reclamo.
- Compras, reclamos, cartas y reservas de Papel protegidos con transacciones,
  unicidad o bloqueos consultivos.
- Generación de audiolibros apagada hasta configurar worker y almacenamiento.
- Pagos reales apagados hasta configurar los dos secretos de Stripe.

## Límites que no bloquean esta migración

- Las claves impresas de ejemplares aún se almacenan en texto; antes de una
  salida pública amplia conviene migrarlas a HMAC sin invalidar ejemplares.
- El rate limit vive en memoria del proceso; al desplegar varias réplicas debe
  trasladarse a Redis, proxy o WAF.
- El taller de marcos mantiene JavaScript inline bajo una CSP especial y debe
  aislarse en otro origen como endurecimiento posterior.
- Las imágenes y pistas externas se validan, pero todavía no se ingieren a
  almacenamiento propio ni se audita automáticamente su licencia.
- No se probaron servicios vivos ni secretos: Google OAuth, Stripe, Groq,
  ElevenLabs, almacenamiento, webhooks y bases reales deben verificarse en
  Preview/staging.
- Las migraciones se validaron estructuralmente en PostgreSQL compatible; el
  preflight incluido es quien decide si los datos reales del Repl son aptos.

## Conclusión

El código del commit fijado es construible y comprobable. El ZIP anterior
fallaba por ausencia de infraestructura operativa, no por errores de TypeScript.
Este paquete restaura esa infraestructura y separa deliberadamente instalación
de código y migración de datos para que ninguna falle ocultando a la otra.
