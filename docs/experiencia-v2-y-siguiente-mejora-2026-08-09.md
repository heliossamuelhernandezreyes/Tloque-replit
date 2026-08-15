# Tloque · Experiencia v2 y siguiente mejora

Fecha: 2026-08-09

## Qué cambia en esta entrega

- Navegación persistente y accesible para biblioteca, estudio, buzón, perfil y administración.
- Perfil propio desde el primer día: un lector puede construir su identidad antes de publicar. La categoría autor aparece al tener obras y administrador solo proviene del servidor.
- Administración fuera de los ajustes del lector. Gutenberg, fonoteca, marcos, diagnóstico y gestión de administradores viven en `/admin` y las rutas conservan autorización de servidor.
- Editor dividido en tres modos: escritura, música y voz. Música y voz ya no compiten visualmente con el manuscrito. Incluye enfoque, lista de publicación, guardado con `Ctrl/Cmd+S`, autor derivado de sesión y confirmación al eliminar contenido.
- Orbes con el mismo lenguaje visual, pero con presupuesto de movimiento: se detienen al ocultar la pestaña, respetan reducción de movimiento y reservan promoción de compositor para una transición activa.
- Fondo cósmico detenido cuando la página no es visible y desactivado como bucle cuando se reduce movimiento.
- Buzón transaccional para avisos verificables; por ahora notifica reclamos de ejemplares.
- Galería/tabla de ejemplares con permiso de venta. Venta física y reclamo digital se representan como hechos distintos. Los cambios dejan bitácora.
- Copia nueva completa para nueve idiomas con una prueba automática de paridad de claves.

## Decisiones de seguridad y producto

1. **No abrir mensajes directos todavía.** Antes deben existir bloqueo, silencio, reporte, límites anti-spam, cola de moderación y reglas para menores. El buzón transaccional sí puede operar porque el cliente no crea mensajes arbitrarios.
2. **No usar el cliente como autoridad de rol.** La interfaz oculta superficies que no corresponden, pero cada endpoint administrativo sigue protegido en servidor.
3. **No equiparar venta con reclamo.** Una persona puede vender el impreso antes o después de que el comprador reclame su acceso digital. Mezclar esos estados generaría contabilidad falsa.
4. **No animar por decorar.** La luz y el movimiento conservan identidad; el movimiento permanente se pausa cuando no puede aportar percepción ni respuesta.

## Riesgos que aún bloquean un lanzamiento amplio

Prioridad crítica:

- Migrar las claves de reclamo históricas a hash con versión y rotación; todavía existen filas antiguas en texto recuperable.
- Sustituir el limitador en memoria por Redis u otro almacén compartido antes de escalar a varias instancias.
- Implementar eliminación de cuenta con periodo de recuperación, revocación de sesiones y política para obras, compras y bitácoras fiscales.
- Validar migraciones en una copia de la base de producción y documentar rollback antes de publicar.

Prioridad alta:

- Mensajería con controles de abuso completos y configuración de quién puede contactar a quién.
- Paginación por cursor para catálogo, buzón, comentarios y ejemplares; no enviar colecciones completas al móvil.
- Almacenamiento de imágenes y audio con cargas reanudables, análisis de tipo real, límites por cuenta y CDN.
- Eventos de producto con privacidad: activación del editor, finalización de capítulos, latencia de audio, errores y abandono; sin registrar texto privado.
- Revisión lingüística humana de los nueve idiomas. La prueba garantiza completitud estructural, no calidad editorial nativa.
- Pruebas E2E de permisos lector/autor/admin y de reclamación/venta concurrente.

## Criterios medibles para la siguiente fase

- INP p75 móvil menor de 200 ms en biblioteca y lector.
- Cero bucles de animación activos con pestaña oculta o reducción de movimiento.
- Objetivos principales de interacción de 44 × 44 CSS px; mínimo absoluto WCAG 2.2 AA de 24 × 24 px.
- Guardado del editor visible y recuperable; ningún cierre pierde más de dos segundos de escritura local.
- Ningún endpoint de administración accesible con sesión de lector.
- 100 % de claves de interfaz presentes en los nueve idiomas; revisión humana por idioma antes de declararlo verificado.

## Referencias de implementación

- WCAG 2.2, tamaño de objetivo mínimo: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum
- WCAG, reducción de movimiento: https://www.w3.org/WAI/WCAG22/Techniques/css/C39
- W3C, indicador de foco: https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html
- Web.dev, animaciones de alto rendimiento: https://web.dev/articles/animations-guide
- MDN, Page Visibility API: https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
