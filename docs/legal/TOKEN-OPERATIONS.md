# Tokens y reclamaciones autorales

La versión 2026-10-31.1 separa publicación gratuita, monetización y conservación
de la edición adquirida. Ningún indicador de configuración, aceptación o revisión
administrativa acredita por sí solo titularidad, una autorización de autoridad o
inmunidad frente a demandas.

## Compras nuevas

- Token 1: una edición digital personal, sin suscripción, y tres folios para
  impresiones personales. Los folios nuevos no conceden accesos digitales extra.
- Comercial: un ejemplar nuevo y su primera distribución comercial, con un canje
  digital definitivo a la primera cuenta. Una devolución o reventa no lo renueva.
- El comprador necesita un Token 1 activo de la obra antes del comercial. El
  autor titular de la obra puede comprar permisos comerciales sin autoapoyarse.
- Antes del débito o checkout se comprueban permisos expresos de monetización,
  permanencia, offline y modalidad de impresión, además del acuerdo comercial
  revisado para la aceptación exacta. Las habilitaciones generales siguen siendo
  necesarias; esta entrega no las configura con datos ficticios.
- El comprador acepta el texto vigente. La orden conserva el documento íntegro,
  precio, versión, huella y edición. Un reintento reutiliza la operación original.
- `licensed_editions` conserva una instantánea inmutable antes del checkout.
  El webhook entrega esa edición y no recalcula el texto con el manuscrito actual.
  Una retención por derechos antes del pago exige devolución en lugar de entrega.
- Lectura, offline y preparación de impresión utilizan la edición adquirida.
  El retiro ordinario del catálogo no la sustituye por un borrador posterior.

En `/admin/derechos`, una cuenta con `manageRights` registra referencias al acuerdo
real y a las facultades revisadas. No deben introducirse nombres de ejemplo para
abrir ventas. La verificación documental y la contratación son actuaciones humanas.
`/legal/receipts` permite descargar comprobantes de publicación y compra propios.

## Historial

Las migraciones 0025 y 0026 son incrementales. No inventan autorizaciones ni
instantáneas de compras antiguas. Los folios históricos conservan sus beneficios;
los canjes ya vinculados no se reasignan. El tratamiento compatible de compras
sin instantánea conserva el mecanismo anterior, que necesita revisión del
historial real antes de un lanzamiento comercial. No garantiza reconstruir una
edición antigua que nunca se guardó. Si la obra ya no está publicada, la impresión
histórica solo usa la última revisión pública registrada; sin ese historial no
se entrega un borrador privado como sustituto.

La base impide cambiar la primera cuenta vinculada y la identidad del ejemplar.
La recuperación de la misma cuenta es distinta de una transferencia. Una sospecha
de fraude requiere investigación y un remedio lícito; no hay un botón público para
reasignar canjes ni para acusar de piratería al comprador de un libro usado.
Los PDF exportados y archivos offline ya entregados no se pueden retirar de forma
infalible. El folio es trazabilidad, no un registro oficial ni DRM invulnerable.

## Avisos y contraavisos

1. `/rights` admite avisos sin cuenta y entrega un folio. La recepción no decide
   el fondo ni bloquea automáticamente la obra. Debe existir un responsable que
   revise y actúe de forma expedita.
2. El administrador registra motivo y alcance de una retirada. `rights_hold`
   bloquea acceso público, nuevas compras, descargas y preparación de impresión,
   también de ediciones adquiridas. Cambiar el estado de publicación no elimina
   esta retención. El autor conserva acceso a su manuscrito para su defensa.
   Una publicación nueva con el mismo texto y capítulos exactos se detiene para
   revisión, incluso con otro ID o título. No se promete detectar toda variante
   ni resolver automáticamente coincidencias legítimas.
3. El autor vinculado al expediente presenta contraaviso con evidencia. Otros
   usuarios no pueden consultar el expediente ni responder como él.
4. La entrega efectiva al reclamante es manual, por el canal aplicable. El panel
   registra constancia, fecha y vencimiento revisado con el calendario aplicable.
   No envía correos ni finge que el aviso ya fue entregado. El plazo no empieza
   con la mera recepción del contraaviso en Tloque.
5. La fecha debe superar un mínimo de 15 días de lunes a viernes; el responsable
   debe ampliarla por festivos y suspensiones aplicables. No es un calendario
   procesal completo. La restauración requiere actuación administrativa, plazo
   vencido sin procedimiento registrado, o resolución/retirada documentada.
6. Otro expediente activo impide retirar la retención. Si cambia el contenido,
   se exige revisar la versión antes de restaurar. Las actuaciones tienen bitácora
   protegida frente al CRUD normal.

La reincidencia, notificaciones externas, órdenes, controversias judiciales y
remedios al consumidor necesitan atención humana y política operativa efectiva.
El panel no declara que la plataforma cumpla automáticamente todos los requisitos
de los artículos 114 Septies y 114 Octies de la LFDA ni que toda función editorial
o de impresión esté amparada por esa limitación de responsabilidad.

## Despliegue y conservación

Desplegar el código junto con ambas migraciones, con respaldo y preflight. No
revertir el código a una versión que ignore `rights_hold` mientras existan casos
activos. No editar migraciones ya aplicadas. Validar publicación, compra, canje,
lectura y retirada con datos de prueba antes de activar cobros reales.

Las nuevas instantáneas y evidencias requieren acceso restringido y una decisión
de retención por finalidad y obligación. Mantener conservación no equivale a
retención indefinida de todo dato personal. Revisar también respaldos, acuerdos
con proveedores, continuidad ante cierre, ISBN/colofón, depósito legal, precio
único, facturación y tratamiento jurídico/fiscal de Tinta antes del lanzamiento.
