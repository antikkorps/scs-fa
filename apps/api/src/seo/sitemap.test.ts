import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { ancientWeapons, artworkSeries, artworkThemes, blogPosts, productCategories, products } from "../db/schema.js"

const PREFIX = "TESTSEO96-"
const SLUG = PREFIX.toLowerCase()

async function categoryId(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(eq(productCategories.slug, slug))
    .limit(1)
  if (!row) throw new Error(`Missing seeded product category: ${slug} (run db:seed)`)
  return row.id
}

interface SitemapPayload {
  products: { slug: string; updatedAt: string; imageUrl: string | null; isAncientWeapon: boolean }[]
  productCategories: { slug: string; updatedAt: string }[]
  series: { slug: string }[]
  themes: { slug: string; updatedAt: string }[]
  blogPosts: { slug: string; updatedAt: string }[]
}

describe("GET /api/seo/sitemap (story 9.6)", () => {
  let app: FastifyInstance
  let data: SitemapPayload

  async function cleanup() {
    const ids = db
      .select({ id: products.id })
      .from(products)
      .where(like(products.sku, `${PREFIX}%`))
    await db.delete(ancientWeapons).where(inArray(ancientWeapons.productId, ids))
    await db.delete(products).where(like(products.sku, `${PREFIX}%`))
    await db.delete(artworkSeries).where(like(artworkSeries.slug, `${SLUG}%`))
    await db.delete(artworkThemes).where(like(artworkThemes.slug, `${SLUG}%`))
    await db.delete(blogPosts).where(like(blogPosts.slug, `${SLUG}%`))
  }

  function product(suffix: string, categoryId: string, published: boolean, updatedAt = new Date()) {
    return {
      sku: `${PREFIX}${suffix}`,
      slug: `${SLUG}${suffix}`,
      name: `Produit ${suffix}`,
      categoryId,
      priceHt: "100.00",
      requiresLegalVerification: false,
      published,
      featuredImageUrl: `/api/media/${suffix}.jpg`,
      updatedAt,
    }
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()

    const accessoire = await categoryId("accessoire-tireur")
    const gunArt = await categoryId("gun-art")
    const inserted = await db
      .insert(products)
      .values([
        product("old", accessoire, true, new Date("2026-01-10T00:00:00Z")),
        product("recent", accessoire, true, new Date("2026-08-01T00:00:00Z")),
        product("draft", accessoire, false),
        product("gunart", gunArt, true),
        product("antique", accessoire, true),
      ])
      .returning({ id: products.id, slug: products.slug })
    const antique = inserted.find((p) => p.slug === `${SLUG}antique`)
    if (!antique) throw new Error("Test product insert returned no row")
    await db.insert(ancientWeapons).values({ productId: antique.id, condition: "bon" })

    const [theme, emptyTheme] = await db
      .insert(artworkThemes)
      .values([
        { slug: `${SLUG}theme`, name: "Thème" },
        { slug: `${SLUG}theme-vide`, name: "Thème vide" },
      ])
      .returning({ id: artworkThemes.id })
    if (!theme || !emptyTheme) throw new Error("Test theme insert returned no row")
    await db.insert(artworkSeries).values([
      { slug: `${SLUG}serie`, title: "Série", themeId: theme.id, published: true },
      { slug: `${SLUG}serie-brouillon`, title: "Brouillon", themeId: emptyTheme.id, published: false },
    ])

    await db.insert(blogPosts).values([
      {
        slug: `${SLUG}article`,
        title: "Article",
        content: "Texte",
        published: true,
        publishedAt: new Date("2026-05-01T00:00:00Z"),
        updatedAt: new Date("2026-06-15T00:00:00Z"),
      },
      { slug: `${SLUG}article-brouillon`, title: "Brouillon", content: "Texte", published: false },
    ])

    const res = await app.inject({ method: "GET", url: "/api/seo/sitemap" })
    expect(res.statusCode).toBe(200)
    data = res.json().data
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  const mine = <T extends { slug: string }>(rows: T[]) => rows.filter((r) => r.slug.startsWith(SLUG))

  it("lists published armurerie products only — never a draft, never a Gun Art backing product", () => {
    const slugs = mine(data.products).map((p) => p.slug)
    expect(slugs).toEqual([`${SLUG}antique`, `${SLUG}old`, `${SLUG}recent`])
  })

  it("carries what a sitemap needs: last modification, main image, and the collection-piece flag", () => {
    const old = data.products.find((p) => p.slug === `${SLUG}old`)
    expect(old?.updatedAt).toBe("2026-01-10T00:00:00.000Z")
    expect(old?.imageUrl).toBe("/api/media/old.jpg")
    expect(old?.isAncientWeapon).toBe(false)
    expect(data.products.find((p) => p.slug === `${SLUG}antique`)?.isAncientWeapon).toBe(true)
  })

  it("dates a category by its most recently modified published product", () => {
    const category = data.productCategories.find((c) => c.slug === "accessoire-tireur")
    expect(category).toBeDefined()
    expect(new Date(category?.updatedAt ?? 0).getTime()).toBeGreaterThanOrEqual(
      new Date("2026-08-01T00:00:00Z").getTime(),
    )
    expect(data.productCategories.map((c) => c.slug)).not.toContain("gun-art")
  })

  it("lists published series, and only the themes that hold one", () => {
    expect(mine(data.series).map((s) => s.slug)).toEqual([`${SLUG}serie`])
    expect(mine(data.themes).map((t) => t.slug)).toEqual([`${SLUG}theme`])
  })

  it("lists published articles, dated by their last edit", () => {
    const posts = mine(data.blogPosts)
    expect(posts.map((p) => p.slug)).toEqual([`${SLUG}article`])
    expect(posts[0]?.updatedAt).toBe("2026-06-15T00:00:00.000Z")
  })
})
