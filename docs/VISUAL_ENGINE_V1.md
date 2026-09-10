# Tloque Visual Engine V1

Implementación en el cliente existente de Tloque. Three.js 0.185.0 y React Three Fiber 8.18.0 (compatible con React 18), con carga diferida. No necesita modelos remotos, claves nuevas, generación de imágenes ni APIs de pago. No cambia el pipeline musical, la facturación ni los derechos de libros y tarjetas.

## Experiencia integrada

| Superficie | Comportamiento |
| --- | --- |
| Orbe central | Singularidad con shader animado; rosa de 18 pétalos articulados. Conserva tap, búsqueda y pulsación larga. |
| Ajustes → Apariencia | Automática, Esencial, Alta y Ultra; selección de orbe. La rosa requiere el derecho cosmético de la sesión. |
| Catálogo | Abanico aplicado al hijo de la diapositiva; Embla conserva su transform de bucle. Controles anterior/siguiente, inicio estable, títulos más legibles y halo del género. |
| Sinopsis | Cubierta con volumen, páginas y lomo; luz ambiental; distribución de dos columnas en escritorio; lectura antes del texto largo; ampliación accesible de portada. |
| Tarjeta ampliada | Portal con marco material y mundo 3D; cámara con parallax; opción Original para conservar íntegramente ornamentos y efectos del autor. |
| Galería de marcos | Exploración del material como marco de tarjeta o perfil. Es una adaptación del material, no una conversión exacta de todos los ornamentos del Workshop. |
| Sorteo | Escena de anillos y partículas durante la apertura. Premios, rarezas, probabilidades y cobros conservan la lógica existente. |

## Motor y ciclo de vida

`VisualEngineProvider` registra ranuras DOM visibles. `VisualSurface` es el único Canvas/WebGLRenderer. El compositor usa viewport y scissor por ranura, con coordenadas DOM leídas por fotograma. Las galerías no crean un contexto por tarjeta.

Los libros y orbes de fondo se retiran del render cuando se abre un visor. Un visor sin contenido 3D tampoco mantiene ese render de fondo. Al ocultar la pestaña, entrar al lector/editor, activar movimiento reducido o elegir Esencial, se desmonta la superficie. Al salir de pantalla se retiran escenas y se liberan geometrías, materiales, texturas y render targets. Las texturas que llegan tras cerrar una escena se descartan.

La superficie sólo reemplaza el fallback después de un render listo. Contexto WebGL perdido, error de shader/carga del módulo o error de render mantienen la interfaz DOM. Las imágenes rechazadas, con CORS incompatible, fallidas o sin respuesta en 12 segundos conservan su alternativa. La pérdida de contexto desactiva el 3D hasta recargar.

Radix Dialog controla foco, Escape, bloqueo de scroll, nombre accesible y retorno al elemento que abrió el visor. El canvas nunca recibe eventos ni contiene acciones de lectura, compra o navegación.

## Portal y arte del autor

El mundo interior se dibuja primero en un render target. Esa textura sólo existe en la geometría de la abertura redondeada/circular; el bisel tiene un agujero real. El fondo no es un plano de pantalla detrás de una máscara CSS. El movimiento de cámara y las distancias de las capas producen el parallax.

Se leen hasta tres imágenes de `card.fx.layers.back`, `mid` y `front`. Para separar personas/objetos del fondo, el autor debe aportar capas con transparencia en `mid`/`front`, mismo encuadre y proporción. Una imagen plana sigue siendo plana; no se inventa un mapa de profundidad ni se segmentan sujetos con IA. Una fotografía opaca completa puede tapar el escenario geométrico interior. El modo Original conserva la composición y todos los efectos existentes.

El libro usa `coverFor(book, user.id)` para la edición ya autorizada. No consulta la portada premium por una ruta nueva. Para imágenes se conserva la política `shared/media.ts` (HTTPS o data URI raster admitida); no se admiten scripts, shaders del usuario, modelos remotos ni SVG ejecutable.

`visualFrame()` toma un subconjunto acotado de `runtimePreset.appearance`: color/material, metalness, roughness, espesor, radios y reflejo del cristal. El modelo 3D no ejecuta código de un paquete del Workshop.

## Calidad y acceso

| Modo | Objetivo de refresco 3D | Resolución |
| --- | --- | --- |
| Automática | 30 fps; desactivado con ahorro de datos o memoria declarada ≤2 GB | DPR hasta 1,4; hasta 1 en equipos modestos |
| Esencial | Sin WebGL | Presentación DOM/SVG/efectos existentes |
| Alta | 30 fps | DPR hasta 1,4; hasta 1 en equipos modestos |
| Ultra | 60 fps | DPR hasta 1,75 |

Todos los modos respetan el movimiento reducido del sistema y de Tloque. Son objetivos del planificador, no una garantía de FPS. Límite de 1,8 millones de píxeles de superficie, tres vistas y lado máximo de textura 1024 px (1536 en Ultra). Targets de portal con alto máximo de 1024 px. Imágenes decodificadas superiores a 24 millones de píxeles se rechazan; el límite GPU no garantiza el tamaño de transferencia de un archivo externo. Presión sostenida en la preparación CPU del render reduce DPR; no se presenta como medición de GPU, batería ni temperatura.

`/api/auth/me` deriva `visualEntitlements` en el servidor. Estético/Audio activos, con expiración válida si existe, y administración pueden elegir la rosa. Guardar una preferencia no concede la suscripción. El cliente reevalúa la expiración incluso con la sesión abierta. Esto controla un cosmético; no sustituye las autorizaciones del servidor para contenido o compras.

## Verificación y límites

- `npm run check`: TypeScript del cliente/servidor.
- `npm test`: suite existente y pruebas nuevas de acceso, expiración, calidad, selección de vistas, recorte, geometría, carga tardía, liberación y traducciones.
- `npm run build && npm run check:bundle`: compilación; presupuesto del shell 350 KB/120 KB gzip; verifica el grafo estático del manifiesto para impedir que Three entre en el arranque; 3D diferido ≤300 KB gzip.
- `npm audit --omit=dev --audit-level=high`: puerta de dependencias del proyecto.
- Prueba de ciclo de vida con React/R3F: el fallback HTML no declara un fallo al montarse; una reducción de DPR no se pierde en la siguiente actualización de React.
- CI arranca el servidor compilado contra PostgreSQL efímero y verifica salud, disponibilidad de base, HTML, bundle y respuestas de sesión/API.

Las pruebas de escenas usan Three y un registrador de llamadas de render en Node. No sustituyen una compilación de shaders en GPU ni una revisión visual en navegador. En esta implementación no se han medido FPS, temperatura ni calidad visual en teléfonos reales.

Verificación local del 10 de septiembre de 2026 (Node 24; CI usa Node 20): 546 pruebas aprobadas, TypeScript y build aprobados; shell de aproximadamente 315 KB sin comprimir / 107 KB gzip y motor+escenas diferidos de 239 KB gzip. La auditoría cumple la puerta `high`; reporta siete avisos moderados en dependencias transitivas (`qs` y la cadena de almacenamiento de Replit). No equivale a una auditoría sin avisos.

Antes de considerar certificado el acabado móvil: revisar un Android y Safari/iOS con tarjetas reales (una y tres capas), gestos de orbe, scroll rápido/bucle del catálogo, apertura/cierre de visores, rotación de pantalla, navegación con teclado y cambios de movimiento reducido. Comprobar el fallback ante CORS y contexto perdido, y lectura con audio sin superficie 3D. No se debe declarar «60 fps garantizados» ni «fotorealismo» a partir de la compilación o estas pruebas.

## Actualizar Replit

Detener la ejecución anterior y actualizar desde `main`:

```bash
git pull --ff-only origin main
npm ci
```

Después, pulsar Run. La configuración de Replit ejecuta `npm run replit`: construye el cliente y servidor y sirve el build con las credenciales existentes. Si el pull ya se hizo desde la pestaña Git, sólo hace falta `npm ci`. No hay migraciones nuevas, claves nuevas ni descargas de modelos para esta actualización. El despliegue publicado conserva su flujo existente de build y `start:migrated`.
