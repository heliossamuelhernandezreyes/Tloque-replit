# Correcciones de interfaz del 3 de noviembre de 2026

Referencia: auditoría sobre `fe9f007`, hallazgos U01–U16. Esta entrega conserva los precios y derechos aprobados, la lectura gratuita y la identidad visual. No activa servicios de pago ni realiza despliegues.

| Hallazgo | Corrección |
|---|---|
| U01 | Copia local al abandonar rutas y al cerrar; cola local independiente de la red; salida explícita espera la recuperación local. |
| U02 | Destino interno validado en OAuth. Clave de ejemplar temporal en la pestaña, con caducidad y consumo tras montar el canje; no se envía al proveedor. |
| U03 | Confirmación antes de borrar; respuesta del servidor antes de retirar la obra; error visible y caché actualizada. |
| U04 | Monedero acotado al viewport, con cabecera y cuerpo desplazable. Información de Papel desplegable. |
| U05 | Tipografía de ayuda ampliada y colores de texto más legibles en las superficies de producto. No se afirma certificación WCAG de toda la app. |
| U06 | Estado de la orden consultado en un endpoint autenticado y privado. El mensaje de confirmación requiere una entrega pagada real. |
| U07 | Búsqueda suscrita al query string y compatible con navegación de historial. |
| U08 | Evento de scroll declarativo, también al llegar el libro de forma asíncrona. |
| U09 | Progreso según capítulos reales; estado desconocido sin porcentaje inventado. |
| U10 | Errores y reintentos en saldos, notificaciones, ejemplares, biblioteca y canje. |
| U11 | Buscar y Ajustes visibles; botón Aa y nombres accesibles en el lector; menú visible de obras propias. |
| U12 | Diálogo compartido con foco inicial, Escape, confinamiento del foco, scroll y retorno al origen. |
| U13 | Biblioteca utiliza nombre, avatar y banner de la cuenta; edición centralizada en Perfil. |
| U14 | Estados persistentes de dispositivo/nube, error y reintento. |
| U15 | Pausa de destacados, pausa al interactuar y respeto del movimiento reducido. |
| U16 | Ofertas y paquetes compartidos con las pruebas visuales; monedero comprobado a dos tamaños y con texto ampliado. |

La entrega añade pruebas de destinos OAuth, progreso y confirmación de pago; escenarios de navegador para salida del editor, QR, búsqueda, errores, lectura en frío y estado del checkout; y comprobaciones de aislamiento de órdenes entre cuentas. Las capturas se generan con datos de prueba aislados.

La impresión física, TalkBack en un teléfono real, pruebas con personas y la medición sostenida de temperatura/FPS siguen siendo validaciones en dispositivo. No se presentan como realizadas por las pruebas automáticas.
