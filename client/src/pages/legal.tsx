import { ArrowLeft } from "lucide-react"

type Props = { kind: "privacy" | "terms" }

export default function LegalPage({ kind }: Props) {
  const privacy = kind === "privacy"
  return (
    <main className="min-h-screen bg-black px-5 py-8 text-zinc-300 sm:px-8">
      <article className="mx-auto max-w-3xl">
        <a href="/" className="inline-flex items-center gap-2 text-sm text-white/55 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Volver a Tloque
        </a>
        <p className="mt-10 text-[10px] uppercase tracking-[.24em] text-violet-200/45">Versión beta · 26 de agosto de 2026</p>
        <h1 className="mt-3 font-serif text-3xl text-white">{privacy ? "Privacidad" : "Términos de uso"}</h1>
        {privacy ? <Privacy /> : <Terms />}
      </article>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-9"><h2 className="font-serif text-xl text-white/90">{title}</h2><div className="mt-3 space-y-3 text-sm leading-7 text-white/58">{children}</div></section>
}

function Privacy() {
  return <>
    <Section title="Qué datos usa Tloque">
      <p>Al iniciar sesión recibimos de Google tu identificador, nombre, correo verificado y, si existe, foto de perfil. También guardamos tus preferencias, biblioteca, progreso, obras, comentarios, colecciones y movimientos de Tinta o Papel.</p>
      <p>Los secretos de pago, claves privadas de proveedores y claves de reclamación no se incluyen en tu exportación.</p>
    </Section>
    <Section title="Proveedores y decisiones opcionales">
      <p>Google procesa el inicio de sesión. Replit y sus servicios de almacenamiento pueden alojar la aplicación y sus archivos. Stripe procesa pagos cuando están habilitados; Tloque conserva referencias y estado contable, no números completos de tarjeta.</p>
      <p>El Director Artificial y la generación de audiolibros son opcionales. Solo cuando los solicitas, el fragmento necesario del manuscrito y sus indicaciones pueden enviarse al proveedor configurado, como Groq o un worker de voz que puede utilizar ElevenLabs. La reproducción musical local no requiere enviar el texto durante la lectura.</p>
    </Section>
    <Section title="Control y conservación">
      <p>Puedes exportar tus datos desde Configuración. Al eliminar la cuenta, las obras dejan de ser públicas y se borran o seudonimizan los datos personales. Se conservan asientos económicos sin información identificable cuando son necesarios para integridad contable, prevención de fraude o cumplimiento.</p>
      <p>Las copias offline permanecen en tu dispositivo hasta que las retires, borres los datos del navegador o elimines la cuenta desde ese dispositivo.</p>
    </Section>
    <Section title="Principios">
      <p>Tloque no infiere estados médicos, psicológicos o de atención a partir de tu lectura. La música adaptativa se basa en dirección narrativa y controles del usuario.</p>
      <p>Antes del lanzamiento comercial se publicará el canal oficial para solicitudes de acceso, rectificación, eliminación y soporte.</p>
    </Section>
  </>
}

function Terms() {
  return <>
    <Section title="Lectura y cuenta">
      <p>La lectura, escritura y publicación ordinaria son gratuitas. Las suscripciones no bloquean historias. Algunas funciones opcionales de cómputo, voz, coleccionables o impresión pueden utilizar Papel, Tinta o pagos claramente confirmados.</p>
      <p>Eres responsable de la actividad de tu cuenta y de mantener acceso seguro a tu proveedor de inicio de sesión.</p>
    </Section>
    <Section title="Tus obras">
      <p>Conservas la autoría y los derechos que tengas sobre el contenido que publicas. Concedes a Tloque una licencia no exclusiva y limitada para alojarlo, reproducirlo y mostrarlo dentro del servicio mientras permanezca publicado o sea necesario para entregar una compra autorizada.</p>
      <p>Solo puedes subir contenido propio, de dominio público o para el que tengas permisos suficientes. No se permite material ilegal, suplantación, acoso, explotación sexual, malware ni violaciones deliberadas de derechos.</p>
    </Section>
    <Section title="Audio, IA y economía beta">
      <p>La dirección musical y de voz es una capa separada del manuscrito. Las propuestas de IA deben ser revisadas por el autor y no modifican automáticamente el texto normal.</p>
      <p>Probabilidades, precios y repartos deben mostrarse antes de confirmar. Durante la beta, pagos, sorteos, retiros y suscripciones pueden permanecer desactivados. No deben interpretarse saldos beta como dinero retirable hasta que el flujo de pagos a autores esté habilitado expresamente.</p>
    </Section>
    <Section title="Moderación y retiro">
      <p>Tloque puede ocultar contenido para revisión cuando exista una denuncia razonable, riesgo de seguridad o posible infracción. Se conservará la posibilidad de corrección y apelación antes de una decisión definitiva, salvo obligación legal o peligro inmediato.</p>
      <p>Estos términos son un documento operativo de beta y deben recibir revisión legal por jurisdicción antes de activar monetización pública.</p>
    </Section>
  </>
}
