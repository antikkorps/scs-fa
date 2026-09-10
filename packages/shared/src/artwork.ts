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

/**
 * One format's *theoretical* price range over a whole edition, in HT.
 *
 * Bounds are theoretical on purpose: print numbers are shared by every format
 * (one global counter on `artworks.editionLimit`), so which number a given
 * format ends up selling depends on the order the buyers come in and cannot be
 * known in advance. The guard rail therefore reasons on what each format *could*
 * cost, never on what has actually been sold.
 */
export interface ArtworkPriceBand {
  formatId: string
  formatName: string
  priceFactor: number
  /** Price of the last print (no rarity bonus) — the cheapest this format can ever be. */
  minPriceHt: number
  /** Price of print 1 — the dearest this format can ever be. */
  maxPriceHt: number
}

/** A pair of formats whose price ranges cross: the smaller one can out-price the bigger one. */
export interface ArtworkPriceOverlap {
  lowerFormatId: string
  lowerFormatName: string
  upperFormatId: string
  upperFormatName: string
  /** Dearest print of the smaller format. */
  lowerMaxPriceHt: number
  /** Cheapest print of the bigger format. */
  upperMinPriceHt: number
  /** Largest `priceIncrementHt` that would clear this overlap, the factors being held. */
  maxIncrementHt: number
  /** Smallest `priceFactor` for the bigger format that would clear it, the increment being held. */
  minUpperPriceFactor: number
}

export interface ArtworkPriceGridCell {
  formatId: string
  priceHt: number
  priceTtc: number
  /** True when this price exceeds the cheapest print of a bigger format. */
  overlapping: boolean
}

export interface ArtworkPriceGridRow {
  printNumber: number
  cells: ArtworkPriceGridCell[]
}

export interface ArtworkPriceGridValidation {
  /** Bands sorted by ascending `priceFactor` — the format order the rule reasons on. */
  bands: ArtworkPriceBand[]
  /** Empty when the grid is coherent. */
  overlaps: ArtworkPriceOverlap[]
  valid: boolean
}

export interface ArtworkPriceGrid extends ArtworkPriceGridValidation {
  rows: ArtworkPriceGridRow[]
}

export type ArtworkFormatInput = Pick<ArtworkFormat, "id" | "name" | "priceFactor">

function assertGridInputs(basePriceHt: number, priceIncrementHt: number, editionLimit: number): void {
  if (!Number.isInteger(editionLimit) || editionLimit < 1) {
    throw new RangeError(`editionLimit must be a positive integer, got ${editionLimit}`)
  }
  if (basePriceHt < 0 || priceIncrementHt < 0) {
    throw new RangeError("basePriceHt and priceIncrementHt must be >= 0")
  }
}

/** Bands for every format, ordered from the smallest to the biggest (ties broken by name). */
export function buildArtworkPriceBands(
  basePriceHt: number,
  priceIncrementHt: number,
  editionLimit: number,
  formats: readonly ArtworkFormatInput[],
): ArtworkPriceBand[] {
  assertGridInputs(basePriceHt, priceIncrementHt, editionLimit)

  return formats
    .map((format) => ({
      formatId: format.id,
      formatName: format.name,
      priceFactor: format.priceFactor,
      minPriceHt: calculateArtworkPrice(basePriceHt, priceIncrementHt, editionLimit, editionLimit, format),
      maxPriceHt: calculateArtworkPrice(basePriceHt, priceIncrementHt, editionLimit, 1, format),
    }))
    .sort((a, b) => a.priceFactor - b.priceFactor || a.formatName.localeCompare(b.formatName))
}

/**
 * Client rule: **a smaller format must never out-price a bigger one**, whatever
 * the print numbers involved.
 *
 * With `priceHt = base × factor + increment × (editionLimit − printNumber)`, the
 * rarity bonus is identical across formats, so two consecutive formats stay
 * apart exactly when
 *
 *   base × (factor[n+1] − factor[n])  ≥  increment × (editionLimit − 1)
 *
 * Consecutive pairs are enough: the bands are ordered by factor, so a chain of
 * non-crossing neighbours cannot cross further apart.
 *
 * ⚠️ The decreasing price with the print number is *wanted* by the client — this
 * validates the format grid, it does not "fix" the formula.
 */
export function validateArtworkPriceGrid(
  basePriceHt: number,
  priceIncrementHt: number,
  editionLimit: number,
  formats: readonly ArtworkFormatInput[],
): ArtworkPriceGridValidation {
  const bands = buildArtworkPriceBands(basePriceHt, priceIncrementHt, editionLimit, formats)
  const rarityRange = priceIncrementHt * (editionLimit - 1)
  const overlaps: ArtworkPriceOverlap[] = []

  for (let i = 0; i + 1 < bands.length; i++) {
    const lower = bands[i] as ArtworkPriceBand
    const upper = bands[i + 1] as ArtworkPriceBand
    if (lower.maxPriceHt <= upper.minPriceHt) continue

    const factorDelta = upper.priceFactor - lower.priceFactor
    overlaps.push({
      lowerFormatId: lower.formatId,
      lowerFormatName: lower.formatName,
      upperFormatId: upper.formatId,
      upperFormatName: upper.formatName,
      lowerMaxPriceHt: lower.maxPriceHt,
      upperMinPriceHt: upper.minPriceHt,
      // editionLimit > 1 here: a single-print edition has zero rarity range and
      // strictly increasing factors, so it can never reach this branch.
      maxIncrementHt: round2((basePriceHt * factorDelta) / (editionLimit - 1)),
      minUpperPriceFactor:
        basePriceHt > 0
          ? Math.ceil((lower.priceFactor + rarityRange / basePriceHt) * 100) / 100
          : Number.POSITIVE_INFINITY,
    })
  }

  return { bands, overlaps, valid: overlaps.length === 0 }
}

/**
 * The full `editionLimit × formats` price table, each cell flagged when it
 * breaks the rule above. This is what the admin simulator renders: the client
 * sets his percentages while seeing the consequence.
 */
export function buildArtworkPriceGrid(
  basePriceHt: number,
  priceIncrementHt: number,
  editionLimit: number,
  formats: readonly ArtworkFormatInput[],
  vatPct: number,
): ArtworkPriceGrid {
  const { bands, overlaps, valid } = validateArtworkPriceGrid(basePriceHt, priceIncrementHt, editionLimit, formats)

  const rows: ArtworkPriceGridRow[] = []
  for (let printNumber = 1; printNumber <= editionLimit; printNumber++) {
    rows.push({
      printNumber,
      cells: bands.map((band, i) => {
        const priceHt = calculateArtworkPrice(basePriceHt, priceIncrementHt, editionLimit, printNumber, band)
        // Bands are sorted, so the cheapest bigger format is the very next one.
        const nextBand = bands[i + 1]
        return {
          formatId: band.formatId,
          priceHt,
          priceTtc: computePriceTtc(priceHt, vatPct),
          overlapping: nextBand !== undefined && priceHt > nextBand.minPriceHt,
        }
      }),
    })
  }

  return { bands, overlaps, valid, rows }
}
