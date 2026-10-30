import { z } from "zod"

export const LEGAL_VERSION = "2026-10-30.2"
export const RIGHTS_OPTIONS = {
  offline: "Permitir descargar una copia digital para lectura personal",
  personalPrint: "Permitir tres ejemplares personales por apoyo, sin fabricar para venta",
  commercialPrint: "Permitir fabricar y distribuir un ejemplar nuevo por permiso comercial",
  audio: "Permitir producir, almacenar y reutilizar narración sintética",
  translation: "Permitir futuras propuestas de traducción para revisión; el servicio completo aún no está disponible",
  collectibles: "Permitir utilizar personajes y recursos autorizados en tarjetas de esta obra",
} as const
export type RightsOption = keyof typeof RIGHTS_OPTIONS
export const rightsChoicesSchema = z.object({
  offline: z.boolean(), personalPrint: z.boolean(), commercialPrint: z.boolean(),
  audio: z.boolean(), translation: z.boolean(), collectibles: z.boolean(),
}).strict()
export const publicationAcceptanceSchema = z.object({
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  accepted: z.literal(true), adultAndAuthorized: z.literal(true), hasRights: z.literal(true),
  origin: z.enum(["original", "licensed", "public_domain"]),
  evidence: z.string().trim().max(4000).default(""),
  choices: rightsChoicesSchema,
}).strict().superRefine((value, ctx) => {
  if (value.origin !== "original" && value.evidence.length < 20) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence"], message: "Describe el permiso o la fuente y la versión cuya situación de derechos verificaste." })
  }
})
export type PublicationAcceptance = z.infer<typeof publicationAcceptanceSchema>

export const PRIVACY_REQUEST_TYPES = ["access", "rectification", "cancellation", "opposition", "revocation", "restriction"] as const
export const PRIVACY_REQUEST_LABELS: Record<typeof PRIVACY_REQUEST_TYPES[number], string> = {
  access: "Acceso", rectification: "Rectificación", cancellation: "Cancelación",
  opposition: "Oposición", revocation: "Revocación de consentimiento", restriction: "Limitar uso o divulgación",
}
export const privacyRequestSchema = z.object({
  email: z.string().trim().email().max(254),
  type: z.enum(PRIVACY_REQUEST_TYPES),
  description: z.string().trim().min(10).max(4000),
}).strict()

export type LegalOperator = { name: string; address: string; privacyEmail: string; phone: string }
export type LegalDocument = { id: "terms" | "privacy" | "publication"; title: string; version: string; text: string }

/** One canonical text is displayed, hashed and retained in each receipt. */
export function legalDocuments(operator: LegalOperator): LegalDocument[] {
  const identity = operator.name && operator.address
    ? `Responsable y proveedor: ${operator.name}. Domicilio de atención: ${operator.address}.`
    : "La identidad y el domicilio del operador están pendientes de configuración. Este documento es preparatorio y no habilita nuevas licencias de publicación ni monetización."
  const contact = operator.privacyEmail
    ? `Contacto de privacidad: ${operator.privacyEmail}.${operator.phone ? ` Teléfono de atención: ${operator.phone}.` : ""}`
    : "Puedes presentar una solicitud en /privacy/requests sin iniciar sesión. El contacto externo del responsable sigue pendiente."
  return [
    { id: "terms", title: "Términos de la beta", version: LEGAL_VERSION, text: `${identity}\n${contact}\nLeer, escribir y publicar de forma ordinaria es gratuito. Los servicios opcionales deben mostrar prestaciones, precio total y condiciones antes de contratar. Papel mide consumo de cómputo; Tinta es un crédito interno cuya compra, circulación y liquidación permanecen sujetas a la habilitación comercial documentada. No se promete conversión general a efectivo, rentabilidad ni propiedad sobre los derechos de autor de terceros.\nConservas tus derechos. Debes disponer de permisos suficientes sobre textos, traducciones, imágenes, música, fuentes y modelos que aportas. La publicación exige una licencia separada por obra y confirmación de facultades para contratar. Los borradores no se publican al aceptar estos términos.\nNo se permite suplantación, acoso, explotación sexual, malware ni infracciones de derechos. Las denuncias se revisan y deben permitir respuesta y apelación, salvo obligación legal o riesgo inmediato. Una reclamación legítima u orden puede impedir seguir distribuyendo una edición previamente adquirida; se revisará la entrega o solución que legalmente proceda.\nUn permiso de impresión determina ejemplares nuevos autorizados. El QR es un registro de Tloque y puede dar acceso a prestaciones digitales; no es un registro público de autoría. No se promete impedir técnicamente copias de un PDF exportado. La reventa de un soporte lícitamente distribuido y la transferencia de accesos digitales tienen regímenes distintos.\nLos derechos legales del consumidor no se renuncian. No hay exención general de responsabilidad ni negativa absoluta de reembolso. Las compras y suscripciones requieren condiciones comerciales específicas, información fiscal y mecanismos de reclamación antes de activarse. Los cambios no amplían retroactivamente los permisos de una obra.`, },
    { id: "privacy", title: "Aviso de privacidad", version: LEGAL_VERSION, text: `${identity}\n${contact}\nTratamos identificador de cuenta, nombre, correo y fotografía del inicio de sesión; preferencias, biblioteca, progreso, obras, comentarios y colecciones; registros de seguridad, aceptación, solicitudes y operaciones. Las finalidades son autenticar, guardar el trabajo solicitado, prestar lectura/publicación, acreditar permisos, atender derechos y reclamaciones y mantener seguridad y contabilidad cuando corresponda. No solicitamos datos sensibles para leer ni inferimos diagnósticos médicos o psicológicos de la lectura. Evita incluir información íntima de terceros sin base legítima.\nGoogle procesa la autenticación; Replit y sus servicios pueden alojar la aplicación y los archivos. El diccionario puede enviar la palabra consultada y sus idiomas a Google Translate o MyMemory; no es un servicio de traducción completa de manuscritos. Stripe procesa pagos cuando se habiliten y Stripe Connect verifica directamente identidad fiscal/bancaria de creadores. Tloque no guarda números completos de tarjeta o cuenta bancaria. El Director Artificial y la voz son opcionales: solo los fragmentos necesarios se envían al proveedor configurado cuando se solicita esa función. La música local no necesita enviar el texto durante la lectura. No se autoriza entrenamiento de modelos por aceptar una licencia de publicación; el uso de cada proveedor debe ser compatible con esta condición.\nPuedes solicitar acceso, rectificación, cancelación, oposición, revocación o limitación en /privacy/requests. Puedes hacerlo sin cuenta; conservamos folio y comprobante. Recibir una solicitud no acredita la identidad ni ejecuta automáticamente una entrega o eliminación: verificaremos por un medio proporcional y te contactaremos por el correo indicado. No envíes identificaciones, datos bancarios ni manuscritos en ese formulario. Los plazos se atienden conforme a la ley aplicable; guarda el comprobante y utiliza el contacto externo si necesitas dar seguimiento.\nDesde Configuración puedes exportar tus datos y cerrar tu cuenta. Cerrar cuenta elimina perfil, progreso y borradores de recuperación, retira obras del catálogo y revoca sesiones; el sistema actual conserva manuscritos, versiones y proyectos fuera del catálogo y conserva ediciones adquiridas, créditos, colecciones y registros económicos. Puedes solicitar revisión y cancelación de esa conservación; no equivale a una autorización de retención indefinida. Toda excepción de conservación necesita finalidad, fundamento, acceso restringido y plazo. La revisión individual de retención y depuración de respaldos está pendiente de completar operativamente. Las copias locales pueden seguir en tus dispositivos u otros lectores autorizados.\nNo usamos la aceptación de este aviso como consentimiento para publicidad ni cesión general de datos. Se comunicarán cambios mediante la publicación de una versión identificada; las finalidades nuevas y transferencias que requieran autorización deberán obtenerla antes. Puedes acudir a la autoridad competente en datos de particulares conforme al régimen vigente.`, },
    { id: "publication", title: "Licencia de publicación y permisos opcionales", version: LEGAL_VERSION, text: `${identity}\n${contact}\nConfirmas que tienes facultades para autorizar la versión identificada de la obra y sus recursos. Conservas autoría y derechos morales. Concedes una licencia no exclusiva para alojar, realizar copias técnicas y mostrar gratuitamente esta versión en Tloque a sus lectores. La licencia de publicación rige mientras mantengas esta versión publicada; al retirarla cesan nuevas entregas, con la conservación estrictamente necesaria para obligaciones y prestaciones previamente autorizadas que sean lícitas. No cedes obras futuras ni autorizas entrenamiento de IA. El servicio inicial se ofrece para México; cualquier ampliación de territorios exige revisar y pactar derechos.\nCada opción se elige expresamente. Lectura offline: copia para lectura personal. Impresión personal: hasta tres ejemplares nuevos por apoyo, sin fabricar para venta; regalos y otros usos requieren acuerdo específico. Impresión comercial: fabricar y distribuir un ejemplar nuevo por permiso, incluidos los terceros necesarios para imprimir; fabricar más exige otro permiso. Reintentar hojas defectuosas conserva la identidad del ejemplar y exige inutilizar sobrantes; no autoriza más ejemplares completos. No se pretende eliminar los derechos legales de reventa de soportes lícitos.\nAudio: producir, almacenar y servir narración sintética de esta versión a lectores autorizados, con permiso del texto, de voces y del proveedor. La generación inicial no concede exclusividad a quien la paga. Traducción: autorización para futuras propuestas destinadas a revisión, sin autorizar su publicación automática; el servicio completo de traducción de obras aún no está disponible. El diccionario de palabras es una función distinta. Coleccionables: usar solo personajes, textos y recursos cuyos derechos puedas autorizar para tarjetas de esta obra, sin ceder al comprador los derechos de autor. Las autorizaciones opcionales no constituyen por sí mismas una aprobación de proveedores o una habilitación comercial.\nAntes de monetizar, la obra debe mostrar su categoría y base económica: libros y sagas 90% para el titular / 10% Tloque; cuentos 50% / 50%. Se identifica la categoría de forma expresa, no por el número de capítulos. La base fiscal, costes, reembolsos, bonos, retenciones y calendario de liquidación deben quedar definidos en un acuerdo comercial adicional antes del primer cobro. No se habilitan cobros por aceptar esta licencia preparatoria.\nLa procedencia declarada y las elecciones se conservan junto a la revisión, huella de la obra, texto íntegro de documentos y fecha. Declarar dominio público no sustituye verificar la traducción, edición y recursos concretos. Cambiar la obra o ampliar usos necesita un nuevo registro. Para retirar o corregir permisos, usa /privacy/requests o el contacto de atención; se revisarán las obligaciones previas sin presumir que puedan distribuirse obras infractoras.`, },
  ]
}
