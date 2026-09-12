# Estudio de marcos / escenas v2

## Uso

El administrador abre `/admin/marcos`. La vista principal ahora es el editor nativo 3D;
el HTML anterior continúa en **Abrir taller clásico**, con su puente de origen y token intactos.

1. Elegir Atlas astral, Relicario solar o Flor nocturna.
2. Ajustar materia, iluminación, geometría y mundo interior. Carta/Perfil cambia la
   vista de trabajo; **Disponible para** determina dónde se podrá equipar.
3. Reproducir la inspección o seleccionar una clave en las seis pistas. El deslizador
   de la pista modifica o crea una clave en el tiempo seleccionado. Máximo 16 por pista.
4. **Guardar versión** crea un marco nuevo en la galería. Nunca sustituye un marco
   comprado o equipado. Abrir una versión guardada también crea una copia editable.
5. En `/marcos`, **Explorar marco** reproduce el mismo documento. Al equiparlo en una
   carta, su visor incorpora las capas de imagen existentes al mundo del portal.

El borrador se conserva por cuenta en ese navegador. Deshacer/rehacer conserva hasta
60 estados. Exportar/importar JSON conserva el documento y su coreografía; el precio
se reinicia a cero al importar para no publicar accidentalmente una tarifa antigua.
Guardar requiere una sesión de administrador y usa el endpoint existente.

## Compatibilidad y límites reales

- Los marcos clásicos no se convierten solos. Su representación completa original sigue
  disponible. Convertir una copia recupera material y proporciones, **no** traduce figuras
  libres, ornamentos pintados ni efectos Canvas a modelos 3D equivalentes.
- Galerías y avatares usan un póster SVG ligero derivado del documento. La escena completa
  se reserva al editor y al visor enfocado. No se enciende un WebGL por cada miniatura.
- Las tres bases son geometría procedural original. Esto no es aún un editor libre de
  modelos GLB, un importador de Blender, ni una producción cinematográfica de nivel AAA.
- El paralaje de fotografías requiere capas separadas; una imagen aplanada no contiene
  la geometría de los objetos que muestra. El escenario del portal sí tiene profundidad.
- La singularidad usa un shader de lente y disco turbulento estilizado, no una simulación
  relativista. Ajustes visuales → **Explorar el orbe** permite verlo a mayor tamaño.
- Se mantienen los límites de vistas, píxeles y texturas. El modo esencial, movimiento
  reducido y fallo de GPU conservan una presentación sin animación WebGL. Las inspecciones
  no se reproducen automáticamente y se pausan al ocultar la pestaña. Sin audio automático.
- El carrusel de libros ahora usa inercia libre sin ajuste obligatorio al soltar; la escala,
  altura y giro de las portadas permanecen estables. Las flechas siguen avanzando por libro.

## Contrato compartido

`shared/frame-scene.ts` define `2.0.0`: estilo, geometría, material, luces, portal y
seis pistas (órbita, inclinación, zoom, despliegue, apertura, energía). El servidor valida
rangos, colores, claves ordenadas y duración 3–12 s, y vuelve a generar el paquete canónico.
No admite scripts, shaders externos, URLs de modelos ni geometría de complejidad arbitraria.

El director evalúa tiempo absoluto con interpolación lineal o suave sin sobreimpulso.
Materiales, iluminación y playhead se actualizan sobre la escena viva. Sólo topología,
asignación del portal e imágenes invalidan la caché GPU. El portal se renderiza en una
textura que sólo se dibuja en su abertura; se respetan los límites del panel desplazable.

No cambia el esquema de base de datos: se reutiliza `frames.pkg`. No se añaden APIs de pago,
modelos remotos, librerías de render ni bancos musicales a la aplicación.

## Verificación

```sh
npm ci
npm run check
npm test
npm run build
npm run check:bundle
```

QA opcional en navegador, aislada del servidor y de toda base real:

```sh
npm install --no-save --package-lock=false --ignore-scripts playwright@1.62.1
npx playwright install chromium
npm run test:visual:browser
```

Las capturas quedan en `.tloque_cache/visual-qa/`. CI ejecuta esta misma comprobación y las
conserva siete días. Una ejecución con GPU de software verifica shaders e interacción,
pero **no certifica FPS, batería o temperatura en un teléfono**. Esa medición final debe
hacerse en dispositivos reales antes de prometer 60 FPS sostenidos.

El trabajo se realiza en GitHub; no requiere ejecutar Replit Agent. No hay migración nueva
para estas escenas. Tras integrar, actualizar la copia de trabajo conservando commits locales,
instalar dependencias y arrancar normalmente (`npm run replit` en ese entorno).
