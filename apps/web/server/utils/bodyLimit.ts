import {
  MAX_ARTWORK_IMAGE_SIZE_BYTES,
  MAX_BLOG_IMAGE_SIZE_BYTES,
  MAX_CATALOG_IMPORT_FILE_BYTES,
  MAX_LEGAL_DOC_SIZE_BYTES,
  MAX_MEDIA_SIZE_BYTES,
} from "@armurier/shared"

// Story 12.9f (security audit) — the BFF buffers each request body before
// forwarding it, so an unbounded body could exhaust the web server's memory.

const MULTIPART_OVERHEAD_BYTES = 1024 * 1024

/** The proxy carries uploads: the largest file the API accepts, plus multipart framing. */
export const BFF_PROXY_BODY_LIMIT_BYTES =
  Math.max(
    MAX_MEDIA_SIZE_BYTES,
    MAX_ARTWORK_IMAGE_SIZE_BYTES,
    MAX_BLOG_IMAGE_SIZE_BYTES,
    MAX_CATALOG_IMPORT_FILE_BYTES,
    MAX_LEGAL_DOC_SIZE_BYTES,
  ) + MULTIPART_OVERHEAD_BYTES

/** The auth routes only take a small JSON body (credentials, a code, a token). */
export const BFF_AUTH_BODY_LIMIT_BYTES = 16 * 1024

function bodyLimitFor(path: string): number | null {
  if (path.startsWith("/bff/api/")) return BFF_PROXY_BODY_LIMIT_BYTES
  if (path.startsWith("/bff/")) return BFF_AUTH_BODY_LIMIT_BYTES
  return null
}

type BodyHeaders = { contentLength?: string; transferEncoding?: string }

/**
 * The status to refuse a BFF request body with, or null to let it through.
 * Node enforces the announced Content-Length, so checking the header is enough;
 * a streamed body that announces no size is refused.
 */
export function bffBodyRefusal(path: string, headers: BodyHeaders): 400 | 411 | 413 | null {
  const limit = bodyLimitFor(path)
  if (limit === null) return null
  if (headers.contentLength === undefined) return headers.transferEncoding ? 411 : null
  if (!/^\d+$/.test(headers.contentLength)) return 400
  return Number(headers.contentLength) > limit ? 413 : null
}
