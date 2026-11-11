# Gutenberg: exploración, revisión e importación

Actualización del 11 de noviembre de 2026.

Abre **Explorar los clásicos** desde Biblioteca o sus resultados de búsqueda. Los administradores también pueden abrirlo desde **Administración → Catálogo y Gutenberg**.

## Uso

1. Explorar las ediciones populares sin escribir una búsqueda, o buscar por título, autor, número de Gutenberg o enlace oficial `https://www.gutenberg.org/ebooks/2000`. También se reconocen enlaces de texto como `/ebooks/2000.txt.utf-8`, `/cache/epub/2000/pg2000.txt` y `/files/2000/2000-8.txt`.
2. Elegir idioma, tema y orden. Las incorporaciones recientes se ordenan por el identificador del catálogo, no por el año de publicación de la obra. La búsqueda no traduce títulos ni libros.
3. Recorrer las páginas. Se aprovechan las 32 entradas que ofrece cada página de Gutendex. El recuento corresponde a la fuente; una página puede mostrar menos elementos si alguna edición carece de un archivo permitido.
4. Abrir una edición: idioma real, autores, traductores disponibles, portada de la misma edición, procedencia del resumen, tamaño y tiempo de lectura aproximado.
5. Cambiar de capítulo para leer una muestra de hasta 4.000 caracteres o seguir el enlace a la ficha de origen.
6. Abrir en Tloque las ediciones publicadas. En modo administrador, revisar título, género y sinopsis e importar el texto completo como **borrador**. La publicación se tramita desde el editor después de la revisión de derechos.

Selecciona el nombre de un autor en una muestra para ver sus ediciones en todos los idiomas. La búsqueda por título y los filtros siguen disponibles dentro del catálogo de ese autor. Al buscar por número o enlace oficial, el explorador busca la edición concreta en todos los idiomas.

Desde una obra publicada se puede abrir su perfil de autor. Los perfiles clásicos enlazan a las ediciones de Gutenberg y muestran las fechas biográficas cuando figuran en los metadatos de la obra. El catálogo de cada perfil permite buscar títulos y cargar más obras.

Los borradores importados se abren con `source=server`, conservando en el editor su autoría, identidad Gutenberg y estado editorial. El campo de autor guardado respeta los 160 caracteres del editor. La vista previa conserva la atribución completa que entrega la fuente.

En móvil, la ficha ocupa el panel y ofrece **Volver a resultados**. En escritorio, resultados y ficha tienen desplazamiento independiente. El diálogo usa bloqueo de foco y cierre con Escape. Los nuevos textos incluyen los nueve idiomas de la interfaz; se mantienen los dieciséis idiomas documentales.

## Integridad editorial

- El filtro aplica el idioma elegido, incluida la opción **Todos los idiomas**. Un título o autor coincidente en Tloque ya no redirige automáticamente a otra edición.
- Cada importación se identifica por su Gutenberg ID. En modo administrador, los resultados incluyen el estado de la edición importada y un conflicto de duplicado ofrece abrirla. Las ediciones retenidas por revisión o derechos se excluyen de las consultas públicas.
- El resumen y la portada proceden de la misma ficha de Gutenberg/Gutendex. Si falta resumen, se muestra una ficha bibliográfica. Si falta portada o falla la imagen, se presenta una cubierta tipográfica. No se consulta Google Books/Open Library para adjuntar a ciegas otra edición.
- Los resúmenes no declaran un idioma detectado: el API no aporta ese dato. Se conservan tal como los entrega la fuente, sin traducciones automáticas ni llamadas a API de pago.
- El año de publicación original queda desconocido. Los años de un asunto bibliográfico pueden describir una época o ambientación.
- La limpieza reconoce los marcadores oficiales aunque estén después del preámbulo. Se mantienen notas, leyendas de ilustraciones, prólogos, dedicatorias, poemas y secciones breves.
- Un byte dañado en un archivo UTF-8 ya no convierte todas sus tildes y caracteres no latinos a Windows-1252. Se conserva el Unicode válido y se señala el byte ilegible con el carácter de sustitución. Los archivos declarados Windows-1252/Latin-1 conservan su decodificación histórica.
- La división de capítulos es heurística. Admite encabezados multilingües y números escritos; conserva las páginas anteriores al primer capítulo. Cuando no reconoce la estructura, conserva el texto íntegro. Secciones extraordinariamente largas se dividen sin eliminar contenido para respetar los límites del editor.
- La descarga para lectura sin conexión se solicita desde la ficha de la edición publicada y aplica los permisos de esa edición.

## Disponibilidad y límites

El catálogo usa `GET /api/gutenberg/catalog?q=&lang=es&page=1&sort=popular&topic=`. Se conservan las rutas anteriores de búsqueda, vista previa e importación. La ruta antigua de búsqueda mantiene sus alternativas de idioma por compatibilidad; la interfaz nueva utiliza la ruta estricta.

Las respuestas externas se validan y tienen límite de tamaño. El texto y la portada deben corresponder al identificador de la edición. Solo se descargan archivos HTTPS de `gutenberg.org` o `www.gutenberg.org`, bajo `/files/` o `/cache/epub/`, sin credenciales, puertos personalizados ni redirecciones. Los alias oficiales `/ebooks/<id>.txt` y `/ebooks/<id>.txt.utf-8` se resuelven localmente al archivo UTF-8 `/cache/epub/<id>/pg<id>.txt`. Si un archivo responde 404, se permite un segundo intento con otra fuente de texto válida de la misma ficha; no se multiplican peticiones ante errores de conexión o sobrecarga. El plazo de descarga cubre también la lectura del cuerpo.

Un fallo de la fuente devuelve 503 con `Retry-After`, salvo que exista una página válida reciente de **esa misma consulta, idioma, página, tema y orden**. En ese caso se puede recuperar durante los 30 minutos posteriores a su caducidad de dos minutos. La interfaz muestra un aviso traducido a los nueve idiomas, la fecha de los datos y un botón para reintentar. Enviar de nuevo la misma búsqueda también reintenta la consulta.

La recuperación mantiene los mismos presupuestos de memoria y no prolonga la caducidad con cada error. Es por proceso y requiere una consulta previa satisfactoria; no funciona como catálogo persistente tras reiniciar el servidor. No se aplica a la descarga ni a la importación de libros. Los permisos y el estado de publicación se vuelven a consultar en la base de datos incluso con resultados recuperados.

Caché por proceso, sin datos personales:

| Datos | Caducidad | Entradas | Presupuesto aproximado | Trabajos simultáneos |
| --- | --- | --- | --- | --- |
| Fichas | 15 minutos | 100 | 4 MB | 8 |
| Páginas de búsqueda | 2 minutos | 40 | 6 MB | 8 |
| Libros procesados | 10 minutos | 6 | 32 MB | 2 |

Las solicitudes simultáneas de una misma clave comparten el trabajo. Las entradas se expulsan al alcanzar el presupuesto; los errores no se conservan. La vista previa y la importación reutilizan el texto procesado mientras siga disponible. No se precargan libros completos al explorar.

La fuente continúa siendo externa. Esta actualización no introduce un espejo propio ni garantiza disponibilidad de Gutendex, y no incorpora EPUB, ilustraciones incrustadas ni maquetación HTML. No requiere una migración SQL, nuevas dependencias ni nuevas credenciales. Tampoco reimporta o reemplaza libros ya guardados.

## Verificación

`npm run check`, `npm test`, `npm run build`, `npm run check:bundle` y `npm run test:gutenberg:browser`.

Las pruebas de servidor cubren idioma, paginación, metadatos inválidos, fuente caída, SSRF, plazos de streaming, tamaño máximo, identidad de edición, conservación del texto, caché y conflictos de importación. También prueban enlaces oficiales de descarga, archivo alternativo ante 404, Unicode parcialmente dañado, capítulos con dígitos de ancho completo y recuperación con caducidad y presupuesto. Una prueba HTTP ejecuta las rutas reales con almacenamiento aislado para comprobar permisos y no revelar borradores, incluidos resultados recuperados después de cambiar el estado de publicación.

La prueba de navegador ejecuta la aplicación con respuestas controladas. Comprueba el catálogo, la paginación, los filtros, el reintento, las muestras, la vuelta a resultados en móvil, la importación, los duplicados y la apertura del borrador con su autoría original. El trabajo `visual-browser` de GitHub Actions guarda las capturas como artefactos.

## Fuentes consultadas

- [Contrato oficial de Gutendex](https://gutendex.com/): paginación, idiomas, formatos, búsqueda, orden, temas y metadatos por edición.
- [Código fuente de Gutendex](https://github.com/garethbjohnson/gutendex): implementación y opción de alojar una instancia propia para uso sostenido.
- [Catálogos de Project Gutenberg](https://www.gutenberg.org/ebooks/offline_catalogs.html): datos para automatización y ausencia del año original de publicación.
- [Política de acceso automatizado](https://www.gutenberg.org/policy/robot_access.html): utilizar los canales de catálogo y descarga previstos; no rastrear páginas HTML ni efectuar descargas masivas desde el explorador.

Para ampliar el servicio a mayor escala, el siguiente paso es un índice propio alimentado por los catálogos publicados, con una instancia o proveedor de metadatos bajo control de Tloque. No se despliega ni contrata infraestructura adicional en este cambio.
