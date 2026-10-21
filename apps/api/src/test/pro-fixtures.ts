// Story 12.8c — accounts and products for the pro circuit's suites (catalogue,
// quote basket, quote requests). Every row carries the suite's tag, so each
// suite cleans only its own.
import { CURRENT_RGPD_CONSENT_VERSION, type OrganisationStatus } from "@armurier/shared"
import { eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { db } from "../db/client.js"
import {
  ancientWeapons,
  auditLogs,
  legalCategories,
  organisations,
  productCategories,
  products,
  productVariants,
  quoteRequests,
  users,
} from "../db/schema.js"

export interface ProFixtures {
  /** A signed-in account: its id and a bearer token. */
  account(options?: { role?: "customer" | "admin"; organisation?: OrganisationStatus }): Promise<Account>
  product(key: string, options?: ProductOptions): Promise<FixtureProduct>
  cleanup(): Promise<void>
}

export interface Account {
  id: string
  email: string
  token: string
  organisationId: string | null
}

export interface ProductOptions {
  audience?: "public" | "pro"
  published?: boolean
  categorySlug?: string
  legalCategory?: "A" | "B" | "C" | "D" | "none"
  priceHt?: number
  /** Makes it a collection piece. */
  ancient?: boolean
}

export interface FixtureProduct {
  id: string
  slug: string
  sku: string
  name: string
  variantId: string
}

let counter = 0

export function proFixtures(app: FastifyInstance, tag: string): ProFixtures {
  const emailSuffix = `@${tag}.local`
  const skuPrefix = `${tag.toUpperCase()}-`

  async function account(options: { role?: "customer" | "admin"; organisation?: OrganisationStatus } = {}) {
    const role = options.role ?? "customer"
    let organisationId: string | null = null
    if (options.organisation) {
      const [organisation] = await db
        .insert(organisations)
        .values({
          legalName: `Armurerie ${tag}`,
          // Unique per run: the SIRET of an open organisation is unique.
          siret: `7${String(Date.now()).slice(-9)}${String(counter++).padStart(4, "0")}`,
          type: "armurier",
          status: options.organisation,
          registryCheck: "verified",
        })
        .returning({ id: organisations.id })
      organisationId = organisation?.id ?? null
    }
    const email = `${role}-${Date.now()}-${counter++}${emailSuffix}`
    const [row] = await db
      .insert(users)
      .values({
        email,
        passwordHash: "$argon2id$unused",
        role,
        firstname: "Jeanne",
        lastname: "Armand",
        organisationId,
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    if (!row) throw new Error("user insert returned no row")
    return { id: row.id, email, organisationId, token: app.jwt.sign({ sub: row.id, role }) }
  }

  async function product(key: string, options: ProductOptions = {}): Promise<FixtureProduct> {
    const categorySlug = options.categorySlug ?? "accessoire-tireur"
    const [category] = await db
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(eq(productCategories.slug, categorySlug))
    const [legal] = await db
      .select({ id: legalCategories.id })
      .from(legalCategories)
      .where(eq(legalCategories.category, options.legalCategory ?? "none"))
    if (!category || !legal) throw new Error(`unknown category ${categorySlug}`)

    const sku = `${skuPrefix}${key}`
    const slug = `${tag}-${key}`.toLowerCase()
    const name = `Article ${key} ${tag}`
    const [created] = await db
      .insert(products)
      .values({
        sku,
        slug,
        name,
        categoryId: category.id,
        legalCategoryId: legal.id,
        priceHt: (options.priceHt ?? 100).toFixed(2),
        vatPct: "20.00",
        stockQty: 10,
        requiresLegalVerification: (options.legalCategory ?? "none") !== "none",
        published: options.published ?? true,
        audience: options.audience ?? "public",
      })
      .returning({ id: products.id })
    if (!created) throw new Error("product insert returned no row")
    if (options.ancient) {
      await db.insert(ancientWeapons).values({ productId: created.id, condition: "bon", isUnique: true })
    }
    const [variant] = await db
      .insert(productVariants)
      .values({ productId: created.id, skuVariant: `${sku}-STD`, couleur: "noir", stockQty: 10, priceDeltaHt: "5.00" })
      .returning({ id: productVariants.id })
    if (!variant) throw new Error("variant insert returned no row")
    return { id: created.id, slug, sku, name, variantId: variant.id }
  }

  async function cleanup() {
    const tagged = await db
      .select({ id: users.id, organisationId: users.organisationId })
      .from(users)
      .where(like(users.email, `%${emailSuffix}`))
    const userIds = tagged.map((row) => row.id)
    const organisationIds = tagged.flatMap((row) => (row.organisationId ? [row.organisationId] : []))
    if (organisationIds.length > 0) {
      const requestIds = db
        .select({ id: quoteRequests.id })
        .from(quoteRequests)
        .where(inArray(quoteRequests.organisationId, organisationIds))
      await db.delete(auditLogs).where(inArray(auditLogs.entityId, requestIds))
      await db.delete(quoteRequests).where(inArray(quoteRequests.organisationId, organisationIds))
    }
    if (userIds.length > 0) {
      await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
      await db.delete(users).where(inArray(users.id, userIds))
    }
    if (organisationIds.length > 0) await db.delete(organisations).where(inArray(organisations.id, organisationIds))
    await db.delete(products).where(like(products.sku, `${skuPrefix}%`))
  }

  return { account, product, cleanup }
}
