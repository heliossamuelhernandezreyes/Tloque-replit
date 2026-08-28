import localforage from "localforage"

/** Borra copias locales vinculadas a la cuenta en este dispositivo. */
export async function clearLocalAccountData(): Promise<void> {
  localStorage.clear()
  sessionStorage.clear()
  await Promise.allSettled([
    localforage.dropInstance({ name: "Novareads" }),
    localforage.dropInstance({ name: "tloque" }),
  ])
  if ("caches" in window) {
    const names = await caches.keys()
    await Promise.all(names.filter(name => name.startsWith("tloque-")).map(name => caches.delete(name)))
  }
}
