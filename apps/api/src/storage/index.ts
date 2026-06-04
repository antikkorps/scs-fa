import { env } from "../env.js"
import { InMemoryStorageService } from "./memory.js"
import { S3StorageService } from "./s3.js"
import type { StorageService } from "./types.js"

export { InMemoryStorageService } from "./memory.js"
export { S3StorageService } from "./s3.js"
export type { GetUrlOptions, PutObjectParams, StorageService, StoredObject } from "./types.js"

function resolveDriver(): "s3" | "memory" {
  if (env.STORAGE_DRIVER) return env.STORAGE_DRIVER
  // No real S3 in tests by default.
  return env.NODE_ENV === "test" ? "memory" : "s3"
}

function createStorage(): StorageService {
  return resolveDriver() === "memory" ? new InMemoryStorageService() : new S3StorageService()
}

// App-wide singleton. Driver is chosen once at startup from env.
export const storage: StorageService = createStorage()
