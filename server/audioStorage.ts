import { Client } from "@replit/object-storage"

type AudioStorageClientFactory = () => Client

type AudioStorageEnvironment = Record<string, string | undefined> & {
  TLOQUE_AUDIO_BUCKET_ID?: string
}

export function configuredAudioBucketId(env: AudioStorageEnvironment = process.env): string | undefined {
  const value = env.TLOQUE_AUDIO_BUCKET_ID?.trim()
  return value || undefined
}

export function createAudioStorageClient(env: AudioStorageEnvironment = process.env): Client {
  const bucketId = configuredAudioBucketId(env)
  return new Client(bucketId ? { bucketId } : undefined)
}

export function createLazyAudioStorage(factory: AudioStorageClientFactory = () => createAudioStorageClient()) {
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
