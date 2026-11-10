export type WalletOrderStatus = {
  id: number; status: string; units: number; packId?: string; commerceVersion?: string; purchaseKey: string | null
}
type IntentStorage = Pick<Storage, "getItem" | "removeItem">
export const walletIntentKey = (version: string, packId: string) => `wallet-purchase:${version}:${packId}`

/** A terminal order ends one purchase intention. A pending/unknown response
 * keeps its key so retries cannot create a second checkout. */
export function reconcileWalletIntent(storage: IntentStorage, order: WalletOrderStatus): boolean {
  if (order.status === "pending" || !order.commerceVersion || !order.packId || !order.purchaseKey) return false
  const key = walletIntentKey(order.commerceVersion, order.packId)
  if (storage.getItem(key) !== order.purchaseKey) return false
  storage.removeItem(key)
  return true
}
