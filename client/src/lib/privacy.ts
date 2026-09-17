import localforage from "localforage"
import { accountContext, accountStorage, accountSessionStorage } from "./account-context"

/** Borra copias locales vinculadas a la cuenta en este dispositivo. */
export async function clearLocalAccountData(): Promise<void> {
  const name = accountContext.databaseName
  accountStorage.clear()
  accountSessionStorage.clear()
  await Promise.allSettled([
    localforage.dropInstance({ name }),
  ])
  // Public application and sample caches, other accounts and unassigned
  // historical drafts do not belong to the account being deleted.
}
