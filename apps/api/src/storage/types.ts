// Provider-agnostic object storage abstraction.
// Implementations must not leak provider specifics to callers — swapping the
// driver (S3-compatible, in-memory, or a future non-S3 provider) must not
// require any change at the call sites.

export interface PutObjectParams {
  /** Storage key (path) the object is written under. */
  key: string
  body: Buffer
  contentType: string
}

export interface StoredObject {
  key: string
  /** Durable, provider-internal reference to the object (NOT a public URL). */
  url: string
}

export interface GetUrlOptions {
  /** Lifetime of the returned (typically presigned) URL. */
  expiresInSeconds?: number
}

export interface StorageService {
  /** Store an object. Implementations encrypt at rest when the provider supports it. */
  put(params: PutObjectParams): Promise<StoredObject>
  /** Return a short-lived, access-controlled URL to read the object. */
  getUrl(key: string, options?: GetUrlOptions): Promise<string>
  /** Delete an object. Idempotent: deleting a missing key must not throw. */
  delete(key: string): Promise<void>
}

export const DEFAULT_GET_URL_TTL_SECONDS = 300
