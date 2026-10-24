/**
 * The upstream response headers the BFF proxy passes on to the browser.
 * `content-disposition` lets a download (the catalogue export, story 12.4)
 * keep its file name; everything else — cookies above all — stays upstream.
 */
const FORWARDED = ["content-type", "content-disposition", "cache-control"] as const

export function forwardedResponseHeaders(headers: Headers): [string, string][] {
  return FORWARDED.flatMap((name) => {
    const value = headers.get(name)
    return value ? [[name, value] as [string, string]] : []
  })
}

/**
 * The browser request headers the BFF proxy passes on to the API, besides the
 * bearer it adds itself: the body's type, and the key that names a refund
 * (story 12.9g). Cookies and any browser-sent authorization stay here.
 */
const FORWARDED_REQUEST = ["content-type", "idempotency-key"] as const

export function forwardedRequestHeaders(read: (name: string) => string | undefined): Record<string, string> {
  return Object.fromEntries(
    FORWARDED_REQUEST.flatMap((name) => {
      const value = read(name)
      return value ? [[name, value]] : []
    }),
  )
}
