import { isProtectedClaimKey, protectClaimKey, revealClaimKey } from "./claimKeys"

interface Copy { id: number; tokenId: number; folio: string; claimKey: string; claimKeyHash: string }
interface Token { id: number; ownerUserId: number; bookId: number; licenseStatus: string }
export interface PrintPreparationStore {
  copy(id: number): Promise<Copy | undefined>
  token(id: number): Promise<Token | undefined>
  protect(copy: Copy, protectedKey: ReturnType<typeof protectClaimKey>): Promise<void>
}
export class PrintPreparationError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
export function printCopySummary(copy: { id: number; folio: string; claimedByUserId: number | null; digitalClaimAllowed?: boolean }, owner: number, active: boolean) {
  return { id: copy.id, folio: copy.folio, canPrint: active, digitalClaimed: copy.claimedByUserId !== null, claimedByOwner: copy.claimedByUserId === owner,
    ...(copy.digitalClaimAllowed === undefined ? {} : { digitalClaimAllowed: copy.digitalClaimAllowed }) }
}
// The route holds the owner's transaction lock while this operation runs.
// Authorisation always precedes decryption, including for migrated records.
export async function preparePrintCopy(userId: number, copyId: number, store: PrintPreparationStore) {
  if (!Number.isSafeInteger(copyId) || copyId < 1 || copyId > 2_147_483_647) throw new PrintPreparationError(400, "Ejemplar inválido")
  const copy = await store.copy(copyId)
  const token = copy ? await store.token(copy.tokenId) : undefined
  if (!copy || !token || token.ownerUserId !== userId) throw new PrintPreparationError(404, "Ejemplar no encontrado")
  if (token.licenseStatus !== "active") throw new PrintPreparationError(409, "El permiso de impresión está suspendido o reembolsado.")
  const key = revealClaimKey(copy.claimKey)
  if (!isProtectedClaimKey(copy.claimKey) || !copy.claimKeyHash) await store.protect(copy, protectClaimKey(key))
  return { bookId: token.bookId, copy: { folio: copy.folio, key } }
}
