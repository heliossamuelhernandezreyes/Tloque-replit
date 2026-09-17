import localforage from "localforage"
import { accountContext } from "./account-context"

const stores = new Map<string, LocalForage>()
export function createAccountStore(storeName: string) {
  function current() {
    const id = accountContext.requireId()
    const name = accountContext.databaseName
    const key = name + ":" + storeName
    let store = stores.get(key)
    if (!store) { store = localforage.createInstance({ name, storeName }); stores.set(key, store) }
    return { id, store }
  }
  return {
    async getItem<T>(key: string): Promise<T | null> {
      if (!accountContext.id) return null
      const { id, store } = current()
      const value = await store.getItem<T>(key)
      accountContext.assertCurrent(id)
      return value
    },
    async setItem<T>(key: string, value: T): Promise<T> {
      const { id, store } = current()
      const saved = await store.setItem(key, value)
      accountContext.assertCurrent(id)
      return saved
    },
    async removeItem(key: string): Promise<void> {
      const { id, store } = current()
      await store.removeItem(key)
      accountContext.assertCurrent(id)
    },
  }
}
