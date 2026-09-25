# Worker de audiolibros de Tloque

El servidor web decide autorización, disponibilidad, saldo, reserva de Papel,
idempotencia y caché. El worker sólo sintetiza un trabajo ya autorizado. Puede
ser operado por Tloque o por un colaborador sin darle acceso a sesiones de
usuarios ni a la base de datos.

## Contrato

Todas las llamadas internas usan:

```text
Authorization: Bearer $AUDIOBOOK_WORKER_TOKEN
```

1. `POST /api/internal/audiobook/jobs/claim`

   - Responde `204` si no hay trabajo.
   - Si hay trabajo, entrega `job`, `profile`, `voices` y `modelId`.
   - `job.claimToken` identifica esta asignación; `job.leaseExpiresAt` indica
     cuándo vence. Conserva ambos. Una asignación dura cinco minutos.
   - `profile.segments` contiene el texto exacto, la voz, la interpretación,
     el ritmo y las pausas. El worker no debe corregir ni reescribir el texto.
   - `voices` resuelve cada `voiceProfileId` al identificador privado del
     proveedor. Esos identificadores nunca se exponen al cliente.

2. El worker genera cada segmento con la voz indicada, concatena los segmentos
   en orden e inserta los silencios `pauseBeforeMs`, `pauseAfterMs` y
   `paragraphPauseMs`. No agrega efectos, golpes, ambientes ni música.

   Mientras trabaja, llama cada minuto a
   `POST /api/internal/audiobook/jobs/:id/heartbeat` con
   `{ "claimToken": "<job.claimToken>" }`. Un `200` devuelve el nuevo
   `leaseExpiresAt`. Un `409` exige detener ese trabajo: perdió la asignación
   y no debe confirmar ni volver a cobrar. Los heartbeats no prolongan una
   generación más allá de dos horas desde su inicio.

3. Sube un solo archivo a almacenamiento de objetos con una clave única que no
   sea pública.

4. Confirma con `POST /api/internal/audiobook/jobs/:id/complete`:

```json
{
  "claimToken": "<job.claimToken>",
  "storageKey": "audiobooks/sha256/capitulo.mp3",
  "mimeType": "audio/mpeg",
  "durationSeconds": 742,
  "actualCharacters": 18431
}
```

`actualCharacters` debe coincidir exactamente con `job.expectedCharacters`:
el worker nunca puede omitir texto para abaratar el trabajo ni enviar texto
adicional que aumente el cargo respecto de la reserva previa.

5. Ante cualquier fallo llama `POST /api/internal/audiobook/jobs/:id/fail`:

```json
{ "claimToken": "<job.claimToken>", "errorCode": "ELEVENLABS_TIMEOUT" }
```

El servidor devuelve automáticamente el Papel reservado una sola vez. Repetir
`complete` con el mismo token es idempotente; un fallo repetido o un resultado
tardío devuelve `409` sin modificar el saldo. Al arrancar y cada minuto, el
servidor recupera trabajos cuyo lease venció y colas de más de 24 horas. No
reenvía automáticamente una síntesis incierta al proveedor. La recuperación
se procesa en lotes de hasta 100 trabajos por pasada.

Los workers anteriores deben adoptar `claimToken` y heartbeat antes de activar
generación. Los trabajos antiguos en proceso sin lease se consideran vencidos
al migrar y se reembolsan. Los objetos subidos por un worker cuyo lease venció
deben limpiarse después de verificar que ninguna entrada de caché los usa.

## Límites operativos

- Mantener `AUDIOBOOK_GENERATION_ENABLED=false` hasta desplegar y probar el
  worker, el almacenamiento y el firmador de URLs.
- Cortar capítulos en solicitudes compatibles con el modelo, sin partir un
  fragmento de diálogo a mitad de una intervención.
- Registrar sólo ids técnicos, duración, caracteres y códigos de error; no
  escribir el manuscrito ni el audio en logs.
- El objeto queda privado. La reproducción pasa por Tloque y exige una
  suscripción Audio activa en cada solicitud.
- Rotar el token al cambiar de colaborador. Cada despliegue de producción debe
  usar un secreto aleatorio de por lo menos 24 bytes.
