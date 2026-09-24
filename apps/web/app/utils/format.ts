// Pure presentation helpers — unit-tested in format.test.ts.

import { type ArtworkOrientation, mediaSrcset } from "@armurier/shared"

const EUROS = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" })

/** Format an amount as EUR (fr-FR), or an em dash when absent. */
export function formatEuros(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—"
  return EUROS.format(amount)
}

const DATETIME = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" })
const DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" })

/** Format an ISO date string as a fr-FR date+time, or an em dash when absent/invalid. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : DATETIME.format(d)
}

/** Format an ISO date string as a fr-FR date (no time), or an em dash when absent/invalid. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : DATE.format(d)
}

/** Small deterministic string hash (FNV-ish) used to vary the placeholder accent. */
function seedHash(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0
  return h
}

/**
 * Deterministic, self-contained placeholder for an artwork without an image yet.
 * Returns an inline SVG data URI (no network) on the dark "gallery" palette with
 * a brass aperture/target motif — on-brand and reliable offline, unlike a remote
 * photo service. The accent shade varies per seed for subtle variety.
 */
export function fallbackImage(seed: string, w = 800, h = 1000): string {
  const hash = seedHash(seed)
  const lightness = 40 + (hash % 12) // brass-ish, 40–51%
  const accent = `hsl(40 46% ${lightness}%)`
  const cx = Math.round(w / 2)
  const cy = Math.round(h / 2)
  const r = Math.round(Math.min(w, h) * 0.2)
  const arm = Math.round(r * 1.5)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><radialGradient id="g" cx="50%" cy="42%" r="78%">` +
    `<stop offset="0%" stop-color="#1c1c21"/><stop offset="100%" stop-color="#0e0e10"/>` +
    `</radialGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#g)"/>` +
    `<g fill="none" stroke="${accent}" stroke-opacity="0.5">` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" stroke-width="2"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${Math.round(r * 0.58)}" stroke-width="1.5"/>` +
    `<line x1="${cx}" y1="${cy - arm}" x2="${cx}" y2="${cy + arm}" stroke-width="1"/>` +
    `<line x1="${cx - arm}" y1="${cy}" x2="${cx + arm}" y2="${cy}" stroke-width="1"/>` +
    `</g></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/**
 * Absolute URL for an `og:image`, or `undefined` when there is no real image.
 *
 * ⚠️ Never pass `artworkImage().src` here. When a piece has no visual that is
 * the inline SVG placeholder — a `data:` URI, which every crawler ignores, so
 * the page ships a share card that looks configured and renders as nothing.
 * Omitting the tag is the honest state. Open Graph also requires an absolute
 * URL, which `featuredImageUrl` (site-relative) is not on its own.
 */
export function ogImageUrl(featuredImageUrl: string | null | undefined, siteUrl: string): string | undefined {
  if (!featuredImageUrl) return undefined
  return featuredImageUrl.startsWith("http") ? featuredImageUrl : `${siteUrl}${featuredImageUrl}`
}

/**
 * Artwork image: the backend-provided URL when set, else a deterministic
 * placeholder — plus that placeholder, so a caller can hand it to
 * `v-img-fallback`.
 *
 * ⚠️ An absent URL and a URL that fails to load are two different states, and
 * only the first one used to be handled. A stored image the storage can no
 * longer serve (object gone, credentials rotated, provider down) left the
 * browser rendering the alt text across the grid. Both states must land on the
 * same placeholder, which is why the fallback travels with the src.
 */
export function artworkImage(
  featuredImageUrl: string | null | undefined,
  seed: string,
  w = 1200,
  h = 1500,
): ImageSource {
  const fallback = fallbackImage(seed, w, h)
  const src = featuredImageUrl && featuredImageUrl.length > 0 ? featuredImageUrl : fallback
  // Story 9.6: every width the upload produced, in AVIF and WebP, so the
  // browser fetches the file the layout needs — not the 1400px one on a phone.
  return { src, fallback, avifSrcset: mediaSrcset(src, "avif"), webpSrcset: mediaSrcset(src, "webp") }
}

/**
 * What an image component needs: the default `src`, the placeholder for when
 * it fails, and — for a catalogue rendition — one `srcset` per format (null for
 * a placeholder, a legacy upload or an external URL, which have none).
 */
export interface ImageSource {
  src: string
  fallback: string
  avifSrcset: string | null
  webpSrcset: string | null
}

/**
 * Display geometry for an artwork orientation: the CSS `aspect-ratio` plus the
 * intrinsic `width`/`height` to set on the <img> (avoids layout shift and sizes
 * the placeholder/`artworkImage` request to match). The catalogue mixes portrait
 * and landscape pieces, so the media adapts instead of cropping into a fixed box.
 */
export function artworkGeometry(orientation: ArtworkOrientation): {
  ratio: string
  width: number
  height: number
} {
  switch (orientation) {
    case "landscape":
      return { ratio: "3 / 2", width: 1200, height: 800 }
    case "square":
      return { ratio: "1 / 1", width: 1000, height: 1000 }
    default:
      return { ratio: "4 / 5", width: 800, height: 1000 }
  }
}

/**
 * Uniform geometry for catalogue cards. Every card shares one ratio so the grid
 * reads as an even gallery hang; the image fills it with `object-fit: cover`
 * (mixed orientations are cropped to the card box). The detail page keeps each
 * piece's true orientation via {@link artworkGeometry}.
 */
export const CARD_GEOMETRY = { ratio: "4 / 5", width: 800, height: 1000 } as const

/**
 * `sizes` of the layouts that show catalogue images (story 9.6), so the browser
 * fetches the width it will actually display. Cards: one column on a phone, two
 * from 560px, three from 960px in a container capped near 1150px. Detail media:
 * full width, then one of two columns from 960px.
 */
export const IMAGE_SIZES = {
  card: "(min-width: 960px) 370px, (min-width: 560px) 50vw, 100vw",
  detail: "(min-width: 960px) 50vw, 100vw",
  thumb: "(min-width: 760px) 240px, 50vw",
  portrait: "(min-width: 760px) 300px, 100vw",
  full: "100vw",
} as const

/** Human availability label for a limited edition. */
export function availabilityLabel(availableCount: number, editionLimit: number): string {
  if (availableCount <= 0) return "Édition épuisée"
  if (availableCount === 1) return "Dernier exemplaire"
  return `${availableCount} / ${editionLimit} disponibles`
}
