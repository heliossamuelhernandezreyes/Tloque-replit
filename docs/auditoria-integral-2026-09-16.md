# Auditoría integral de Tloque

**Versión examinada:** [0e88f6c7f5b8d82f6d46e467ca953557704eb869](https://github.com/heliossamuelhernandezreyes/Tloque-replit/commit/0e88f6c7f5b8d82f6d46e467ca953557704eb869). Trabajo iniciado el 16 de septiembre y cerrado el 17 de septiembre de 2026, UTC.

**Dictamen:** las pruebas existentes pasan, pero hay defectos reproducibles de revocación de permisos, aislamiento entre cuentas y transacciones. Conviene corregirlos antes de abrir ventas y recargas al público. El motor 3D existe; la importación de modelos GLB todavía no. La impresión tiene composición y comprobaciones útiles, pero aún necesita perfiles de entrega por proveedor y pruebas físicas.

Esta entrega documenta la auditoría y agrega reproducciones aisladas. No modifica el comportamiento del producto, no despliega cambios y no utiliza el agente ni los créditos de Replit. No se hicieron pagos reales ni se utilizaron datos de usuarios.

## 1. Alcance y evidencia

| Área | Comprobación realizada | Resultado y límite |
| --- | --- | --- |
| Código y rutas | Inventario estático de 153 rutas, 81 con métodos de escritura; revisión de autorización y servicios | Inventariar una ruta no equivale a probar todas sus combinaciones |
| Pruebas generales | npm test sobre la versión fijada | 592 aprobadas, 0 fallidas |
| Tipos y compilación | npm run check; npm run build; npm run check:bundle | Aprobadas |
| Autorización y transacciones | 24 observaciones HTTP contra dos servidores de producción y PostgreSQL 16 desechable | 18 PASS y 6 FINDING |
| Aislamiento local | Módulo real de sincronización con almacenamiento y red simulados | Reproduce envío de datos de la cuenta A a la cuenta B |
| Interfaz y Gutenberg | Chromium en CI, interfaz real con API de prueba | Pasan navegación, editores, móvil, catálogo, filtros, errores e importación del fixture |
| Impresión | Siete PDF descargados del estudio compilado; inspección independiente y renderizado | Pasan texto, Unicode cubierto, fuentes, geometría, imposición y cubiertas |
| Música | npm run test:audio:render | 19 pruebas aprobadas; no sustituyen una evaluación auditiva |
| Dependencias de producción | npm audit --omit=dev --json | 7 avisos moderados; 0 altos y 0 críticos en esa ejecución |

La ejecución local usó Node 24.19.0. Las pruebas HTTP y los workflows existentes usaron Node 20. Los eventos de pago eran fixtures firmados con una clave efímera; ejercitan el servidor real, pero no demuestran una integración completa con Stripe en vivo.

**Evidencia persistente:** [observaciones HTTP](audit-2026-09-16/http-results.json), [reproducción entre cuentas](audit-2026-09-16/local-data-results.json), [inventario de rutas](audit-2026-09-16/route-inventory.json), [dependencias](audit-2026-09-16/dependency-results.json) y [resumen de verificación](audit-2026-09-16/verification-summary.json).

Ejecuciones: [auditoría HTTP](https://github.com/heliossamuelhernandezreyes/Tloque-replit/actions/runs/35119000091), [pruebas generales e interfaz](https://github.com/heliossamuelhernandezreyes/Tloque-replit/actions/runs/35119000012), [impresión](https://github.com/heliossamuelhernandezreyes/Tloque-replit/actions/runs/35118999874). El workflow observacional queda verde cuando termina correctamente, aunque encuentre defectos. Sus seis FINDING no son seis controles aprobados.

## 2. Fallos prioritarios

P1 significa corregir antes de habilitar el recorrido afectado para uso público. P2 significa corregir en el siguiente bloque de calidad. Una funcionalidad pendiente se identifica como tal y no se presenta como una vulnerabilidad.

### F01 — P1: un administrador revocado conserva acceso en otra instancia

**Reproducido.** Una instancia eliminó al administrador delegado; otra siguió devolviendo HTTP 200 al consultar administración, incluso adelantando seis minutos su reloj de prueba. Debía devolver 403.

En [server/auth.ts](../server/auth.ts#L32), la caducidad del caché solo se comprueba en la función asíncrona isAdminEmail, que no tiene llamadas en el servidor. Las rutas usan isAdmin/requireAdmin, que consultan la copia local sin refrescarla. El cambio de administradores actualiza únicamente la instancia que recibe la petición.

**Corrección:** centralizar la autorización efectiva; consultar o versionar roles de forma compartida y aplicar invalidación entre réplicas. Si no se puede verificar un permiso sensible, no conservarlo indefinidamente por un fallo de base de datos.

**Criterio de cierre:** retirar y conceder roles con dos procesos; verificar la revocación dentro de un plazo explícito, incluyendo reinicios, error de base de datos y sesiones ya abiertas.

### F02 — P1: una recarga totalmente reembolsada sigue siendo gastable

**Reproducido.** Después de registrar un reembolso completo, el monedero conservó 25 Tinta y una compra posterior devolvió HTTP 201.

[server/paymentIncidents.ts](../server/paymentIncidents.ts#L85) marca la orden e impide ciertas liquidaciones, pero no revierte ni inmoviliza el saldo correspondiente. [server/economy.ts](../server/economy.ts) calcula el débito a partir del libro de movimientos.

**Corrección:** movimientos compensatorios idempotentes, tratamiento del respaldo monetario, reembolsos parciales y una política explícita para saldo ya gastado. Bloquear una liquidación no basta para impedir nuevas compras.

**Criterio de cierre:** repetir y reordenar eventos firmados; reembolso total/parcial; gasto antes/después del evento; compra simultánea. El mismo dinero no puede seguir disponible después de devolverse.

### F03 — P1: datos locales de una cuenta pasan a la siguiente

**Reproducido con el código real de sincronización y adaptadores aislados.** Al simular que B abre un dispositivo con datos locales de A, el módulo envió la racha, el progreso y un libro guardado a la sesión de B. El borrador local de A siguió almacenado.

[useAuth.ts](../client/src/hooks/useAuth.ts#L30) no limpia ni separa esos datos al salir. [sync.ts](../client/src/lib/sync.ts) usa claves compartidas; [library.tsx](../client/src/pages/library.tsx) también carga borradores locales sin un espacio por propietario. Algunos editores visuales sí distinguen la cuenta; el aislamiento no es uniforme.

**Corrección:** claves, bases locales, colas, borradores y cachés privados ligados a un identificador de cuenta. Al salir, desconectar sincronización, invalidar consultas y cerrar tareas pendientes. Los borradores sin sincronizar deben conservarse para su propietario, sin asignárselos automáticamente al siguiente usuario ni borrarlos silenciosamente.

**Criterio de cierre:** A → salir → B; caducidad de sesión; modo sin conexión; varias pestañas; migración de datos antiguos; cierre con un borrador pendiente.

### F04 — P1: reintentar una compra crea otra compra

**Reproducido.** Dos POST a [tokens/acquire](../server/routes.ts#L1226) con el mismo Idempotency-Key devolvieron dos tokens distintos. Una segunda licencia puede ser legítima, pero el servidor no distingue esa intención de un reintento tras perder la respuesta.

**Corrección:** guardar clave de idempotencia, cuenta, operación, huella del cuerpo y respuesta en la misma transacción que el débito. Una repetición devuelve el resultado anterior; reutilizar la clave con otro contenido se rechaza. Desactivar un botón en la UI no resuelve los reintentos de red.

**Criterio de cierre:** peticiones simultáneas, respuesta perdida, reconexión, reintento desde otra instancia y compra intencional de una segunda licencia.

### F05 — P1: un ejemplar pendiente puede reclamarse después del reembolso

**Reproducido.** Se marcó como reembolsada una orden de token; luego la reclamación de su ejemplar todavía devolvió HTTP 200.

El [recorrido de reclamación](../server/routes.ts#L2004) verifica clave, propietario y existencia del token, pero no exige una licencia vigente tras un reembolso. Falta un estado comercial explícito que coordine orden, licencia y ejemplar.

**Corrección:** definir estados vigentes, anulados y en disputa; bloquear la primera reclamación de una licencia invalidada. Resolver expresamente el caso de un tercero que ya adquirió y reclamó el libro. No quitar accesos indiscriminadamente cuando una persona tiene otras licencias válidas.

**Hallazgo asociado, P2:** la consulta de estado del QR carece de Cache-Control: no-store aunque su respuesta puede depender de la sesión. Se comprobó la cabecera ausente; no se demostró una fuga a través de un caché real.

### F06 — P1 para imprimir y vender: el QR depende de la sesión y del dominio temporal

**Confirmado por trazado del código; no ejecutado con Google real.** [App.tsx](../client/src/App.tsx#L214) bloquea el router completo cuando no hay sesión. El acceso con Google no conserva el destino y el [callback](../server/auth.ts#L203) siempre vuelve a la raíz. La persona que escanea sin sesión pierde el recorrido de reclamación.

Además, [PrintStudio.tsx](../client/src/print/PrintStudio.tsx#L72) compone enlaces con window.location.origin. Descargar desde una vista temporal de desarrollo imprime ese dominio en el papel. Que el PDF sea correcto no garantiza que su enlace sobreviva al cambio de alojamiento.

**Corrección:** página pública de verificación; retorno de autenticación validado; conservación temporal y privada de la intención de reclamar; dominio canónico permanente configurado en servidor. No incluir la clave secreta en parámetros que terminen en registros o servicios externos. Impedir una edición comercial con localhost o un dominio temporal.

**Criterio de cierre:** escanear con/sin sesión, iniciar/cancelar autenticación, reanudar, repetir y abrir un folio ya reclamado; conservar enlaces al cambiar el alojamiento.

### F07 — P1 para portadas externas: la política de producción impide cargarlas para el PDF

**Incompatibilidad confirmada en código y reglas de CSP; pendiente de reproducción con navegador bajo cabeceras de producción.** [security.ts](../server/security.ts#L56) permite imágenes HTTPS visibles, pero restringe las conexiones a self. [browserFiles.ts](../client/src/print/browserFiles.ts#L8) obtiene las portadas mediante fetch. Gutenberg puede guardar una portada de otro dominio: se verá como imagen, pero ese fetch no está autorizado por la política de producción.

Las pruebas actuales de impresión usan una API de prueba y no ese conjunto de cabeceras. La previsualización de desarrollo también tiene una política más permisiva. La distinción entre carga de imágenes y fetch está descrita en [MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src).

**Corrección:** incorporar las portadas al almacenamiento controlado de Tloque, con validación, permisos y límites; servirlas desde un origen admitido. Evitar una ampliación indiscriminada de la política de conexiones. La exportación debe explicar si falta el arte y pedir una decisión.

**Criterio de cierre:** portada local, externa autorizada, ilegible y demasiado grande bajo NODE_ENV=production; comprobar visualmente el PDF descargado.

### F08 — P2: la protección contra sobrescritura se puede omitir

**Reproducido.** Enviar una revisión antigua devuelve 409 correctamente. Omitir expectedRevision permite guardar y devuelve 200.

La defensa existe, pero es opcional en la actualización ordinaria. Exigir revisión o una precondición equivalente en todas las escrituras de manuscrito, con una operación separada y autorizada para restauraciones. Probar dos editores y la recuperación de trabajo sin perder ninguno de los textos.

## 3. Separación de permisos

La auditoría HTTP confirmó que un lector no puede administrar, instalar bancos, editar libros ajenos, modificar ejemplares ajenos ni consultar revisiones privadas. El borrador propio sí es accesible para su autor. Se rechazaron una escritura desde otro origen, un webhook sin firma y una clave de reclamación incorrecta. El QR público no expuso la clave secreta en el fixture.

El problema no es ausencia total de controles. Son la revocación F01, el aislamiento local F03 y un administrador demasiado amplio para delegar trabajo.

| Capacidad | Estado examinado | Separación propuesta |
| --- | --- | --- |
| Leer y guardar libros | Sesión y biblioteca del usuario | Lector |
| Editar manuscritos y revisiones | Relación de autoría | Autor sobre su propia obra |
| Gestionar ejemplares | Propietario del token/licencia | Titular de la edición o ejemplar |
| Publicar marcos y recursos | Administrador general | Gestor de recursos visuales |
| Instalar bancos y aprobar audio | Administrador general | Gestor de audio |
| Revisar catálogo | Administrador general | Curador |
| Revisar pagos y liquidaciones | Administrador general | Operador financiero |
| Otorgar permisos | Administrador general, con protección especial del fundador | Gestor de acceso restringido |

Una licencia vendible puede pertenecer a alguien distinto del autor: no cambiar ese permiso accidentalmente al separar roles. Cada capacidad debe comprobarse en servidor y para el objeto solicitado, siguiendo los principios de [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

## 4. QR y tokens: conservar la idea y completar su ciclo de vida

La base técnica es útil: folio público, secreto separado, cifrado AES-256-GCM, HMAC, comparación resistente a diferencias de tiempo y reclamación transaccional. Dos reclamaciones simultáneas produjeron un solo ganador: 200 y 409.

No hace falta convertir las licencias en blockchain ni sustituirlas por JWT. Un registro transaccional de licencias y ejemplares permite revocar, conciliar y corregir errores de forma más clara.

La evolución recomendada es:

1. **Edición inmutable:** identificador, revisión del manuscrito, huellas de arte y contenido, idioma, créditos y perfil de impresión. Un ejemplar conserva la edición que se autorizó, aunque el autor edite el libro después.
2. **Licencia comercial:** titular, derechos, origen del pago, cantidades y estado. Cada licencia vendible mantiene su relación con un ejemplar.
3. **Ejemplar:** folio público permanente; estados de emisión, reclamación, anulación y disputa. Registrar transiciones de forma auditable.
4. **Secreto de reclamación:** para nuevas emisiones, 128 bits aleatorios o más en el QR privado; código manual independiente con límites de intentos por folio, cuenta e IP.
5. **Recuperación y claves:** versión e identificador de clave para rotar sin romper ediciones antiguas. El secreto actual CLAIM_KEY_SECRET no debe reemplazarse sin una migración diseñada.

El generador actual usa ocho símbolos de un alfabeto de 31 caracteres, unos 39,6 bits como techo, con un pequeño sesgo por usar módulo sobre bytes aleatorios. Esto es una oportunidad de endurecimiento; no se demostró un ataque de fuerza bruta. Una clave larga en QR permite aumentar la seguridad sin exigir que el lector la teclee.

El secreto debe ir dentro del ejemplar o protegido físicamente. Un QR visible en una foto no puede funcionar a la vez como verificación pública y como prueba secreta de propiedad. Tampoco impide copiar el papel: acredita un registro digital y controla su primera reclamación.

## 5. Modelos 3D, animaciones y editores

**Funcionalidad pendiente.** Hay Three.js, React Three Fiber, un compositor compartido, control de calidad y escenas procedurales. Las pruebas de navegador ejercitaron WebGL, inspectores, pausa, búsqueda temporal, guardado e importación/exportación de recetas.

[FrameStudio](../client/src/visual/FrameStudio.tsx) acepta JSON de hasta 400 KB y plantillas astral, relicario y flor. [CardDirector](../client/src/visual/CardDirector.tsx) acepta recetas JSON de hasta 32 KB con capas de imagen. No se encontró un recorrido de carga GLB, GLTFLoader ni AnimationMixer en el código de aplicación. Importar una receta de parámetros no importa una malla animada de Blender.

**Arquitectura propuesta, aprovechando el motor existente:**

1. Exportar glTF 2.0/GLB desde la herramienta de creación, con escala, pivote, materiales y clips nombrados.
2. Subir a un área temporal; validar con [glTF-Validator de Khronos](https://github.com/KhronosGroup/glTF-Validator). Comprobar además tamaño descomprimido, texturas, geometría, extensiones permitidas y referencias externas. Un archivo válido aún puede ser demasiado costoso para un móvil.
3. Generar versiones optimizadas, miniatura y póster; guardar licencia de uso y huella de contenido. Publicar con un rol específico.
4. Cargar mediante GLTFLoader y controlar clips con AnimationMixer. Activar decodificadores Draco, Meshopt o KTX2 solamente cuando se soporten sus extensiones, alojándolos de forma compatible con CSP. [Documentación de Three.js](https://threejs.org/docs/pages/GLTFLoader.html).
5. Extender el esquema del editor con assetId, clips y eventos idle, hover, inspect y reveal; mantener lectura de escenas antiguas. Permitir vista de escala, encuadre, materiales y presupuesto antes de publicar.
6. Reutilizar compositor, pausa por visibilidad, calidad adaptativa, liberación de recursos y póster de respaldo cuando WebGL no esté disponible.

Para una primera prueba de héroe móvil, se proponen presupuestos provisionales de 5 MB comprimidos, 50 mil triángulos y unas 20 llamadas de dibujo. Son objetivos para medir, no límites universales ni una garantía de fluidez. Las texturas, transparencia, partículas y postprocesado pueden costar más que la malla.

El orbe y los marcos pueden tener secuencias de inspección elaboradas con clips, cámara, partículas y materiales. Reservarlas para una interacción explícita; durante lectura y navegación, usar reposos discretos. Probar importación de malla estática, esqueleto, morphs, materiales transparentes, clips y compresión; rechazar archivos dañados, referencias externas y recursos excesivos con mensajes claros.

## 6. Impresión profesional

Las siete salidas de prueba verificaron fuentes incrustadas, contenido completo, geometría, cubierta separada y cuadernillos. Las hojas renderizadas mostraron texto legible, márgenes coherentes, índice y capítulos ordenados. El estudio ya separa ajuste, diseño y revisión; en móvil alterna controles y maqueta.

| Recorrido | Base disponible | Trabajo para cerrar la promesa |
| --- | --- | --- |
| Novela de texto | Source Serif 4, medidas de glifos, márgenes espejados, control de viudas/huérfanas y capítulos | Guionado por idioma, estilos editoriales ampliados y pruebas de libros largos |
| Casa | Carta/A4, imposición y cuadernillos, kit de cubierta para recortar | Prueba física de dúplex, plegado, escala real y lectura de QR |
| Imprenta | Interior y cubierta separados, sangrado, cajas de página y avisos de resolución | Perfiles por proveedor, papel, encuadernación y límites de páginas |
| Color | Arte raster y advertencias | Gestión de color y perfil de salida solicitado por la imprenta |
| Idiomas complejos | Rechazo de glifos no soportados | Motor de composición adecuado para RTL/CJK, ligaduras y fuentes necesarias |

**Todavía no hay PDF/X ni OutputIntent/ICC.** Las portadas son RGB; el texto utiliza gris. No corresponde afirmar que cualquier imprenta aceptará el resultado. La propia UI ya reconoce esa limitación. El formato requerido debe elegirse con cada proveedor: por ejemplo, la guía de [IngramSpark](https://www.ingramspark.com/hubfs/downloads/file-creation-guide.pdf) contempla PDF/X-1a:2001 o PDF/X-3:2002; los márgenes de [KDP](https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6) dependen del número de páginas.

No basta con convertir todo a CMYK. El perfil, las transparencias, el negro, las fuentes y el sangrado deben concordar con el destino. Generar y verificar un PDF/X real requiere comprobación independiente de conformidad, además de renderizarlo.

**Siguiente estudio de impresión:** elegir Casa o Imprenta; seleccionar perfil; mostrar papel, encuadernación y páginas; calcular o confirmar el lomo con datos del proveedor; revisar cubierta y zona de código de barras; descargar interior, cubierta e informe de revisión. Distinguir errores que bloquean de advertencias y asociar cada una con la página o recurso afectado.

El formato actual es más apropiado para narrativa de texto. No cubre todavía una maquetación general de libros ilustrados, notas al pie, tablas complejas o todos los sistemas de escritura. La reserva para ISBN/código de barras y la composición del lomo deben depender de una plantilla verificada.

## 7. UI y movimiento: prioridades concretas

| Zona | Problema u oportunidad observada | Cambio recomendado |
| --- | --- | --- |
| Navegación principal | Funciones importantes dependen de gestos sobre el orbe | Accesos visibles a Biblioteca, Explorar, Crear y Perfil; conservar el orbe como elemento expresivo |
| Carruseles | Se aplican transformaciones a las tarjetas durante el desplazamiento; hay duplicación para carruseles pequeños | Un único sistema de arrastre e inercia; ajuste suave sin rebote; limitar trabajo a tarjetas visibles |
| Sinopsis | La decoración compite con información y acciones | Un botón principal Leer/Continuar, progreso claro, disponibilidad y edición física en segundo nivel |
| Editores visuales | Un archivo JSON no explica qué se puede importar | Selector separado de modelo, imágenes y receta; vista previa, clips y errores accionables |
| Estudio de impresión | Notas y etiquetas muy pequeñas en móvil | Texto auxiliar legible, resumen persistente, avisos junto al campo y vista ampliable |
| Mi biblioteca | La tarjeta de obra propia en Home es un div con gestos; su borrado no comprueba res.ok antes de completar el estado local | Controles semánticos, teclado, confirmación y restauración si el servidor rechaza |
| Movimiento reducido | Varias piezas respetan el sistema, pero CosmicBackground, ParallaxCover y el brillo heredado consultan solo el ajuste de la app | Política compartida para sistema/app, suspensión de bucles y alternativa estática |
| Feedback | Operaciones locales, nube y procesos largos no siempre se distinguen | Estados guardando, guardado local, sincronizado, conflicto y reintentar |

El resorte incómodo descrito por el usuario no quedó medido en su teléfono en esta auditoría. La aceptación debe incluir arrastre lento, flick rápido, cambio de dirección, extremos y botón de avance en el Poco X7 Pro y un Android de menor capacidad. No mezclar dos mecanismos que intenten mover o centrar el mismo carrusel.

Usar 44 px como objetivo cómodo de control táctil cuando el diseño lo permita. No confundirlo con el mínimo AA de 24 px y sus excepciones en [WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Faltan una comprobación completa de contraste, teclado, lector de pantalla, ampliación y foco; no se declara conformidad WCAG.

## 8. Rendimiento y funcionamiento sin conexión

El presupuesto existente pasa: el archivo App mide 281.000 bytes, 95.907 comprimidos; el módulo 3D diferido pesa 242.252 bytes gzip. Ese primer valor **no es todo lo que descarga el inicio**.

La inspección reproducible de importaciones estáticas del build, añadiendo expresamente App, Home, música y 3D como raíces, produjo estas estimaciones acumuladas:

| Conjunto | Archivos JS/CSS únicos | Bytes sin comprimir | Bytes gzip calculados |
| --- | ---: | ---: | ---: |
| Entrada HTML y dependencias iniciales | 3 | 353.894 | 101.341 |
| Entrada y App | 7 | 862.177 | 269.151 |
| Anteriores y Home | 15 | 1.010.448 | 307.490 |
| Anteriores, música precargada y 3D | 22 | 2.118.750 | 615.621 |

Son tamaños de archivos, no tráfico capturado, RAM ocupada, peso instalado ni tiempo de carga. Excluyen otras importaciones dinámicas y precargas de Vite, portadas, fuentes, muestras de audio y respuestas API. La caché, compresión del servidor y decisiones de ejecución cambian la descarga real. [Mediciones y método](audit-2026-09-16/client-load-results.json); [script reproducible](../scripts/audit-client-load.mjs).

Puntos concretos para optimizar:

- [MusicProvider](../client/src/audio/MusicProvider.tsx#L64) precarga el motor en reposo aunque no se haya solicitado música. Condicionar por preferencia, intención y ahorro de datos; la precarga no significa que ya se cree AudioContext.
- Paginar el catálogo y reducir el trabajo de carruseles fuera de pantalla. Evitar que abrir un estudio mantenga todas las escenas decorativas activas detrás.
- Medir memoria de texturas y recursos al navegar repetidamente; el tamaño gzip no mide gasto de GPU.
- Revisar el límite global de peticiones API: las muestras individuales consumen el mismo presupuesto de IP que otras operaciones. Una descarga amplia o varios usuarios en una red pueden encontrar el límite. Es un riesgo identificado por código, no una caída de un banco completo reproducida aquí.
- En [use-books.ts](../client/src/hooks/use-books.ts), un fallo de escritura en IndexedDB cae en el bloque de fallo de red, aunque la respuesta del servidor sea válida. La caché debe ser un esfuerzo adicional y no invalidar una lectura correcta.
- El service worker guarda recursos, pero excluye API. Un arranque sin red no puede resolver la sesión y App muestra AuthUnavailable. Hay almacenamiento para lectura, pero falta cerrar el recorrido de arranque offline con biblioteca y permisos locales acotados por cuenta.
- Añadir cuotas y limpieza de caché de recursos entre versiones; no retener indefinidamente todos los archivos antiguos.

Objetivos de aceptación propuestos: respuesta inmediata al dedo, 60 fps sostenidos en el recorrido elegido, degradación deliberada cuando sea necesario, ausencia de crecimiento persistente de memoria y pausa de efectos fuera de pantalla. Medir percentiles de fotogramas y tareas largas; no prometer 120 fps por las especificaciones del teléfono.

## 9. Música, Gutenberg y operación

**Música.** Las 19 pruebas de render cubren PCM real, determinismo, transiciones, envolventes y casos de clipping, entre otros. La arquitectura incluye límites de voces, planificación y verificación de muestras. Sin embargo, los registros [NATIVE_MASTER_APPROVALS](../shared/native-acoustic-approval-registry.ts) y [NATIVE_HYBRID_APPROVALS](../shared/native-hybrid-approval-registry.ts) están vacíos: falta aprobación auditiva de esas categorías. Descargar todos los bancos no prueba por sí mismo realismo ni calidad de orquesta. La siguiente aprobación debe combinar escucha A/B, licencia y calidad de muestras, articulaciones, mezcla y estabilidad móvil. No se verificó qué bancos están instalados en Replit ni se hicieron llamadas pagadas de voz.

**Gutenberg.** La prueba de navegador cubre catálogo, filtros, errores y lectura/importación del fixture. No garantiza disponibilidad o exactitud de todos los libros externos. Probar importaciones reales representativas por idioma, limpiar encabezados y preservar metadatos; incorporar el arte al almacenamiento propio y señalar claramente la procedencia.

**Operación y mantenimiento.**

- Node 20 está fuera de soporte en la fecha de cierre. Migrar a una LTS admitida, validando dependencias de audio y despliegue. La [tabla oficial de Node.js](https://nodejs.org/en/about/previous-releases) identifica Node 22 y 24 como LTS.
- Los siete avisos moderados afectan a qs, uuid y cadenas de dependencias de almacenamiento/HTTP. Revisar actualizaciones y alcanzabilidad; no ejecutar una actualización forzada sin verificar compatibilidad. El aviso de dependencia no demuestra por sí solo una explotación en Tloque.
- Main no tenía protección de rama según la consulta de GitHub. Configurar revisión y comprobaciones obligatorias antes de fusionar.
- El arranque de desarrollo en Replit compila y sirve, pero no ejecuta las migraciones del comando de despliegue. Readiness comprueba conexión con la base de datos, no toda la compatibilidad del esquema. Añadir diagnóstico de versión y migración pendiente sin mostrar secretos.
- Reducir reglas de autorización repetidas y separar servicios de compra, ejemplares y edición. Convertir los fallos reproducidos en pruebas de regresión obligatorias al corregirlos.
- Falta verificar restauración de una copia de seguridad, configuración real de dominio/cookies, OAuth completo, proveedor de pagos y límites de servicios de voz. La auditoría no afirma haberlos probado en vivo.

## 10. Orden de implementación y condiciones de salida

| Bloque | Entrega | Condición para terminar |
| --- | --- | --- |
| 1. Permisos y privacidad | F01, F03, capacidades por función y F08 | Revocación entre instancias; cuenta B nunca ve ni sincroniza datos de A; ninguna escritura omite revisión |
| 2. Integridad económica | F02, F04, F05 y caché privada | Reembolso inutiliza saldo correspondiente; reintento no duplica; ejemplares respetan su estado comercial |
| 3. Edición y QR duraderos | F06, F07, edición inmutable y perfiles iniciales de impresión | Escaneo desde sesión cerrada; dominio estable; portada idéntica a la aprobada; archivo aceptado por el proveedor elegido |
| 4. Recursos 3D | Carga GLB, clips, validación y nuevo flujo del editor | Importar un modelo animado, guardar, reabrir, publicar y ejecutar con respaldo en móvil |
| 5. Experiencia y operación | Carruseles, accesibilidad, caché offline, presupuestos y Node LTS | Medición en teléfonos reales; recorrido offline completo; comprobaciones obligatorias y restauración ensayada |

Antes de ofrecer ventas públicas, cerrar los bloques de permisos/privacidad e integridad económica. Antes de distribuir ejemplares comerciales, cerrar además los enlaces y el perfil de impresión. El trabajo visual puede avanzar, pero no reemplaza estas condiciones.

## 11. Reproducción y límites

La reproducción HTTP está en [scripts/audit-product-http.mjs](../scripts/audit-product-http.mjs) y [product-audit.yml](../.github/workflows/product-audit.yml). Exige CI, base local llamada tloque_audit y usuarios vacíos; genera credenciales efímeras y dos procesos que termina al concluir. No ejecutarla contra una base de usuarios.

La reproducción de almacenamiento está en [scripts/audit-local-data.mjs](../scripts/audit-local-data.mjs). Se ejecuta con node scripts/audit-local-data.mjs después de instalar las dependencias. No lee el perfil de un navegador ni realiza peticiones reales. Es una reproducción observacional de la versión auditada; al corregir el aislamiento deberá convertirse en una prueba del comportamiento seguro.

Se revisaron las pruebas visuales generadas por CI. El intento adicional de navegación interactiva hacia el servidor local fue bloqueado por el entorno, por lo que no se atribuye una revisión manual nueva de toda la app en un navegador real. Las pruebas con API de fixture no sustituyen las pruebas HTTP contra PostgreSQL, ni estas cubren por completo a Google o Stripe.

No se certificaron seguridad absoluta, todos los estados de las 153 rutas, accesibilidad completa, carga masiva, consumo de batería, rendimiento físico de GPU, impresión industrial ni calidad perceptual de música. El resultado es un diagnóstico versionado con defectos reproducidos, límites explícitos y criterios concretos para la siguiente implementación.
