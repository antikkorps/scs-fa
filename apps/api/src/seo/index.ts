import { and, asc, eq, max, ne } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { db } from "../db/client.js"
import {
  ancientWeapons,
  artists,
  artworkSeries,
  artworks,
  artworkThemes,
  blogPosts,
  productCategories,
  products,
} from "../db/schema.js"

/**
 * GET /api/seo/sitemap — every publicly indexable entity, in one payload (story 9.6).
 *
 * The public listings cannot feed a sitemap: the catalogue is paginated at 100
 * per page, and none of them exposes `updatedAt`. This route carries only what a
 * sitemap needs — slug, last modification, main image — and applies exactly the
 * visibility rules of the public pages, so a URL is listed if and only if it
 * resolves.
 */
export const seoRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/sitemap", async (_request, reply) => {
    const [productRows, categoryRows, artworkRows, seriesRows, themeRows, artistRows, postRows] = await Promise.all([
      // Gun Art products only back the artworks, which live under /collection.
      db
        .select({
          slug: products.slug,
          name: products.name,
          updatedAt: products.updatedAt,
          imageUrl: products.featuredImageUrl,
          isAncientWeapon: ancientWeapons.id,
        })
        .from(products)
        .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
        .leftJoin(ancientWeapons, eq(ancientWeapons.productId, products.id))
        .where(and(eq(products.published, true), ne(productCategories.category, "gun_art")))
        .orderBy(asc(products.slug)),
      // A category page with nothing in it would be thin content: only
      // categories holding at least one published product are listed, dated by
      // their most recently touched product.
      db
        .select({
          slug: productCategories.slug,
          name: productCategories.name,
          updatedAt: max(products.updatedAt),
        })
        .from(productCategories)
        .innerJoin(products, and(eq(products.categoryId, productCategories.id), eq(products.published, true)))
        .where(ne(productCategories.category, "gun_art"))
        .groupBy(productCategories.id)
        .orderBy(asc(productCategories.displayOrder), asc(productCategories.name)),
      db
        .select({
          slug: artworks.slug,
          title: artworks.title,
          updatedAt: artworks.updatedAt,
          imageUrl: artworks.featuredImageUrl,
        })
        .from(artworks)
        .where(eq(artworks.published, true))
        .orderBy(asc(artworks.slug)),
      db
        .select({
          slug: artworkSeries.slug,
          title: artworkSeries.title,
          updatedAt: artworkSeries.updatedAt,
          imageUrl: artworkSeries.coverImageUrl,
        })
        .from(artworkSeries)
        .where(eq(artworkSeries.published, true))
        .orderBy(asc(artworkSeries.slug)),
      // Same rule as the collection page: a theme without a published series is
      // an empty page. Its date is that of its latest series.
      db
        .select({
          slug: artworkThemes.slug,
          updatedAt: max(artworkSeries.updatedAt),
        })
        .from(artworkThemes)
        .innerJoin(artworkSeries, and(eq(artworkSeries.themeId, artworkThemes.id), eq(artworkSeries.published, true)))
        .groupBy(artworkThemes.id)
        .orderBy(asc(artworkThemes.slug)),
      db
        .select({ slug: artists.slug, name: artists.name, updatedAt: artists.updatedAt, imageUrl: artists.portraitUrl })
        .from(artists)
        .where(eq(artists.published, true))
        .orderBy(asc(artists.slug)),
      db
        .select({
          slug: blogPosts.slug,
          title: blogPosts.title,
          updatedAt: blogPosts.updatedAt,
          publishedAt: blogPosts.publishedAt,
          imageUrl: blogPosts.featuredImageUrl,
        })
        .from(blogPosts)
        .where(eq(blogPosts.published, true))
        .orderBy(asc(blogPosts.slug)),
    ])

    return reply.code(200).send({
      data: {
        products: productRows.map(({ isAncientWeapon, ...p }) => ({ ...p, isAncientWeapon: isAncientWeapon !== null })),
        productCategories: categoryRows,
        artworks: artworkRows,
        series: seriesRows,
        themes: themeRows,
        artists: artistRows,
        // An article edited after publication is dated by its last edit.
        blogPosts: postRows.map(({ publishedAt, ...p }) => ({ ...p, updatedAt: p.updatedAt ?? publishedAt })),
      },
    })
  })
}
