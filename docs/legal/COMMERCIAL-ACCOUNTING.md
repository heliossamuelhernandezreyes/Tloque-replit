# Acuerdo de edición y cálculo económico

Implementación 2026-11-01.1. El texto operativo se genera en
`shared/commerce.ts`; el servidor lo identifica por SHA-256. Este documento
explica el circuito, no acredita revisión jurídica/fiscal, identidad del
operador ni firma de contratos externos.

## Aceptación del titular y revisión

1. El titular publica con los permisos individuales necesarios.
2. En **Mis comprobantes → Permisos de publicación → Revisar acuerdo comercial**
   consulta el texto completo de su edición. Incluye operador/contacto, obra,
   huella, territorio, modalidades, reparto, bonos, costes, fiscalidad, retiros,
   devoluciones y conservación de entregas. Acepta con una casilla inicialmente
   desmarcada. El registro guarda texto íntegro, huella, cuenta y fecha.
3. Un administrador con `manageRights` consulta esa aceptación y registra las
   referencias reales al acuerdo efectivo y las facultades revisadas.
4. Solo esa combinación habilita compras nuevas de esa edición, junto con los
   controles generales de comercio. No basta una referencia escrita por el
   administrador. Un cambio de texto económico, operador, edición o plazos
   exige aceptación y revisión nuevas; los comprobantes anteriores se conservan.

Las aprobaciones históricas no se rellenan con consentimientos inventados. Las
entregas y derechos adquiridos no se eliminan por esta migración; las compras
nuevas necesitan el nuevo circuito.

## Base de reparto: efectivo primero

Se conserva la política económica existente, ahora expresa en el acuerdo y en
cada desglose. Una Tinta tiene valor de uso nominal de 200 centavos MXN, pero
ese valor no prueba que hayan ingresado 200 centavos por ella.

Para gastar `u` Tintas, con respaldo disponible `R`:

`base = min(max(R, 0), u × 200)`

Se resta esa base del respaldo y las unidades del saldo. Se consume el respaldo
primero y los bonos sin respaldo al final; no se asigna un coste medio por lote.
La mezcla de recargas, créditos y devoluciones puede cambiar la base de una
operación. El servidor muestra el resultado antes del débito.

Ejemplo verificable: 55 Tintas compradas por 9,900 centavos. Once compras de
5 Tintas atribuyen bases `[1000,1000,1000,1000,1000,1000,1000,1000,1000,900,0]`.
La suma es 9,900, nunca 11,000. El último gasto entrega su licencia, pero no
devenga ingreso liquidable. El titular debe haber aceptado expresamente esta
regla. La beta tampoco inventa efectivo.

Libros/sagas: 9,000 puntos básicos para el titular. Cuentos: 5,000.
Se redondea su parte al centavo más cercano y la parte de Tloque es la diferencia
exacta. Por ejemplo, sobre 730 centavos de base de un libro: 657 titular y 73
Tloque. Sobre 1,001: 901 y 100. La categoría, no los capítulos, determina el
porcentaje. La tarjeta usa el total confirmado de la compra como base.

## Desglose y pago

`GET /api/tokens/quote` devuelve medio, coste, base, partes, acuerdo y huella.
La confirmación del comprador vincula la huella de condiciones y la del cálculo.
Dentro del candado transaccional del monedero se recalcula el desglose: si cambió,
se devuelve `ECONOMIC_QUOTE_CHANGED` antes de crear la orden o debitar saldo.
El reintento de una orden ya existente conserva su primera aceptación.

`token_orders.purchase_terms` guarda el acuerdo y cálculo íntegros. La entrega
comprueba que el devengo coincida con la base y porcentaje aceptados; el webhook
no recalcula usando otra versión de la obra o del acuerdo.

## Costes y fiscalidad

El circuito actual no deduce del titular otra comisión de procesamiento ni
gastos operativos; estos se cubren con la participación de Tloque. La base es
el total efectivo atribuido, sin inventar deducciones fiscales. No implementa
facturación ni retenciones y no afirma que exista una exención. La revisión
fiscal/comercial real debe determinar la compatibilidad antes del primer cargo.
Si exige deducciones, retenciones u otra base no implementada, deben añadirse
antes de habilitar comercio y obtener una nueva aceptación. No usar referencias
de prueba para declarar esta revisión hecha.

La participación de Tloque es ingreso bruto, no utilidad garantizada. Antes de
operar debe contrastarse con las comisiones efectivas del proveedor y las
obligaciones fiscales; este módulo no calcula una rentabilidad ni subsidios.

## Conciliación y liquidaciones

Cada compra nueva fija espera y mínimo efectivos. Las liquidaciones aplican su
espera por operación. Si conviven mínimos diferentes, se permite el menor entre
los aplicables a los ingresos disponibles y el vigente; nunca se eleva el umbral
ya aceptado para impedir cobrar esos ingresos. Las órdenes históricas sin esta
instantánea conservan el tratamiento anterior y se identifican como tales.

El estado de cuenta privado muestra orden, base, partes, estado, acuerdo, fecha
de disponibilidad y mínimo. Se pagina por identificador; cada descarga JSON
indica la página que contiene. Las devoluciones de Tinta restauran las unidades
y el respaldo exactos del débito. Los reintegros/disputas del procesador usan la
conciliación previa: incidencias parciales, dinero reservado o ya transferido
requieren revisión y no se convierten por sí solos en deuda indiscutible.

El saldo inferior al mínimo no caduca ni se extingue al retirar una obra. La
liquidación final de saldos menores al mínimo al terminar la relación necesita
tramitación humana: no hay un botón que los transfiera automáticamente. La
fecha de disponibilidad no garantiza la llegada bancaria. Un resultado incierto
del procesador conserva la reserva y su clave idempotente.

## Migración y prueba

Aplicar `0027_commercial_agreements.sql` junto con el código, después de respaldo
y preflight. Añade evidencias inmutables y un vínculo en las aprobaciones. No
modifica comprobantes ni importes históricos. El migrador ensaya instalaciones
vacías y provenientes de `db:push`.

Pruebas: `tests/commerce.test.ts`, ampliación de la prueba HTTP de derechos,
flujo PostgreSQL de pagos y prueba móvil de acuerdo/desglose. No hacen cobros ni
aceptaciones reales. Las referencias legales primarias revisadas fueron
[LFDA, arts. 30–31](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFDA.pdf) y
[LFPC, arts. 7 Bis y 76 Bis](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPC.pdf):
fundamentan revisar el permiso/remuneración y la información previa del precio,
sin certificar que esta implementación resuelva por sí sola todo requisito.
