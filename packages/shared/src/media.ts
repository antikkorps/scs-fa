// Catalogue image renditions (stories 7.5b, 9.6), shared by the API that
// renders them and the front that picks among them.

/**
 * The widths pre-generated at upload. Small images are never upscaled: a
 * visual narrower than the largest width only has the widths it can fill.
 */
export const MEDIA_WIDTHS = [400, 800, 1400] as const

/** Every width is stored in both formats: AVIF for the browsers that take it (~30 % lighter on photos), WebP for the rest. */
export const MEDIA_FORMATS = ["avif", "webp"] as const
export type MediaFormat = (typeof MEDIA_FORMATS)[number]

const MEDIA_URL_RE = /^\/api\/media\/([0-9a-f-]{36})\/(\d{2,5})\.webp$/

/**
 * The renditions behind a stored image URL, or null when it is not a media
 * rendition (a legacy upload, an external URL).
 *
 * The stored URL points at the WIDEST rendition, and the widths are those of
 * MEDIA_WIDTHS up to it — or that single width, for an image too small for the
 * first step. So the whole set is known from the URL alone: no column to add,
 * nothing that could drift from what the upload actually produced.
 */
export function mediaRenditions(url: string | null | undefined): { id: string; widths: number[] } | null {
  const match = url ? MEDIA_URL_RE.exec(url) : null
  if (!match) return null
  const id = match[1] as string
  const widest = Number(match[2])
  const widths = MEDIA_WIDTHS.filter((w) => w <= widest)
  return { id, widths: widths.at(-1) === widest ? [...widths] : [widest] }
}

/** Public URL of one rendition. Relative on purpose: no host is ever baked in. */
export function mediaRenditionUrl(id: string, width: number, format: MediaFormat): string {
  return `/api/media/${id}/${width}.${format}`
}

/** A `srcset` for one format of a stored image, or null when it has no renditions. */
export function mediaSrcset(url: string | null | undefined, format: MediaFormat): string | null {
  const set = mediaRenditions(url)
  if (!set) return null
  return set.widths.map((w) => `${mediaRenditionUrl(set.id, w, format)} ${w}w`).join(", ")
}
