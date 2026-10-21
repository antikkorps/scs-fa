import { productFiltersSchema } from "@armurier/shared"
import { eq } from "drizzle-orm"
import type { FastifyPluginAsync } from "fastify"
import { products } from "../db/schema.js"
import { validationError } from "../http.js"
import { fetchPublishedProduct } from "../products/detail.js"
import { listCatalogue } from "../products/list.js"
import { proCatalogueVisible } from "../products/visibility.js"
import { proOrganisationOf } from "./access.js"
import { withNetPrices } from "./prices.js"

/**
 * The pro catalogue (story 12.8c): the public armurerie and the products
 * reserved for pros, without public prices. Personal answers: never cached.
 */
export const proCatalogueRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "private, no-store")
  })

  fastify.get("/products", async (request, reply) => {
    const parsed = productFiltersSchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues))
    const organisation = proOrganisationOf(request)
    // Price filters would give the public price away by bisection.
    const filters = { ...parsed.data, minPrice: undefined, maxPrice: undefined }

    const page = await listCatalogue(filters, proCatalogueVisible())
    return reply.send({
      ...page,
      data: page.data.map((item) => withNetPrices(item, item.vatPct, organisation)),
    })
  })

  fastify.get("/products/slug/:slug", async (request, reply) => {
    const slug = (request.params as { slug: string }).slug
    if (typeof slug !== "string" || slug.length === 0 || slug.length > 255) {
      return reply.code(400).send({ error: "ValidationError", message: "Invalid slug" })
    }
    const organisation = proOrganisationOf(request)

    const product = await fetchPublishedProduct(eq(products.slug, slug), proCatalogueVisible())
    if (!product) return reply.code(404).send({ error: "NotFound", message: "Product not found" })

    // Cross-sells carry public prices and belong to the shop's page: left out.
    const { crossSells: _crossSells, variants, ...rest } = product
    return reply.send({
      data: {
        ...withNetPrices(rest, product.vatPct, organisation),
        variants: variants.map((variant) => withNetPrices(variant, product.vatPct, organisation)),
      },
    })
  })
}
