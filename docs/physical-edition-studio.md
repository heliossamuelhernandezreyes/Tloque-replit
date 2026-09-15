# Taller de ediciones físicas

El taller se abre desde **Crear edición física** en la ficha de un clásico o una obra propia, y desde el botón de PDF de un ejemplar autorizado. El manuscrito se compone en el dispositivo. No requiere un servicio de PDF de pago, una cuenta de imprenta ni una migración de base de datos.

La preparación de archivos no emite folios ni modifica derechos, compras, precios o comisiones. Las ediciones comerciales siguen utilizando los ejemplares del sistema existente. En libros guardados desde Gutenberg se recuperan los capítulos completos de IndexedDB antes de componer.

## Elegir la salida

| Destino | Archivo y tamaño | Cómo imprimir |
| --- | --- | --- |
| En una imprenta | Interior en páginas individuales: A5 148 × 210 mm, novela 152.4 × 228.6 mm o media carta 139.7 × 215.9 mm. Cubierta extendida independiente. | Entregar ambos archivos y la ficha. La imprenta confirma papel, encuadernación, color y lomo. |
| En casa | Interior carta 215.9 × 279.4 mm o A4 210 × 297 mm. | Tamaño real, 100 %, una página por cara; doble cara por borde largo. Probar dos hojas. |
| Cuadernillos | Hojas apaisadas carta o A4 con dos páginas por cara, ya ordenadas en signaturas de 4, 8, 16 o 32 páginas. | 100 %, doble cara por borde corto. No activar otra vez «Folleto» o «2 páginas por hoja». Doblar cada signatura y reunirlas en orden. |

La media hoja A4 mide **148.5 × 210 mm**. No se sustituye por A5 de 148 mm: esa diferencia importa al plegar. El último cuadernillo se completa hasta un múltiplo de cuatro; puede tener menos hojas que los anteriores. La ficha incluye la correspondencia entre hoja, cara y página. No se cambia automáticamente a otra encuadernación al crecer el libro.

La cubierta recortable usa dos hojas verticales impresas a una cara: portada con lomo y contraportada con una pestaña de 12 mm. El usuario mide el bloque real de páginas antes de introducir el lomo. Las líneas continuas indican recorte; las discontinuas, doblez. La pestaña se pega bajo el lomo. Las medidas deben caber en el papel dejando al menos 10 mm laterales; si no caben se bloquea ese archivo. El gramaje compatible depende de la impresora.

## Diseño y revisión

El flujo tiene tres pasos: **Formato → Diseño → Revisión**. En escritorio, los ajustes y la maqueta aparecen juntos. En móvil, las pestañas Ajustes/Maqueta conservan espacio útil y el zoom permite leer la página. La navegación salta directamente al capítulo; las guías son una superposición de la maqueta y no se imprimen.

Se incluyen tres composiciones: literaria con sangrías, contemporánea con separación de párrafos y lectura amplia con cuerpo de 15 pt. Se pueden ajustar cuerpo, interlineado y márgenes. El interior usa papel blanco, tinta en escala de grises, márgenes enfrentados, control de líneas viudas y huérfanas, encabezados, folios de página e índice con referencias reales. Los capítulos pueden comenzar a la derecha; las páginas en blanco necesarias permanecen vacías.

La fuente Source Serif 4, en regular, negrita y cursiva, se incluye bajo OFL y se incrusta en los PDF. Se preservan los caracteres del manuscrito, normalizados a NFC. El justificado limita la separación entre palabras y no estira las letras. No hay partición silábica automática; una palabra indivisible demasiado larga se divide sin eliminar caracteres y genera un aviso.

El tratamiento de saltos distingue prosa con renglones partidos, párrafos separados por salto y verso. El modo de prosa es el predeterminado para las copias locales de Gutenberg. Antes de imprimir un poema hay que elegir Verso y revisar su maqueta: una línea que exceda el ancho disponible seguirá necesitando ajuste editorial.

La cubierta mantiene la proporción y las letras de las imágenes originales. La ilustración de contraportada se puede conservar o sustituir por texto editable, sin cambiar la sinopsis del libro. El aviso de resolución utiliza los píxeles originales y el tamaño físico colocado; informa la menor resolución efectiva cuando hay dos imágenes. No inventa detalle ni aumenta artificialmente los píxeles. El fondo exterior cubre el sangrado.

El lomo se introduce con una medida confirmada y vuelve a cero si cambian los ajustes de paginación. No se calcula con un grosor de papel supuesto. El taller no añade letras al lomo sin una plantilla específica de imprenta. Un título, crédito, entrada del índice o texto de cubierta que no cabe bloquea la exportación correspondiente. Un fallo de cubierta no impide descargar un interior válido.

El QR exterior contiene el folio público. La clave de activación se mantiene en la página interior, en un fragmento de URL; no se incluye en la ficha de impresión ni en los ajustes guardados. Los ajustes locales solo contienen diseño: nunca manuscritos, imágenes o claves.

## Qué comprueba y qué debe confirmar la imprenta

El interior contiene texto vectorial seleccionable y fuentes TrueType incrustadas. Se publican MediaBox, TrimBox y BleedBox reales; el visor recibe la preferencia de impresión al 100 %. Los interiores de texto no necesitan sangrado porque no hay ilustraciones que lleguen al borde. La cubierta admite sangrado configurable de 3 a 6 mm, con 3.175 mm iniciales.

Estos archivos **no están certificados como PDF/X**, no incorporan un perfil ICC de salida ni convierten automáticamente las ilustraciones a CMYK. Si la imprenta exige PDF/X-1a, PDF/X-3, PDF/X-4, un perfil de color concreto o su propia plantilla, el archivo debe pasar por ese proceso de preimpresión antes de producirse. La revisión del taller no reemplaza la prueba física ni garantiza la aceptación de una plataforma de impresión bajo demanda.

El alcance actual es un libro de texto con cubierta. No compone tablas complejas, notas al pie, imágenes interiores a sangre, pliegos desplegables ni tapas duras. Las escrituras que necesitan composición adicional, como árabe o CJK, y los glifos ausentes bloquean el PDF para evitar texto ilegible. Se admite texto latino, griego y cirílico cubierto por las fuentes. La interfaz del taller está en español e inglés; los rótulos impresos también tienen versiones en francés, alemán, italiano, portugués y ruso.

El límite es 6 millones de caracteres, 500 capítulos y 1800 páginas por volumen. Los avisos de margen interior según paginación son referencias orientativas: siempre prevalecen las especificaciones del proveedor y la encuadernación elegida.

## Investigación aplicada

Consulta realizada para esta implementación, septiembre de 2026. Las especificaciones de los proveedores deben revisarse antes de una tirada.

| Fuente primaria | Decisión aplicada |
| --- | --- |
| [IngramSpark, File Creation Guide](https://www.ingramspark.com/hubfs/downloads/file-creation-guide.pdf) | Interior y cubierta separados, resolución efectiva de referencia de 300 ppp, fuentes incrustadas, revisión de sangrado y confirmación del perfil de imprenta. No presentar un PDF genérico como certificado. |
| [KDP, trim size, bleed and margins](https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6) | Medidas físicas explícitas y aviso de margen interior al aumentar el número de páginas; interior de texto sin sangrado. Los formatos no se anuncian como presets universales de KDP. |
| [Adobe InDesign, preflight](https://helpx.adobe.com/indesign/desktop/print/preflight/configure-and-use-the-preflight-panel.html) | Una revisión antes de descargar, diferenciando errores que bloquean de avisos y enlazando a la página afectada. |
| [IBM Carbon, progress indicator](https://carbondesignsystem.com/components/progress-indicator/usage/) | Tres pasos con estado actual, pasos visitados y navegación directa. |
| [W3C, CSS Paged Media](https://www.w3.org/TR/css-page-3/) y [CSS Fragmentation](https://www.w3.org/TR/css-break-3/#widows-orphans) | Páginas enfrentadas, recto, blancos intencionados y al menos dos líneas por fragmento de párrafo. La implementación usa composición propia; estas referencias no implican un motor CSS paginado. |
| [Adobe, Source Serif](https://github.com/adobe-fonts/source-serif/tree/4.005R) | TTF oficiales fijadas a 4.005R y licencia OFL incluida. |
| [jsPDF](https://github.com/parallax/jsPDF) | Texto vectorial Unicode mediante fuentes TTF incrustadas, exportación local y adaptación aislada de los diccionarios de página. |

## Arquitectura y verificación

`model.ts` normaliza ajustes, dimensiones e imposición. `compose.ts` produce una lista determinista de operaciones por página usando las métricas TTF reales. `PrintPreview.tsx` y `pdfRuntime.ts` consumen esa misma maqueta. `cover.ts` compone los paneles; `coverPdf.ts` exporta la cubierta extendida y el kit. `print.worker.ts` realiza el trabajo de composición y PDF fuera del hilo de la interfaz. Las tareas obsoletas se cancelan al cambiar ajustes o cerrar el taller. Vite construye el worker como módulo ES.

Las tres fuentes se distribuyen con la aplicación, sin descarga externa en tiempo de ejecución. El taller y sus dependencias se cargan al abrirlo. No se añaden dependencias de producción ni se modifican los procesos de pagos, migraciones o Replit.

La prueba del navegador utiliza la **versión compilada**, una API de fixtures aislada y un manuscrito de prueba original. Comprueba escritorio, móvil, zoom, recuperación de IndexedDB, cambios de diseño, confirmación de lomo y descargas. Cualquier escritura a la API o error de ejecución hace fallar la prueba.

La inspección independiente con pypdf verifica todo el texto por página, fuentes incrustadas, mapas Unicode, cajas físicas, preferencias de impresión, marcadores y orden de cuadernillos. Poppler renderiza los PDF descargados para la revisión visual. Una comprobación de píxeles exige márgenes vacíos fuera de los paneles recortables: detecta recortes ineficaces aunque el PDF siga siendo válido.

Los artefactos del workflow **Print edition check** conservan PDF, fichas, capturas y pruebas renderizadas durante siete días. Las pruebas ordinarias cubren conservación del manuscrito, viudas y huérfanas, geometría, imposición, Unicode, límites, resolución, contraportadas y separación de claves.

Comandos para desarrollo, desde la raíz del repositorio:

```sh
npm ci
npm run check
npm test
npm run build
npm run check:bundle
# Solo para QA local; estas herramientas no forman parte de la app:
npm install --no-save --package-lock=false --ignore-scripts playwright@1.62.1
npx playwright install chromium
python -m pip install pypdf==6.10.0 Pillow==11.3.0
# Instalar también Poppler en el sistema (pdftoppm).
npm run test:print:browser
python scripts/check-print-pdfs.py
```
