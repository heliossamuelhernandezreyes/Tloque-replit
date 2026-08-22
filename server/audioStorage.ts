import { Client } from "@replit/object-storage"

type AudioStorageClientFactory = () => Client

export function createLazyAudioStorage(factory: AudioStorageClientFactory = () => new Client()) {
  let client: Client | null = null

  return {
    get(): Client {
      client ??= factory()
      return client
    },
    reset(failedClient?: Client): void {
      if (!failedClient || client === failedClient) client = null
    },
  }
}

export const audioStorage = createLazyAudioStorage()
