# Dirección de tarjetas: herramientas, arquitectura y uso

Decisión de ingeniería · 12 de septiembre de 2026.

## Qué se implementó

Tloque conserva Three.js + React Three Fiber y su única superficie WebGL compartida.
El nuevo **Card Director** se abre desde `/tarjetas` → Nueva tarjeta / Editar →
**Dirigir escena y animación**. No requiere Replit Agent, API generativa, otra cuenta
ni un runtime comercial. El trabajo se distribuye por GitHub.

- Encuadre independiente de fondo, personaje y primer plano: posición XY, escala,
  giro, opacidad y profundidad. Se mantienen los tres nombres aunque falte una capa.
- Pista por capa, hasta 16 claves, duración de 3–12 segundos. Cada clave anima
  desplazamiento, escala, giro y opacidad respecto al encuadre de reposo.
- Cuatro puntos de partida: Composición, Retrato vivo, Revelación y Viaje astral.
  Aplicar una secuencia conserva el arte, los encuadres, el acabado y el marco.
- Foil satinado y prisma iridiscente en el shader de la imagen, limitados a su alfa.
  Reaccionan al ángulo; no cambian la rareza comercial ni dan acceso a marcos comprados.
- Vista previa, reproducción, pausa, búsqueda temporal, deshacer/rehacer (60 estados),
  exportación/importación de recetas JSON y recuperación explícita de borrador local
  por usuario/obra/tarjeta. El borrador guarda la dirección, **no el formulario ni las imágenes**.
- Los marcos obtienen las mismas seis curvas de llegada, más tres secuencias:
  Inspección orbital, Despertar del relicario y Floración ceremonial.

Las colecciones permanecen ligeras: muestran el encuadre DOM sin reproducir la
secuencia. Al inspeccionar se usa el mismo renderer y receta del editor. El modo
esencial conserva imágenes/encuadre/marco pero omite los acabados y movimiento GPU.
Los efectos climáticos clásicos por capa siguen siendo del póster DOM; no son
canales de la nueva secuencia 3D.

## Investigación y selección

| Herramienta | Para qué sirve | Decisión en esta entrega |
| --- | --- | --- |
| Photopea | PSD, capas, máscaras, transformaciones y exportación raster | Flujo documentado y enlace voluntario en el estudio; sin iframe, SDK ni envío automático de archivos. |
| WebP + Canvas del navegador | Preparar imágenes compactas conservando alfa | Integrado en la importación. Se comprueba peso y se informa transparencia y dimensiones. |
| Three.js / R3F | Geometría, materiales, shaders y composición de ventanas 3D | Se extiende el motor ya instalado. No se abre un canvas por tarjeta. |
| Blender → glTF/GLB | Modelos con materiales PBR, huesos, transformaciones y shape keys | Ruta de producción para piezas escultóricas originales. **No hay importación GLB en esta entrega.** |
| glTF Transform | Inspección, deduplicación, poda, simplificación y compresión de activos glTF | Herramienta candidata para la siguiente canalización de modelos; no se instala su CLI en el runtime del lector. |
| Rive | Animación interactiva vectorial y máquinas de estados con runtime JS/WASM | Útil para iconos/mascotas 2D. No se integra ahora: el problema es dirigir las cartas dentro del motor 3D existente. |

Fuentes primarias consultadas:

- [Photopea: capas](https://www.photopea.com/learn/layers) explica composición,
  transparencia, orden y transformaciones independientes.
- [Photopea: animaciones](https://www.photopea.com/learn/animations) describe el flujo
  por fotogramas raster. No equivale a una inspección 3D interactiva.
- [WebP, documentación de Google](https://developers.google.com/speed/webp) documenta
  compresión y alfa; [MDN: toBlob](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob)
  documenta la codificación del navegador y el fallback PNG cuando un tipo no se soporta.
- [Three.js: GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html) documenta
  escenas, clips y decodificadores de compresión.
- [glTF Transform CLI](https://gltf-transform.dev/cli) documenta `inspect`, `optimize`,
  `resample` y compresión de texturas/geometría. Las opciones se deben probar contra el loader real.
- [Rive: runtime web](https://rive.app/docs/runtimes/web/web-js) describe integración,
  renderer, WASM y state machines. No se presupone que instalarlo mejore una escena 3D.

Estas decisiones son una evaluación para Tloque, no una clasificación universal de motores.
Referencia para el futuro pipeline: [manual del exportador glTF de Blender](https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html).
No se recuperó su página completa en esta revisión ni se verificaron exportaciones de Blender.
No se compraron servicios, modelos ni licencias. Usar enlaces externos es opcional;
sus condiciones o prestaciones gratuitas pueden cambiar.

## Preparar una tarjeta desde el móvil

1. En un editor de capas, trabaja sobre un lienzo **5:7**, por ejemplo 900 × 1260.
   Conserva el PSD/original editable fuera de Tloque.
2. Separa **fondo**, **personaje** y **primer plano**. Exporta las tres imágenes con
   iguales dimensiones; personaje y primer plano deben conservar transparencia.
   No recortes cada archivo a los límites del sujeto o perderás su alineación.
3. Rellena detrás del personaje lo que el movimiento pueda revelar. Una imagen
   aplanada no contiene los píxeles ocultos ni se convierte sola en geometría 3D.
4. Sube PNG, JPEG o WebP estático. Tloque acepta entradas de hasta 20 MB / 36 MP,
   prepara inicialmente a 1280 px, ajusta calidad/resolución cuando hace falta y
   exige <=400 000 caracteres de URL de datos por capa, igual que el servidor.
   No convierte WebP transparente a JPEG ni reintenta guardando el original enorme.
5. Abre Card Director. Ajusta el encuadre en Composición; añade margen al fondo.
   La profundidad cambia el paralaje, no el orden de superposición de las capas.
6. Aplica una secuencia y pulsa reproducir. Selecciona una clave o sitúa el cursor
   temporal y marca otra. La curva seleccionada describe la llegada a esa clave.
7. Prueba también en reposo: es la composición visible en colecciones y en modo
   esencial. Pulsa **Usar esta dirección** y después **Crear tarjeta / Guardar cambios**.

Las URLs externas continúan necesitando HTTPS y permisos CORS para funcionar como
texturas. Si falla una textura o la GPU, el visor conserva su alternativa DOM.
Para un resultado reproducible, importa los archivos en lugar de enlaces cambiantes.

## Contrato para herramientas y autores técnicos

La fuente de verdad es `shared/card-scene.ts` (validación) y
`shared/card-scene-runtime.ts` (evaluación sin dependencias GPU).
Se persiste en `card.fx.scene` dentro del JSON existente. No hay migración SQL.

Una receta exportada tiene `{ "type": "tloque-card-direction", "scene": ... }`.
El importador admite hasta 32 KB; no incluye imágenes, shader, código, URLs ni IDs
de marcos. Una IA puede generar esa receta siguiendo el esquema, pero debe
validarla con `cardSceneSchema` antes de proponerla para importar.

`scene` contiene:

- `version: "1.0.0"`, `duration` entre 3 y 12.
- `finish: {type: "none" | "foil" | "prismatic", strength: 0..0.6}`.
- `layers.back`, `layers.mid`, `layers.front`, cada una con `depth: 0..1`,
  `transform: {x, y, scale, rotation, opacity}` y `keys`.
- `x/y`: -0.6..0.6 del ancho/alto; `scale`: 0.5..2; `rotation`: -45..45 grados;
  `opacity`: 0..1. Valores finitos. Los mismos límites rigen cada clave.
- Cada clave añade `time` y `ease`: `smooth`, `cinematic`, `ease-in`, `ease-out`,
  `linear` o `hold`. De 2 a 16 claves estrictamente crecientes, iniciando en 0
  y terminando exactamente en `duration`.

La escala/opacidad de clave multiplican la base; posición/giro se suman. Una clave
neutra es `{x:0,y:0,scale:1,rotation:0,opacity:1}`. Las curvas son monótonas y acotadas,
sin rebote. La evaluación es de tiempo absoluto: buscar no acumula simulación.
Si hay un marco nativo, su coreografía se normaliza a la duración de la tarjeta,
sin modificar el paquete de la galería ni el derecho de uso del marco.

## Presupuesto, validación y límites honestos

Los cambios de encuadre, profundidad, acabado y claves actualizan la escena sin
recrear recursos GPU. Solo cambiar fuentes de imagen o topología reconstruye.
Las imágenes se cargan en las vistas visibles del compositor compartido, con el
presupuesto de texturas y píxeles ya establecido. Los shaders de acabado no añaden
pasadas de postprocesado. No hay import estático de Three.js en el shell inicial.

Pruebas: `npm run check`, `npm test`, `npm run build`, `npm run check:bundle`,
`npm run test:visual:browser`. Las pruebas de navegador usan la app real, WebGL
software y una API local con los validadores reales, sin base de datos productiva.
La CI también verifica el arranque/migraciones sobre PostgreSQL efímero.
Esto **no certifica FPS, consumo térmico o batería en un Poco físico**.

El siguiente salto para acercarse a objetos de videojuego de alto presupuesto
es producir arte original y modelos con animación esquelética/morphs, no instalar
otro motor. Antes de aceptar GLB de usuarios hacen falta almacenamiento de activos
inmutables, licencias, límites de triángulos/draw calls/texturas/clips, validación de
archivos autocontenidos y carga bajo demanda. No se añaden importadores de modelos
arbitrarios ni URLs de shaders a las recetas JSON como atajo.
