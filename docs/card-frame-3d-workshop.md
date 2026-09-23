# Tarjetas y marcos: un solo motor 3D

El taller antiguo en `taller-marcos.html` y las partículas Canvas2D de tarjetas se retiran. Las tarjetas de colección usan una presentación estática: tocar una abre el visor 3D compartido. Los marcos antiguos mantienen su paquete guardado y se pueden abrir como una copia convertida. El compositor WebGL existente sigue siendo único; no se crea un canvas por tarjeta.

## Para crear

1. Abre **Tarjetas**, crea una tarjeta y toca **Dirigir escena y animación**.
2. En **Objetos y efectos**, elige Cristal flotante, Corona o Portal. También puedes añadir formas, moverlas, cambiar su material, duplicarlas y combinarlas.
3. **Importar modelo o animación** acepta un GLB con la escena y sus animaciones integradas. Elige la pista, su velocidad y si se repite; reproduce, pausa o desplaza el tiempo del visor.
4. Activa **Poner vidrio** y elige lluvia, llamas, nieve, brasas, niebla o destellos. Ajusta intensidad, velocidad y color.
5. Pulsa **Usar esta dirección** y después **Crear tarjeta** o **Guardar cambios**. Una tarjeta con objetos 3D no necesita fondo de imagen.

El taller de marcos tiene los mismos controles, bajo **Objetos y efectos**, para usuarios con `manageFrames`. **Colocación 3D** permite situar cada objeto en el interior o sobre el marco. **Exportar objetos** produce una receta JSON reutilizable en ambos talleres, con referencias a los GLB persistidos en esta instalación. No exporta un archivo de geometría para Blender.

## Importación

- GLB 2.0, hasta 20 MB; hasta 80 000 triángulos, 64 primitivas dibujables y 256 nodos.
- Conserva la escena activa, materiales PBR, transparencias, esqueletos y morph targets. Admite hasta 24 clips de 120 segundos cada uno. El editor amplía su duración al importar; ralentizar puede extender la inspección hasta 1200 s.
- Texturas PNG/JPEG integradas, máximo 2048 px por lado y 8 megapíxeles totales por archivo. Hasta dos GLB y 16 piezas por escena.
- No admite FBX, OBJ, archivos glTF con recursos externos, Draco/Meshopt/KTX2 ni accesores sparse. Exporta GLB sin esas compresiones. La interfaz explica estos límites y muestra errores sin guardar referencias temporales.
- Las imágenes de fondo y capas conservan su flujo de importación previo. Sus preparaciones fuera de pantalla siguen usando el API de imagen del navegador; se ha retirado el renderer Canvas2D animado, no el canvas WebGL que necesita Three.js.

## Persistencia y permisos

`POST /api/visual/models` requiere sesión, tiene límite de solicitudes y valida bytes, referencias, jerarquía, geometría, texturas y animaciones antes de guardar. Un nombre SHA-256 identifica el archivo inmutable en App Storage (`visual/models/`). Se reutiliza el bucket configurado para audio o el predeterminado; `TLOQUE_VISUAL_BUCKET_ID` permite separar los modelos. No hay migración de base de datos ni dependencia nueva. El bucket debe estar conectado en el entorno que ejecute la app.

La lectura pública de los GLB sigue el modelo de acceso del arte de las tarjetas. Elegir un marco de catálogo mantiene los controles de propiedad existentes; una receta no concede marcos ni rarezas. Guardar una tarjeta sigue requiriendo ser su autor y publicar marcos sigue requiriendo `manageFrames`.

El renderer valida otra vez el GLB, bloquea recursos externos, cancela cargas al cerrar y libera materiales, texturas, esqueletos y geometría. Editar posiciones, materiales o efectos no descarga otra vez el modelo. La animación usa tiempo absoluto para evitar deriva al pausar o retroceder. Las preferencias de movimiento reducido y calidad esencial conservan una vista estática.

## Verificación

`tests/scene-content.test.ts` y `tests/visual-uploads.test.ts` comprueban límites, persistencia exacta, autenticación, recetas, compatibilidad, duración y vida de los recursos. La escena sintética `tests/fixtures/animated-model.ts` incluye esqueleto, morph target y clips de 18 y 6 segundos.

`npm run test:visual:browser` prueba la interfaz con un API aislado: creación sin fondo, importación GLB, reproducción, pausa, búsqueda temporal, vidrio, fuego/lluvia, exportación de objetos, reutilización en un marco, guardado, reapertura y móvil. No conecta con la aplicación desplegada.

Referencias del renderer: [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html), [AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html).
