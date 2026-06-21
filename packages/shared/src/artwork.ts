import { computePriceTtc, round2 } from "./pricing.js"

/** A purchasable size for an artwork; `priceFactor` scales the base price (1.0 small, 1.5 medium, 2.0 large). */
export interface ArtworkFormat {
  id: string
  name: string
  widthCm: number
  heightCm: number
  priceFactor: number
}

/**
 * How an artwork is framed. Orientation is a property of the *image*, not of the
 * print paper, so it is stored explicitly rather than derived from formats: the
 * same photo can be offered in several paper sizes, and the backoffice must be
 * able to set it directly. The collection grid and detail media adapt their
 * aspect-ratio to this value. `portrait` is the historical default the gallery
 * layout was originally built around.
 */
export const ARTWORK_ORIENTATIONS = ["portrait", "landscape", "square"] as const
export type ArtworkOrientation = (typeof ARTWORK_ORIENTATIONS)[number]

/** Narrow an arbitrary DB/string value to a known orientation, defaulting to `portrait`. */
export function normalizeOrientation(value: unknown): ArtworkOrientation {
  return ARTWORK_ORIENTATIONS.includes(value as ArtworkOrientation) ? (value as ArtworkOrientation) : "portrait"
}

/**
 * Dynamic Gun Art price (HT) for one numbered print.
 *
 *   priceHt = basePriceHt * format.priceFactor + priceIncrementHt * (editionLimit - printNumber)
 *
 * Rarity drives the increment: earlier prints in a limited edition (low
 * `printNumber`) carry a larger bonus, the last print (`printNumber === editionLimit`)
 * carries none. The format only scales the base, never the rarity bonus.
 *
 * Example — print 5/25, medium format (×1.5), base 50€, increment 2€:
 *   50 * 1.5 + 2 * (25 - 5) = 75 + 40 = 115€ HT
 */
export function calculateArtworkPrice(
  basePriceHt: number,
  priceIncrementHt: number,
  editionLimit: number,
  printNumber: number,
  format: Pick<ArtworkFormat, "priceFactor">,
): number {
  if (!Number.isInteger(editionLimit) || editionLimit < 1) {
    throw new RangeError(`editionLimit must be a positive integer, got ${editionLimit}`)
  }
  if (!Number.isInteger(printNumber) || printNumber < 1 || printNumber > editionLimit) {
    throw new RangeError(`printNumber must be an integer in [1, ${editionLimit}], got ${printNumber}`)
  }
  if (format.priceFactor <= 0) {
    throw new RangeError(`format.priceFactor must be > 0, got ${format.priceFactor}`)
  }
  if (basePriceHt < 0 || priceIncrementHt < 0) {
    throw new RangeError("basePriceHt and priceIncrementHt must be >= 0")
  }

  const formatAdjusted = basePriceHt * format.priceFactor
  const rarityBonus = priceIncrementHt * (editionLimit - printNumber)
  return round2(formatAdjusted + rarityBonus)
}

/** Same dynamic price as {@link calculateArtworkPrice}, returned as an HT + TTC breakdown. */
export function calculateArtworkPriceBreakdown(
  basePriceHt: number,
  priceIncrementHt: number,
  editionLimit: number,
  printNumber: number,
  format: Pick<ArtworkFormat, "priceFactor">,
  vatPct: number,
): { priceHt: number; priceTtc: number } {
  const priceHt = calculateArtworkPrice(basePriceHt, priceIncrementHt, editionLimit, printNumber, format)
  return { priceHt, priceTtc: computePriceTtc(priceHt, vatPct) }
}
