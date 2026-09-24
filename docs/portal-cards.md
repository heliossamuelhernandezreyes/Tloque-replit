# Tarjetas portal · 360°

El creador nuevo empieza con una tarjeta limpia: marco, canto, ventana frontal y reverso sólido. No añade planetas, cristales decorativos ni personajes. Las escenas anteriores siguen disponibles en Compatibilidad y las plantillas antiguas del estudio; no se reescriben las tarjetas guardadas.

## Crear una tarjeta

1. Abre Tarjetas → Nueva tarjeta → Diseñar tarjeta, marco y efectos.
2. Importa un fondo. Opcionalmente añade una capa media y un primer plano con transparencia PNG/WebP, todos preparados en un lienzo 5:7. Una imagen opaca delante tapará lo que tiene detrás: Tloque no recorta sujetos automáticamente.
3. En Marco ajusta ancho, grosor, esquinas y bisel. Los materiales son puntos de partida editables. Iluminación del borde es emisión; Respiración aparece al reproducir, sin destellos rápidos.
4. En Mica elige transparente, satinada, foil u holográfica; añade gotas, empañamiento o escarcha sobre esa superficie.
5. En Clima elige un ambiente general y personaliza sus tres zonas. Cada una permite efecto, cantidad, tamaño, velocidad, viento y posición dentro de su intervalo de profundidad.
6. En Reverso escribe título, inscripción y pie. El grabado/relieve es óptico (mapa de normales derivado de altura), no geometría de letras. No representa una firma verificada, certificado ni número de edición.
7. Arrastra para girar libremente en ambos ejes, o usa flechas/Mayús+flechas. Inicio y el botón Frente centran la vista; Reverso muestra el otro lado. El gesto no cambia la receta guardada.
8. Usa esta dirección y después guarda la tarjeta. El JSON exporta la receta; las imágenes se guardan con la tarjeta, no en ese JSON. Los borradores locales conservan la receta, no las imágenes recién seleccionadas dentro del director.

## Crear y equipar un marco

El Estudio de marcos comienza con un portal nuevo y comparte los mismos controles. “Probar con tus imágenes” es solo una previsualización local: no inserta arte de una tarjeta en un marco de catálogo. Guardar crea una versión nueva y conserva los originales.

Un marco equipado conserva sus materiales y geometría. Por defecto también aporta mica, reverso y ambiente. Desmarca “Usar acabados del marco equipado” o modifica un acabado para personalizarlo en esa tarjeta; el marco original y sus permisos no cambian. “Sin marco equipado” permite diseñar un marco propio.

## Qué hace el motor

- Objeto exterior 3D real: bisel extruido, canto, fondo opaco y caras frontales. La ilustración no se ve a través del reverso. Al mirar exactamente de canto, la ventana deja de verse: no es una ilustración de doble cara.
- Interior 2.5D: tres planos ordenados, con paralaje acotado según su profundidad. Tres grupos de clima se dibujan entre ellos. No reconstruye una escena volumétrica ni inventa lo que no aparece en una imagen.
- El fondo llena toda la abertura. El encuadre calcula la escala mínima que cubre las cuatro esquinas durante traslación, giro y animación; por ello puede recortar más de lo solicitado. Su opacidad permanece completa. Un fondo transparente muestra el color interior, no contenido inventado.
- Curvatura visual del fondo deforma las coordenadas de textura, no dobla físicamente la tarjeta. La mica tiene reflejos y refracción estilizados, no trazado de rayos.
- Un render target de hasta 1024 píxeles de alto y hasta 360 partículas repartidas en tres lotes. Se reutiliza la única superficie WebGL de la aplicación; modificar material, clima, texto o canto no vuelve a descargar imágenes.
- Sin autoplay en colección. El clima y las claves usan tiempo absoluto del inspector: pausa y búsqueda son reproducibles. Giro manual y botones siguen disponibles sin animación automática.
- En vista esencial o con movimiento reducido no se abre WebGL. Se mantiene el póster y un reverso legible con sus botones; no se simula movimiento 3D allí.

## Compatibilidad y límites

`portalCard` es una extensión opcional y validada de CardScene 1.0.0 y FrameScene 2.0.0. No exige migración de base de datos. Las escenas GLB anteriores siguen usando su renderizador y conservan sus animaciones; no pueden mezclarse silenciosamente con el nuevo modo de imágenes. Los permisos, rarezas y economía existentes no se modifican.

Las imágenes usan la preparación existente (máximo 1280 px por lado y 400 KB codificados por capa), con alfa conservado. El cargador limita dimensiones y tiempo de espera. Las recetas no aceptan HTML ni shaders ejecutables.

## Verificación

- `npm run check`
- `npm test`: validación, persistencia, herencia, cobertura analítica de fondo, oclusión, recursos, pausas y compatibilidad.
- `npm run build` y `npm run check:bundle`: presupuesto de arranque y motor 3D diferido.
- `npm run test:visual:browser`: Chromium con API local aislada, imágenes de prueba sintéticas, giro por teclado y tacto, reverso, mica/clima, importación/exportación, guardado/recarga, móvil, vista esencial y escenas GLB anteriores. No se conecta a datos de Replit.

Referencias técnicas primarias: [transparencia en Three.js](https://threejs.org/manual/en/transparency.html), [Material y profundidad](https://threejs.org/docs/pages/Material.html), [render targets](https://threejs.org/manual/en/rendertargets.html). La oclusión entre capas usa orden de dibujo explícito, alfa y una abertura geométrica común; no superpone canvases animados.
