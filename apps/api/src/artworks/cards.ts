import { computePriceTtc } from "@armurier/shared"
import { and, asc, desc, eq, type SQL, sql } from "drizzle-orm"
import { db } from "../db/client.js"
import { artists, artworkPrints, artworkSeries, artworks } from "../db/schema.js"

// Aggregated availability / price-from for one artwork card.
const AVAILABLE_COUNT = sql<number>`count(${artworkPrints.id}) filter (where ${artworkPrints.status} = 'available')::int`
const SOLD_COUNT = sql<number>`count(${artworkPrints.id}) filter (where ${artworkPrints.status} = 'sold')::int`
const PRICE_FROM = sql<
  string | null
>`min(${artworkPrints.priceHtUnit}) filter (where ${artworkPrints.status} = 'available')`

/** How a card is ordered: highlighted first on the collection grid, series order inside a series. */
export type ArtworkCardOrder = "collection" | "series"

/**
 * The one query behind every Gun Art grid — the collection, a series, an
 * artist's body of work. Written once so the three surfaces cannot drift apart
 * on availability, price-from or the artist label.
 */
export async function selectArtworkCards(where: SQL | undefined, order: ArtworkCardOrder = "collection") {
  const rows = await db
    .select({
      id: artworks.id,
      slug: artworks.slug,
      title: artworks.title,
      artistName: artists.name,
      artistSlug: artists.slug,
      seriesSlug: artworkSeries.slug,
      seriesTitle: artworkSeries.title,
      description: artworks.description,
      featuredImageUrl: artworks.featuredImageUrl,
      orientation: artworks.orientation,
      editionLimit: artworks.editionLimit,
      editionYear: artworks.editionYear,
      vatPct: artworks.vatPct,
      availableCount: AVAILABLE_COUNT,
      soldCount: SOLD_COUNT,
      priceFromHt: PRICE_FROM,
    })
    .from(artworks)
    .leftJoin(artworkPrints, eq(artworkPrints.artworkId, artworks.id))
    .leftJoin(artists, and(eq(artworks.artistId, artists.id), eq(artists.published, true)))
    // Only a PUBLISHED series is advertised on a card: an artwork attached to a
    // series still in preparation stays visible, simply without its label.
    .leftJoin(artworkSeries, and(eq(artworks.seriesId, artworkSeries.id), eq(artworkSeries.published, true)))
    .where(and(eq(artworks.published, true), where))
    // Joined columns are not aggregated, so they belong in the GROUP BY.
    .groupBy(artworks.id, artists.name, artists.slug, artworkSeries.slug, artworkSeries.title)
    .orderBy(
      ...(order === "series"
        ? [asc(artworks.seriesOrder), asc(artworks.title)]
        : [desc(artworks.featured), desc(artworks.createdAt)]),
    )

  return rows.map((r) => {
    const vatPct = Number(r.vatPct ?? 20)
    const priceFromHt = r.priceFromHt === null ? null : Number(r.priceFromHt)
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      artistName: r.artistName,
      artistSlug: r.artistSlug,
      series: r.seriesSlug ? { slug: r.seriesSlug, title: r.seriesTitle } : null,
      description: r.description,
      featuredImageUrl: r.featuredImageUrl,
      orientation: r.orientation,
      editionLimit: r.editionLimit,
      editionYear: r.editionYear,
      availableCount: r.availableCount,
      soldCount: r.soldCount,
      priceFromHt,
      priceFromTtc: priceFromHt === null ? null : computePriceTtc(priceFromHt, vatPct),
    }
  })
}
