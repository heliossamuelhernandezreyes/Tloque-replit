# Mecenazgo, Tinta y licencia comercial

Política propuesta en código: 2026-11-03.1. Requiere aceptación del titular y revisión real por edición antes de operar; este documento no sustituye esa revisión ni un contrato firmado. No se han habilitado cobros ni aplicado migraciones a producción.

## Prestaciones

La lectura pública es gratuita. El mecenazgo concede una edición digital permanente dentro de la app, descarga autorizada y tres folios para tres ejemplares físicos totales. Cada ejemplar puede conservarse o regalarse gratuitamente a compañeros solo con la nueva autorización expresa `personalGifts`. No se entrega al destinatario un nuevo archivo ni un canje digital. Los folios no se reponen por regalar. Se mantiene el límite existente de tres: reducirlo a uno requeriría decidir una oferta futura, sin afectar adquisiciones anteriores. El mecenazgo actual se concede una vez por lector y obra; no es una suscripción mensual ni un ingreso recurrente garantizado.

La licencia comercial se adquiere de manera independiente. Cada compra autoriza fabricar **un ejemplar físico nuevo** y realizar su primera distribución comercial de esa edición, en México. Cada nuevo ejemplar adicional requiere otra licencia. La primera cuenta legítima conserva su único canje digital; vender, regalar o devolver el libro físico no lo reinicia. La reventa del mismo soporte es distinta de una nueva reproducción. El vendedor debe declarar el estado del canje y entregar una clave sin usar cuando así lo ofrezca. No se ceden derechos de autor, exclusividad, obras futuras ni entrenamiento de IA.

Las nuevas recompensas de mecenazgo con Tinta incluyen las tarjetas que el autor haya configurado como recompensas y autorizado para esa obra, sin inventar una cantidad fija. El nuevo pago directo no incluye esa recompensa; no se retiran tarjetas ni derechos históricos. Una tarjeta ya adquirida se conserva con las protecciones existentes.

## Propuesta de precios y regalías

Precios en MXN. Los importes no cerrados en la conversación son **valores propuestos configurables**, no precios ya publicados. Cambiar la configuración cambia el acuerdo que debe volver a aceptar el autor antes de nuevas compras.

| Oferta | Tinta visible | Base editorial | Regalía con Tinta nueva | Pago directo propuesto | Regalía directa |
|---|---:|---:|---:|---:|---:|
| Mecenazgo de libro | 200 | $20 | $18 (90% de la base) | $35 | $17.50 (50%) |
| Mecenazgo de cuento | 100 | $10 | $5 (50% de la base) | $20 | $6 (30%) |
| Licencia comercial por ejemplar, cualquier categoría | 240 | $24 | $18 (75% de su base propia) | $24 | $18 (75%) |

Variables: `PATRONAGE_BOOK_MXN_CENTS`, `PATRONAGE_STORY_MXN_CENTS`, `COMMERCIAL_LICENSE_MXN_CENTS`. Admiten enteros entre 2000 y 1000000 centavos; valores inválidos cierran la operación. No modifican operaciones anteriores. Las bases editoriales con Tinta y el porcentaje comercial se versionan en código/acuerdo; no se hereda automáticamente el reparto del mecenazgo.

| Paquete propuesto | Tintas visibles | Precio | MXN/Tinta | Apoyos de libro cubiertos |
|---|---:|---:|---:|---:|
| Gota | 200 | $30 | $0.1500 | 1 |
| Tintero | 400 | $55 | $0.1375 | 2 |
| Biblioteca | 1,000 | $120 | $0.1200 | 5 |
| Archivo | 2,000 | $200 | $0.1000 | 10 |

No hay Tinta de regalo ni bonos en estos paquetes pagados. El modo de prueba gratuito requiere una variable explícita y está deshabilitado en producción aunque esa variable esté encendida.

## Efectivo, base de regalía y margen

Se atribuye a cada gasto la proporción del efectivo que respalda el saldo pagado nuevo. La participación del autor usa la base editorial de la prestación, no el precio variable de la recarga. El sobreprecio del paquete corresponde a Tloque y se muestra en el desglose. No se afirma que el autor reciba el 90% de toda recarga.

- 200 Tintas por $30, gastadas en un libro: efectivo atribuido $30, base editorial $20, autor $18, Tloque $12 antes de gastos.
- 2,000 Tintas por $200, gastadas en diez libros: efectivo atribuido $200, autores $180, Tloque $20 antes de gastos. El primer libro no consume el respaldo de los diez.
- Un monedero mezcla paquetes pagados mediante proporción del saldo monetario restante. El último gasto consume el remanente exacto de centavos; no se dejan pesos varados con cero unidades. El orden puede distribuir el sobreprecio de manera diferente entre obras, sin cambiar la regalía fija de un apoyo con Tinta nueva totalmente respaldado.
- Los saldos sin gastar siguen siendo una obligación; no se contabilizan como beneficio ni se presume caducidad.

Sensibilidad, **no beneficio neto**: con tarjeta nacional Stripe 3.6% + $3, agregando 16% de IVA sobre esa comisión y sin aplicar acreditamiento fiscal, el paquete Archivo cuesta $11.832 de procesamiento. Quedan $8.168 por diez apoyos después de pagar $180 a autores, equivalentes a $0.8168 por libro. Faltan Connect, liquidación, impuestos propios, incidencias y operación real. IA y voz corresponden a Papel y no se cargan a Tinta. No se inventa un gasto fijo por libro ni se divide el costo mensual de Connect como si cada venta fuera una cuenta nueva.

| Operación aislada de referencia | Tloque antes de cobro | Tloque tras comisión de cobro de referencia |
|---|---:|---:|
| Libro con paquete Gota completo | $12 | $7.2672 |
| Libro con paquete Archivo (una décima parte) | $2 | $0.8168 |
| Libro directo a $35 | $17.50 | $12.5584 |
| Licencia comercial directa a $24 | $6 | $1.51776 |
| Licencia comercial con Archivo (fracción consumida) | $6 | $4.58016 |

Estos cálculos no aseguran rentabilidad neta ni demanda. Para el impresor: `margen = precio físico − fabricación − licencia − otros gastos que asuma`. Ejemplo hipotético: venta $180, fabricación $100 y licencia $24 dejan $56 antes de envío, cobro e impuestos del vendedor. Tloque no recibe los $180; recibe la licencia. Un precio físico real requiere revisar el precio público aplicable.

## Compatibilidad y trazabilidad

La unidad interna histórica permanece sin cambios. La interfaz muestra veinte Tintas por unidad interna: los antiguos 10 equivalen a 200 visibles. No se reescriben ledger, saldo, compras, respaldo ni recibos. Las APIs mantienen unidades internas e informan `tintaDisplayScale: 20`; los nuevos comprobantes económicos incluyen `displayScale: 20`. Los recibos históricos se muestran con su propia escala original, no multiplicando retroactivamente su texto.

`wallet_orders.funding_policy = paid-proportional-v2` identifica recargas nuevas pagadas. Sus créditos y sus ajustes registran el desglose exacto `funding` en `wallet_ledger`. Los movimientos históricos sin desglose pertenecen al fondo histórico. Se gasta primero Tinta nueva pagada; después Tinta histórica. El fondo histórico mantiene efectivo primero a $2 por unidad interna, sin tomar respaldo de recargas nuevas. Un bono histórico sin respaldo puede seguir entregando el beneficio autorizado, pero no genera regalía liquidable: se informa expresamente en la cotización. Esto no crea bonos nuevos. Un saldo nuevo insuficientemente respaldado requiere conciliación antes de prometer su regalía.

Un gasto mixto conserva sus dos fuentes. Un reembolso restaura exactamente unidades y efectivo de cada fuente, con una sola referencia idempotente. Un contracargo de recarga se carga al fondo de esa recarga, mantiene las retenciones y no fabrica efectivo. La nueva columna cumple una restricción de conservación de cantidades y centavos. La migración no reclasifica automáticamente datos históricos.

Los nuevos acuerdos y cotizaciones incluyen versión, edición, aceptación del titular, precio, base, fuentes, centavos de autor/Tloque y plazos. Una nueva autorización sobre el mismo manuscrito crea otro registro inmutable de edición/licencia; no modifica el anterior. Los pagos pendientes históricos continúan usando su acuerdo y cálculo originales. Reintentar conserva la misma operación y la misma petición al procesador.

## Revisión legal y operación física en México

La autorización de reproducción y primera distribución debe constar por escrito con remuneración pactada y alcance específico. Los tres regalos no se justifican como una excepción general de copia privada: se obtienen de la autorización expresa del titular. Antes de vender la edición deben documentarse las facultades sobre todos sus recursos, papel real de editor, impresor, formato/tirada, datos editoriales y de impresión, ISBN cuando proceda, precio público/registro/excepciones aplicables y depósito legal. El contrato y los controles internos no sustituyen esas actuaciones.

La app no es todavía un mercado que cobre y envíe el libro físico. El fabricante/vendedor asume ese cumplimiento operativo y sus costos; el expediente de revisión debe determinar las obligaciones que correspondan realmente a Tloque como operador/editor. No basta con atribuirle un nombre distinto para evitar obligaciones. Los impuestos, facturación y retenciones que resulten exigibles deben resolverse antes de habilitar cobros; no se presume exención por llamar a la operación mecenazgo.

Fuentes primarias consultadas el 3 de noviembre de 2026:

- [LFDA, texto vigente con reforma de 14/05/2026](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFDA.pdf): arts. 27–31, 42, 47, 53–54 y 148.
- [Ley de Fomento para la Lectura y el Libro](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFLL.pdf): arts. 22–26, precio público y excepciones.
- [Ley Federal de Protección al Consumidor](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPC.pdf): información, precio total y contratación a distancia.
- [Ley General de Bibliotecas](https://www.diputados.gob.mx/LeyesBiblio/pdf/LGB.pdf): depósito legal, arts. 33–39.
- [Stripe México: precios](https://stripe.com/mx/pricing) y [Connect](https://stripe.com/mx/connect/pricing). Las comisiones se usan para el simulacro, no se descuentan de la regalía prometida al autor.
