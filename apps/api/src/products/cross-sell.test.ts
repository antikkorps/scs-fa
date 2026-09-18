import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { and, eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { auditLogs, products, users } from "../db/schema.js"
import { env } from "../env.js"

const PASSWORD = "MotDePasseTresLong123!"
const ADMIN_EMAIL = "testxsell-admin@testxsell.local"
const CUSTOMER_EMAIL = "testxsell-cust@testxsell.local"
const PREFIX = "TESTXSELL-"
const BASE = "/api/admin/products"

// ⚠️ Le drapeau est lu à chaque appel, jamais capturé au démarrage : c'est ce
// qui permet de l'allumer ici sans reconstruire l'application.
const flag = env as { CROSS_SELL_ENABLED: boolean }

describe("cross-sell « fréquemment achetés ensemble » (story 11.8)", () => {
  let app: FastifyInstance
  let adminToken: string
  let customerToken: string
  const id: Record<string, string> = {}
  const slug: Record<string, string> = {}

  async function cleanup() {
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "testxsell-%"))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(users).where(like(users.email, "testxsell-%"))
    await db.delete(products).where(like(products.sku, `${PREFIX}%`))
  }

  const asAdmin = (method: "GET" | "PUT", url: string, body?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${adminToken}` }, ...(body ? { payload: body } : {}) })

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()

    const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    for (const [email, role] of [
      [ADMIN_EMAIL, "admin"],
      [CUSTOMER_EMAIL, "customer"],
    ] as const) {
      await db.insert(users).values({
        email,
        passwordHash,
        role,
        firstname: "Test",
        lastname: "XSell",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
    }
    const login = async (email: string) =>
      (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })).json()
        .accessToken as string
    adminToken = await login(ADMIN_EMAIL)
    customerToken = await login(CUSTOMER_EMAIL)

    const catalogue: Array<{
      key: string
      categorySlug: string
      legalCategory: string
      name: string
      stock?: number
    }> = [
      { key: "weaponB", categorySlug: "arme-poing", legalCategory: "B", name: "Pistolet de test" },
      { key: "weaponD", categorySlug: "arme-defense", legalCategory: "D", name: "Spray de test" },
      { key: "scope", categorySlug: "aide-visee", legalCategory: "none", name: "Lunette de test" },
      { key: "gloves", categorySlug: "accessoire-tireur", legalCategory: "none", name: "Gants de test" },
      { key: "ammoB", categorySlug: "munition", legalCategory: "B", name: "Munitions 9×19 de test" },
      {
        key: "soldOut",
        categorySlug: "accessoire-autre",
        legalCategory: "none",
        name: "Étui épuisé de test",
        stock: 0,
      },
    ]
    for (const item of catalogue) {
      const res = await app.inject({
        method: "POST",
        url: BASE,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          sku: `${PREFIX}${item.key}`,
          slug: `testxsell-${item.key.toLowerCase()}`,
          name: item.name,
          categorySlug: item.categorySlug,
          legalCategory: item.legalCategory,
          priceHt: 199,
          stockQty: item.stock ?? 5,
          published: true,
          variants: [],
          tagSlugs: [],
        },
      })
      expect(res.statusCode).toBe(201)
      id[item.key] = res.json().data.id
      slug[item.key] = res.json().data.slug
    }
  })

  afterAll(async () => {
    flag.CROSS_SELL_ENABLED = false
    await cleanup()
    await app.close()
  })

  it("refuses anyone but an admin", async () => {
    expect((await app.inject({ method: "GET", url: `${BASE}/${id.weaponB}/cross-sells` })).statusCode).toBe(401)
    const asCustomer = await app.inject({
      method: "GET",
      url: `${BASE}/${id.weaponB}/cross-sells`,
      headers: { authorization: `Bearer ${customerToken}` },
    })
    expect(asCustomer.statusCode).toBe(403)
  })

  describe("les options proposées à l'admin", () => {
    it("ne propose que des accessoires, jamais une autre arme", async () => {
      const options = (await asAdmin("GET", `${BASE}/${id.weaponB}/cross-sell-options`)).json().data as Array<{
        id: string
      }>
      const ids = options.map((o) => o.id)
      expect(ids).toContain(id.scope)
      expect(ids).toContain(id.ammoB)
      expect(ids).not.toContain(id.weaponD)
      expect(ids).not.toContain(id.weaponB)
    })

    /** Une munition de catégorie B n'a rien à faire sur une arme en vente libre. */
    it("retire ce qui exige plus de formalités que l'arme", async () => {
      const options = (await asAdmin("GET", `${BASE}/${id.weaponD}/cross-sell-options`)).json().data as Array<{
        id: string
      }>
      expect(options.map((o) => o.id)).not.toContain(id.ammoB)
      expect(options.map((o) => o.id)).toContain(id.scope)
    })
  })

  describe("l'enregistrement des associations", () => {
    it("garde l'ordre choisi par l'admin et trace le changement", async () => {
      const res = await asAdmin("PUT", `${BASE}/${id.weaponB}/cross-sells`, {
        accessoryIds: [id.gloves, id.scope, id.ammoB],
      })
      expect(res.statusCode).toBe(200)
      expect((res.json().data as Array<{ id: string }>).map((i) => i.id)).toEqual([id.gloves, id.scope, id.ammoB])

      const [logged] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, id.weaponB), eq(auditLogs.action, "cross_sell.updated")))
        .limit(1)
      expect(logged?.newValue).toEqual({ accessoryIds: [id.gloves, id.scope, id.ammoB] })
    })

    it("remplace la liste entière plutôt que de l'agrandir", async () => {
      const res = await asAdmin("PUT", `${BASE}/${id.weaponB}/cross-sells`, { accessoryIds: [id.scope, id.gloves] })
      expect((res.json().data as Array<{ id: string }>).map((i) => i.id)).toEqual([id.scope, id.gloves])
    })

    it("refuse de suggérer une arme", async () => {
      const res = await asAdmin("PUT", `${BASE}/${id.weaponB}/cross-sells`, { accessoryIds: [id.weaponD] })
      expect(res.statusCode).toBe(409)
    })

    it("refuse un accessoire plus exigeant que l'arme", async () => {
      const res = await asAdmin("PUT", `${BASE}/${id.weaponD}/cross-sells`, { accessoryIds: [id.ammoB] })
      expect(res.statusCode).toBe(409)
      expect(res.json().message).toMatch(/formalités/)
    })

    /** Seule la fiche d'une arme porte le bloc : une munition n'en a pas. */
    it("refuse de poser des suggestions sur autre chose qu'une arme", async () => {
      const res = await asAdmin("PUT", `${BASE}/${id.ammoB}/cross-sells`, { accessoryIds: [id.scope] })
      expect(res.statusCode).toBe(409)
      const detail = (await asAdmin("GET", `${BASE}/${id.ammoB}/cross-sells`)).json().data
      expect(detail.eligible).toBe(false)
      expect(detail.reason).toBeTruthy()
    })

    it("refuse un article inconnu et les doublons", async () => {
      const unknown = await asAdmin("PUT", `${BASE}/${id.weaponB}/cross-sells`, {
        accessoryIds: ["00000000-0000-4000-8000-000000000000"],
      })
      expect(unknown.statusCode).toBe(400)
      const twice = await asAdmin("PUT", `${BASE}/${id.weaponB}/cross-sells`, {
        accessoryIds: [id.scope, id.scope],
      })
      expect(twice.statusCode).toBe(400)
    })
  })

  describe("la fiche publique", () => {
    it("ne montre rien tant que le bloc n'est pas activé", async () => {
      flag.CROSS_SELL_ENABLED = false
      const res = await app.inject({ method: "GET", url: `/api/products/slug/${slug.weaponB}` })
      expect(res.statusCode).toBe(200)
      expect(res.json().crossSells).toEqual([])
    })

    it("montre les suggestions dans l'ordre une fois le bloc activé", async () => {
      flag.CROSS_SELL_ENABLED = true
      await asAdmin("PUT", `${BASE}/${id.weaponB}/cross-sells`, { accessoryIds: [id.gloves, id.scope] })
      const res = await app.inject({ method: "GET", url: `/api/products/slug/${slug.weaponB}` })
      const shown = res.json().crossSells as Array<{ id: string; priceTtc: number }>
      expect(shown.map((c) => c.id)).toEqual([id.gloves, id.scope])
      expect(shown[0]?.priceTtc).toBeGreaterThan(199)
    })

    it("cache un accessoire épuisé ou dépublié", async () => {
      flag.CROSS_SELL_ENABLED = true
      await asAdmin("PUT", `${BASE}/${id.weaponB}/cross-sells`, { accessoryIds: [id.soldOut, id.scope] })
      let shown = (await app.inject({ method: "GET", url: `/api/products/slug/${slug.weaponB}` })).json()
        .crossSells as Array<{ id: string }>
      expect(shown.map((c) => c.id)).toEqual([id.scope])

      await db
        .update(products)
        .set({ published: false })
        .where(eq(products.id, id.scope as string))
      shown = (await app.inject({ method: "GET", url: `/api/products/slug/${slug.weaponB}` })).json()
        .crossSells as Array<{ id: string }>
      expect(shown).toEqual([])
      await db
        .update(products)
        .set({ published: true })
        .where(eq(products.id, id.scope as string))
    })

    /**
     * ⚠️ Les règles sont réappliquées à la lecture : une arme reclassée après
     * coup cesse de proposer ce qui est devenu trop exigeant pour elle.
     */
    it("cesse de proposer une munition B si l'arme repasse en vente libre", async () => {
      flag.CROSS_SELL_ENABLED = true
      await asAdmin("PUT", `${BASE}/${id.weaponB}/cross-sells`, { accessoryIds: [id.ammoB, id.scope] })
      const before = (await app.inject({ method: "GET", url: `/api/products/slug/${slug.weaponB}` })).json()
        .crossSells as Array<{ id: string }>
      expect(before.map((c) => c.id)).toEqual([id.ammoB, id.scope])

      await app.inject({
        method: "PATCH",
        url: `${BASE}/${id.weaponB}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { legalCategory: "D" },
      })
      const after = (await app.inject({ method: "GET", url: `/api/products/slug/${slug.weaponB}` })).json()
        .crossSells as Array<{ id: string }>
      expect(after.map((c) => c.id)).toEqual([id.scope])
    })
  })
})
