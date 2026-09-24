/**
 * The one spelling of a page path (story 9.6), or null when `path` already is
 * it. The Vue router matches paths case-insensitively and ignores a trailing
 * slash, so `/BOUTIQUE/` rendered the same page as `/boutique` with a 200 —
 * duplicate content for every page, one canonical tag away from being indexed
 * twice. Every page slug is lower-case by schema (entitySlugSchema).
 *
 * Framework and API paths, and files, are left alone: build assets carry
 * upper-case hashes.
 */
export function canonicalPath(path: string): string | null {
  if (path === "/" || /^\/(_|api\/|bff\/)/.test(path)) return null
  const lastSegment = path.slice(path.lastIndexOf("/") + 1)
  if (lastSegment.includes(".")) return null

  let decoded: string
  try {
    decoded = decodeURI(path)
  } catch {
    return null
  }
  // Compare decoded: an escaped accent (%C3%A9) is upper-case hex, not an
  // upper-case letter, and must not bounce back and forth.
  const wanted = decoded.toLowerCase().replace(/\/+$/, "") || "/"
  return wanted === decoded ? null : encodeURI(wanted)
}
