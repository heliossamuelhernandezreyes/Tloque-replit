# Tloque

Tloque es una plataforma de lectura y publicación digital con biblioteca,
lector, TTS, funcionamiento offline, comunidad, Fonoteca, cartas coleccionables,
marcos y herramientas creativas.

Este repositorio parte del baseline recibido el 8 de agosto de 2026. Los ZIP y
sus hashes se conservan en `archive/` y `checksums/`; `BASELINE_AUDIT.md`
documenta el estado anterior a las reparaciones.

## Requisitos

- Node.js 20.19 o posterior.
- PostgreSQL accesible mediante `DATABASE_URL`.
- Credenciales OAuth de Google para iniciar sesión.

## Preparación local

```bash
cp .env.example .env
npm ci
npm run db:push
npm run dev
```

Drizzle usa las variables del entorno actual; carga `.env` con el mecanismo de
tu plataforma o tu shell antes de ejecutar los comandos. Para actualizar una
base existente, haz una copia de seguridad y aplica también:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f migrations/0001_fonoteca_and_hardening.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f migrations/0002_paper_usage.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f migrations/0003_adaptive_fonoteca.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f migrations/0004_speech_and_audiobook_cache.sql
```

La primera migración agrega la Fonoteca, endurece la unicidad de compras y
asegura el borrado en cascada de copias de cartas. La segunda crea el registro
auditable de consumo de Papel. La tercera agrega planes de suscripción,
partituras por capas, proyectos narrativos laterales y perfiles compactos para
el lector. La cuarta agrega dirección de voz, estado real de suscripción,
trabajos con reserva de Papel y caché privada de audiolibros. Si detectan datos
históricos inconsistentes, debe corregirse ese dato
antes de reintentarlas; no lo eliminan a escondidas.

## Comandos

```bash
npm run check   # TypeScript
npm test        # pruebas unitarias y de seguridad
npm run build   # cliente y servidor para producción
npm start       # ejecuta dist/index.cjs
```

## Configuración de producción

`APP_URL` debe ser el origen HTTPS canónico, sin una ruta al final.
`SESSION_SECRET` debe tener por lo menos 32 caracteres. En producción son
obligatorias las credenciales de Google; el proceso falla al iniciar si falta
alguna de estas condiciones o si PostgreSQL no está disponible.

Los pagos reales solo se habilitan cuando existen tanto `STRIPE_SECRET_KEY`
como `STRIPE_WEBHOOK_SECRET`. Configura el webhook en:

```text
POST https://tu-dominio/api/payments/webhook
```

Mantén `PAYMENTS_BETA_MODE=false` y `ALLOW_GACHA_BETA_ADMIN=false` en
producción, salvo una prueba administrativa deliberada y controlada.

## Fonoteca

- Administradores crean, publican y archivan pistas oficiales con licencia,
  procedencia, emoción, BPM, energía y configuración de bucle.
- Autores escuchan el catálogo aprobado, guardan favoritos y asignan una pista
  por capítulo. No pueden inyectar archivos ni URL arbitrarias.
- El lector resuelve la asignación en el servidor y cambia de pista con un
  crossfade de seis segundos; TTS reduce temporalmente el volumen musical.
- El panel de administración está disponible en `/admin/fonoteca`.
- El Editor Avanzado guarda regiones musicales como datos laterales: nunca
  inserta instrucciones dentro del manuscrito. El lector usa una banda de
  atención aproximada por párrafo, histéresis y transiciones lentas.
- Oráculo sólo prepara propuestas revisables para suscripciones Estética y
  Audio. Consume Papel según tokens medidos, no se ejecuta durante la lectura y
  queda apagado mientras no se configure un proveedor.

## Dirección de voz y audiolibros

- El Editor Avanzado separa narrador, personajes, interpretación y silencios en
  un sidecar versionado; el manuscrito permanece intacto.
- Groq sólo propone una dirección revisable y consume Papel con una suscripción
  activa. El autor elige voces publicadas y aprueba el perfil antes de ofrecerlo.
- El lector conoce el costo exacto antes de solicitar una generación. El Papel
  se reserva de forma atómica, se devuelve ante fallo y nunca se inicia un
  trabajo sin saldo suficiente.
- El resultado se guarda una sola vez por versión de texto, perfil, voces,
  pausas y modelo. Cualquier suscriptor Audio activo reutiliza ese caché sin
  consumir Papel.
- La generación está apagada por defecto. Consulta
  `docs/AUDIOBOOK_WORKER.md` para conectar un worker propio o colaborador sin
  exponer claves del proveedor ni archivos públicos.

## Diccionario e idiomas

- La interfaz ofrece nueve idiomas y actualiza `lang`/`dir`, incluido
  el flujo RTL para árabe. Project Gutenberg y el diccionario reconocen además
  las dieciséis lenguas documentales del importador.
- El lector consulta varias acepciones, categoría gramatical y ejemplos. Evita
  mezclar homónimos de otros idiomas, sanea el texto remoto y traduce la
  definición al idioma configurado cuando necesita una edición de respaldo.

## Tinta y Papel

- Tinta es la unidad de apoyo y coleccionables. Los paquetes muestran precio
  final, precio unitario, bono real y una recomendación única, sin urgencia o
  escasez artificial. Los pagos permanecen apagados hasta configurar Stripe.
- Papel no es dinero ni premio de sorteo. Mide capacidad de IA con cargos
  enteros e idempotentes: tokens de entrada/salida del Oráculo y caracteres de
  voz. Las cuotas actuales son de pre-lanzamiento y deben calibrarse con costos
  reales antes de activar suscripciones.

## Cartas y marcos

- Solo el autor propietario o un administrador puede crear y administrar
  cartas de una obra.
- Se aplican los límites de 6 cartas por obra y 24 cartas sueltas por autor
  dentro de transacciones bloqueadas para evitar carreras.
- Las compras con Tinta debitan y entregan de forma atómica. Los webhooks y
  reintentos de Stripe son idempotentes.
- Eliminar una carta retira sus copias de colecciones y conserva el historial
  contable del sorteo.
- Los marcos validan tamaño, estructura, colores y coordenadas; solo un
  administrador crea paquetes y el desbloqueo con Tinta es atómico.

Consulta `SECURITY_AUDIT.md` para los hallazgos corregidos, las verificaciones y
los controles operativos pendientes del despliegue.
