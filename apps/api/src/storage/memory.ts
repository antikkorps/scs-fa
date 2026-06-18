import type { GetUrlOptions, PutObjectParams, StorageService, StoredObject } from "./types.js"

interface MemoryObject {
  body: Buffer
  contentType: string
}

// In-process storage driver for tests and CI — no external service required.
// State is per-instance so tests stay isolated.
export class InMemoryStorageService implements StorageService {
  private readonly objects = new Map<string, MemoryObject>()

  async put(params: PutObjectParams): Promise<StoredObject> {
    this.objects.set(params.key, { body: params.body, contentType: params.contentType })
    return { key: params.key, url: `memory://${params.key}` }
  }

  async getUrl(key: string, _options?: GetUrlOptions): Promise<string> {
    return `memory://${key}`
  }

  async getBytes(key: string): Promise<Buffer> {
    const object = this.objects.get(key)
    if (!object) throw new Error(`Object not found: ${key}`)
    return object.body
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }

  // Test-only helper: inspect what was stored.
  get(key: string): MemoryObject | undefined {
    return this.objects.get(key)
  }
}
