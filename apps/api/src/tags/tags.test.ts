import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { productCategories, products, productTags, tags } from "../db/schema.js"

const SKU_PREFIX = "TEST111-"
const TAG_PREFIX = "test111-"

// Two facets, so the OR-within / AND-across behaviour can actually be observed.
const TEST_TAGS = [
  { slug: `${TAG_PREFIX}occasion`, name: "Occasion (test)", facet: "etat" as const },
  { slug: `${TAG_PREFIX}neuf`, name: "Neuf (test)", facet: "etat" as const },
  { slug: `${TAG_PREFIX}avant-1900`, name: "Avant 1900 (test)", facet: "epoque" as const },
]

async function categoryId(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(eq(productCategories.slug, slug))
    .limit(1)
  if (!row) throw new Error(`Missing seeded product category: ${slug} (run db:seed)`)
  return row.id
}

async function slugsFor(query: string): Promise<string[]> {
  const res = await app.inject({ method: "GET", url: `/api/products?limit=100&${query}` })
  expect(res.statusCode).toBe(200)
  return (res.json().data as Array<{ slug: string }>).map((p) => p.slug).filter((s) => s.startsWith(SKU_PREFIX))
}

let app: FastifyInstance

describe("Tags (story 11.1)", () => {
  beforeAll(async () => {
    app = await buildApp()
    await app.ready()

    await db.delete(products).where(like(products.sku, `${SKU_PREFIX}%`))
    await db.delete(tags).where(like(tags.slug, `${TAG_PREFIX}%`))

    const armePoing = await categoryId("arme-poing")
    const gunArt = await categoryId("gun-art")

    const tagRows = await db.insert(tags).values(TEST_TAGS).returning({ id: tags.id, slug: tags.slug })
    const tagId = (slug: string): string => {
      const row = tagRows.find((t) => t.slug === `${TAG_PREFIX}${slug}`)
      if (!row) throw new Error(`Missing test tag: ${slug}`)
      return row.id
    }

    const productRows = await db
      .insert(products)
      .values(
        (
          [
            ["old-used", armePoing],
            ["old-new", armePoing],
            ["modern-used", armePoing],
            ["untagged", armePoing],
            // Gun Art is excluded from the armurerie catalogue; tagging it must
            // not smuggle it back into the listing or into a facet count.
            ["gunart-used", gunArt],
          ] as const
        ).map(([name, category]) => ({
          sku: `${SKU_PREFIX}${name}`,
          slug: `${SKU_PREFIX}${name}`,
          name: `Produit ${name}`,
          categoryId: category,
          priceHt: "500.00",
          requiresLegalVerification: false,
          published: true,
        })),
      )
      .returning({ id: products.id, slug: products.slug })

    const productId = (name: string): string => {
      const row = productRows.find((p) => p.slug === `${SKU_PREFIX}${name}`)
      if (!row) throw new Error(`Missing test product: ${name}`)
      return row.id
    }

    await db.insert(productTags).values([
      { productId: productId("old-used"), tagId: tagId("occasion") },
      { productId: productId("old-used"), tagId: tagId("avant-1900") },
      { productId: productId("old-new"), tagId: tagId("neuf") },
      { productId: productId("old-new"), tagId: tagId("avant-1900") },
      { productId: productId("modern-used"), tagId: tagId("occasion") },
      { productId: productId("gunart-used"), tagId: tagId("occasion") },
    ])
  })

  afterAll(async () => {
    await db.delete(products).where(like(products.sku, `${SKU_PREFIX}%`))
    await db.delete(tags).where(like(tags.slug, `${TAG_PREFIX}%`))
    await app.close()
  })

  it("filters on a single tag", async () => {
    expect((await slugsFor(`tags=${TAG_PREFIX}occasion`)).sort()).toEqual([
      `${SKU_PREFIX}modern-used`,
      `${SKU_PREFIX}old-used`,
    ])
  })

  it("unions tags inside one facet (OR)", async () => {
    // occasion + neuf are both `etat`: the selection widens rather than narrows.
    expect((await slugsFor(`tags=${TAG_PREFIX}occasion,${TAG_PREFIX}neuf`)).sort()).toEqual([
      `${SKU_PREFIX}modern-used`,
      `${SKU_PREFIX}old-new`,
      `${SKU_PREFIX}old-used`,
    ])
  })

  it("intersects tags across facets (AND)", async () => {
    // etat=occasion AND epoque=avant-1900 → only the product carrying both.
    expect(await slugsFor(`tags=${TAG_PREFIX}occasion,${TAG_PREFIX}avant-1900`)).toEqual([`${SKU_PREFIX}old-used`])
  })

  it("combines the two rules: (occasion OR neuf) AND avant-1900", async () => {
    expect((await slugsFor(`tags=${TAG_PREFIX}occasion,${TAG_PREFIX}neuf,${TAG_PREFIX}avant-1900`)).sort()).toEqual([
      `${SKU_PREFIX}old-new`,
      `${SKU_PREFIX}old-used`,
    ])
  })

  it("accepts repeated params as well as a comma-separated list", async () => {
    const repeated = await slugsFor(`tags=${TAG_PREFIX}occasion&tags=${TAG_PREFIX}avant-1900`)
    expect(repeated).toEqual([`${SKU_PREFIX}old-used`])
  })

  it("ignores unknown tag slugs instead of returning nothing", async () => {
    // A renamed or deleted tag still sitting in an indexed URL must not 400 or
    // blank the catalogue — the filter degrades to "no tag filter".
    const all = await slugsFor("")
    expect(await slugsFor("tags=tag-qui-nexiste-pas")).toEqual(all)
  })

  it("keeps an unknown slug harmless while honouring the known ones", async () => {
    expect(await slugsFor(`tags=${TAG_PREFIX}occasion,${TAG_PREFIX}avant-1900,inconnu`)).toEqual([
      `${SKU_PREFIX}old-used`,
    ])
  })

  it("never lets a tagged Gun Art product into the armurerie catalogue", async () => {
    expect(await slugsFor(`tags=${TAG_PREFIX}occasion`)).not.toContain(`${SKU_PREFIX}gunart-used`)
  })

  it("returns each product's tags in the listing payload", async () => {
    const res = await app.inject({ method: "GET", url: `/api/products?limit=100&tags=${TAG_PREFIX}avant-1900` })
    const product = (res.json().data as Array<{ slug: string; tags: Array<{ slug: string; facet: string }> }>).find(
      (p) => p.slug === `${SKU_PREFIX}old-used`,
    )
    expect(product?.tags.map((t) => t.slug).sort()).toEqual([`${TAG_PREFIX}avant-1900`, `${TAG_PREFIX}occasion`])
    expect(product?.tags.find((t) => t.slug === `${TAG_PREFIX}avant-1900`)?.facet).toBe("epoque")
  })

  it("returns an empty tag array for an untagged product", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products?limit=100" })
    const product = (res.json().data as Array<{ slug: string; tags: unknown[] }>).find(
      (p) => p.slug === `${SKU_PREFIX}untagged`,
    )
    expect(product?.tags).toEqual([])
  })

  it("rejects a malformed tag slug", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products?tags=Not%20A%20Slug" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("ValidationError")
  })

  it("rejects more tags than the cap allows", async () => {
    const many = Array.from({ length: 21 }, (_, i) => `tag-${i}`).join(",")
    const res = await app.inject({ method: "GET", url: `/api/products?tags=${many}` })
    expect(res.statusCode).toBe(400)
  })

  it("treats an empty selection as no filter at all", async () => {
    expect(await slugsFor("tags=")).toEqual(await slugsFor(""))
  })

  describe("GET /api/tags", () => {
    it("groups tags by facet, in the declared facet order", async () => {
      const res = await app.inject({ method: "GET", url: "/api/tags" })
      expect(res.statusCode).toBe(200)
      const data = res.json().data as Array<{ facet: string; tags: Array<{ slug: string }> }>
      expect(data.map((g) => g.facet)).toEqual(["etat", "epoque", "caracteristique"])
    })

    it("counts only published armurerie products, excluding Gun Art", async () => {
      const res = await app.inject({ method: "GET", url: "/api/tags" })
      const data = res.json().data as Array<{ facet: string; tags: Array<{ slug: string; productCount: number }> }>
      const occasion = data.flatMap((g) => g.tags).find((t) => t.slug === `${TAG_PREFIX}occasion`)
      // 3 products carry the tag, but the Gun Art one must not be counted.
      expect(occasion?.productCount).toBe(2)
    })

    it("keeps a facet with no tags rather than dropping it", async () => {
      const res = await app.inject({ method: "GET", url: "/api/tags" })
      const data = res.json().data as Array<{ facet: string; tags: unknown[] }>
      expect(data.find((g) => g.facet === "caracteristique")).toBeDefined()
    })
  })
})

// Guard against a stale enum: the two former categories must be gone, since the
// whole point of 11.1 is that state and period are tags, not categories.
describe("product categories after the tag migration", () => {
  it("no longer exposes arme_ancienne or occasion as categories", async () => {
    const rows = await db
      .select({ slug: productCategories.slug })
      .from(productCategories)
      .where(inArray(productCategories.slug, ["arme-ancienne", "occasion"]))
    expect(rows).toEqual([])
  })
})
