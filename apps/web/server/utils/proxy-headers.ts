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
