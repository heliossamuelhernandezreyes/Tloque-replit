# Instalar Tloque en el Repl actual sin Agent ni GitHub

Este paquete reemplaza únicamente el código. No contiene secretos y no cambia
la base de datos durante la instalación.

## 1. Subir el ZIP

Sube `TLOQUE_REPLIT_RELEASE_2026-08-09.zip` a la raíz del Repl actual.

## 2. Instalar el código desde Shell

Abre Shell en la raíz del proyecto y pega el bloque completo:

```bash
release_tmp="$(mktemp -d /tmp/tloque_release.XXXXXX)"
unzip -q TLOQUE_REPLIT_RELEASE_2026-08-09.zip -d "$release_tmp"
bash "$release_tmp/instalar.sh" "$PWD"
```

El instalador:

- verifica todos los hashes del ZIP;
- crea un respaldo en `.tloque_backups/`;
- conserva `.replit`, `replit.nix`, Secrets, archivos subidos y base de datos;
- reemplaza únicamente código y configuración de Node;
- ejecuta `npm ci`, TypeScript, 50 pruebas y el build de producción;
- restaura automáticamente el código anterior si alguna comprobación falla.

No continúes si el último mensaje no dice:

```text
Código instalado y verificado correctamente.
```

## 3. Revisar la base sin modificarla

```bash
bash scripts/migrar.sh REVISAR
```

Este comando no crea ni altera nada. Revisa tablas base, duplicados, tarjetas
huérfanas, valores del sorteo, suscripciones, audiolibros y notificaciones.

Si termina con `Preflight aprobado`, continúa. Si informa un rechazo, no uses
`APLICAR`; conserva el texto del error para corregir el dato concreto.

## 4. Aplicar las migraciones

```bash
bash scripts/migrar.sh APLICAR
```

El migrador usa `DATABASE_URL` desde Secrets, toma un bloqueo exclusivo de
migración, registra checksums, guarda una instantánea de los datos que sí
cambian y ejecuta `0001` a `0007` dentro de una sola transacción. Ante cualquier
error hace rollback completo.

Se puede volver a ejecutar: las migraciones ya registradas con el mismo hash se
omiten. Si un archivo aplicado cambió, el proceso se detiene.

## 5. Arrancar y revisar Preview

```bash
npm run dev
```

Comprueba al menos:

1. Inicio y navegación principal.
2. Inicio de sesión con Google.
3. Biblioteca y lector.
4. Editor en escritura, música y voz.
5. Perfil y buzón.
6. Centro administrativo sólo con cuenta administradora.
7. Reiniciar el Repl y volver a abrir Preview.

## Secrets necesarios

Para desarrollo se necesita `DATABASE_URL`. Para producción también:

```text
APP_URL
SESSION_SECRET
ADMIN_EMAIL
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
```

`SESSION_SECRET` debe tener al menos 32 caracteres. `APP_URL` debe ser la URL
HTTPS pública exacta. Stripe, Oráculo y audiolibros pueden permanecer apagados.

Los Secrets del editor y los de la publicación pueden ser distintos. El
migrador sólo actúa sobre la base indicada por el `DATABASE_URL` visible en el
Shell actual; no supone que desarrollo y producción compartan la misma base.

## Restaurar el código anterior

El instalador muestra la ruta exacta del respaldo. Para restaurarlo:

```bash
bash scripts/restaurar_codigo.sh .tloque_backups/codigo_antes_de_FECHA.tar.gz RESTAURAR
```

La restauración no revierte migraciones ya confirmadas. Las migraciones son
aditivas y el único ajuste de datos deliberado convierte la configuración beta
antigua del sorteo de 40 Tinta a la configuración actual de 10 Tinta.
