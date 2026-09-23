import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { env } from "../env.js"
import {
  DEFAULT_GET_URL_TTL_SECONDS,
  type GetUrlOptions,
  ObjectNotFoundError,
  type PutObjectParams,
  type StorageService,
  type StoredObject,
} from "./types.js"

/**
 * Does this SDK error mean "no such object", as opposed to any other failure?
 * S3-compatible providers disagree on the name (`NoSuchKey` on AWS, `NotFound`
 * on a HEAD), so the HTTP status is the reliable signal.
 */
function isNoSuchKey(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404
}

// S3-compatible driver. Works against AWS S3, Scaleway Object Storage, MinIO,
// etc. — the provider is selected purely through env (endpoint, region,
// credentials, path-style). Objects are encrypted at rest via SSE-S3 (AES256).
export class S3StorageService implements StorageService {
  private readonly client: S3Client
  private readonly bucket: string

  constructor() {
    this.bucket = env.S3_BUCKET
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    })
  }

  async put(params: PutObjectParams): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
        // Encryption at rest, server-side.
        ServerSideEncryption: "AES256",
      }),
    )
    return { key: params.key, url: `s3://${this.bucket}/${params.key}` }
  }

  async getUrl(key: string, options?: GetUrlOptions): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        // Force a download instead of inline rendering — defence-in-depth so a
        // file that ever slips past type checks can't execute in the browser.
        ResponseContentDisposition: "attachment",
      }),
      { expiresIn: options?.expiresInSeconds ?? DEFAULT_GET_URL_TTL_SECONDS },
    )
  }

  async getBytes(key: string): Promise<Buffer> {
    let response: GetObjectCommandOutput
    try {
      response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    } catch (error) {
      // Only a real miss becomes ObjectNotFoundError. A 403 (wrong or expired
      // credentials) and a network failure stay what they are, so the caller can
      // answer "temporarily unavailable" instead of "gone forever".
      if (isNoSuchKey(error)) throw new ObjectNotFoundError(key)
      throw error
    }
    if (!response.Body) throw new ObjectNotFoundError(key)
    const bytes = await response.Body.transformToByteArray()
    return Buffer.from(bytes)
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }
}
