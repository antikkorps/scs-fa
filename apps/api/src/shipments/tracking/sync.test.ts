import { CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { and, eq, inArray, like } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { db } from "../../db/client.js"
import {
  auditLogs,
  legalCategories,
  orders,
  productCategories,
  products,
  productVariants,
  shipmentItems,
  shipments,
  users,
} from "../../db/schema.js"
import type { TrackingProvider, TrackingResult } from "./types.js"

// The registry is chosen once at startup from env, so the suite substitutes it
// rather than handing out API keys: what is under test is what we do with a
// carrier's answer, never the carrier itself.
const { fetchStatus } = vi.hoisted(() => ({ fetchStatus: vi.fn<(n: string) => Promise<TrackingResult>>() }))

const fakeProvider: TrackingProvider = { carriers: ["colissimo"], fetchStatus }

vi.mock("./index.js", () => ({
  trackedCarriers: () => ["colissimo"],
  trackingProviderFor: (carrier: string) => (carrier === "colissimo" ? fakeProvider : null),
}))

const { runShipmentTrackingSync, refreshShipmentTracking } = await import("./sync.js")

const PREFIX = "TESTTRACK-"
const EMAIL = "testtrack-cust@testtrack.local"

describe("carrier tracking sync (story 11.9b)", () => {
  let customerId: string
  let variantId: string
  let orderId: string

  async function cleanup() {
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "testtrack-%"))
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, db.select({ id: shipments.id }).from(shipments)))
    await db.delete(orders).where(inArray(orders.userId, userIds))
    await db.delete(users).where(like(users.email, "testtrack-%"))
    await db.delete(products).where(like(products.sku, `${PREFIX}%`))
  }

  beforeAll(async () => {
    await cleanup()
    const passwordHash = await hash("MotDePasseTresLong123!", { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    const [user] = await db
      .insert(users)
      .values({
        email: EMAIL,
        passwordHash,
        role: "customer",
        firstname: "Test",
        lastname: "Suivi",
        rgpdConsentAt: new Date(),
        rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
      })
      .returning({ id: users.id })
    customerId = user?.id as string

    const [category] = await db
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(eq(productCategories.slug, "arme-longue"))
      .limit(1)
    const [legal] = await db
      .select({ id: legalCategories.id })
      .from(legalCategories)
      .where(eq(legalCategories.category, "none"))
      .limit(1)
    if (!category || !legal) throw new Error("Missing seeded reference data (run db:seed)")

    const [product] = await db
      .insert(products)
      .values({
        sku: `${PREFIX}SCOPE`,
        slug: `${PREFIX.toLowerCase()}scope`,
        name: "Lunette",
        categoryId: category.id,
        legalCategoryId: legal.id,
        priceHt: "100.00",
        requiresLegalVerification: false,
        published: true,
      })
      .returning({ id: products.id })
    const [variant] = await db
      .insert(productVariants)
      .values({ productId: product?.id as string, skuVariant: `${PREFIX}SCOPE-A`, finition: "Std", stockQty: 10 })
      .returning({ id: productVariants.id })
    variantId = variant?.id as string
  })

  afterAll(cleanup)

  beforeEach(async () => {
    fetchStatus.mockReset()
    await db.delete(orders).where(eq(orders.userId, customerId))
    const [order] = await db
      .insert(orders)
      .values({
        userId: customerId,
        paymentStatus: "received",
        legalVerificationStatus: "completed",
        itemsJson: [
          {
            variantId,
            qty: 1,
            priceHt: 100,
            name: "Lunette",
            sku: `${PREFIX}SCOPE-A`,
            category: "arme-longue",
            legalCategory: "none",
            requiresPaymentVirement: false,
          },
        ],
        subtotalHt: "100.00",
        vatAmount: "20.00",
        totalTtc: "120.00",
        shippingStatus: "shipped",
      })
      .returning({ id: orders.id })
    orderId = order?.id as string
  })

  const packParcel = async (overrides: Partial<typeof shipments.$inferInsert> = {}) => {
    const [row] = await db
      .insert(shipments)
      .values({
        orderId,
        position: 1,
        carrier: "colissimo",
        trackingNumber: "6A0001",
        status: "shipped",
        shippedAt: new Date(),
        ...overrides,
      })
      .returning({ id: shipments.id })
    const id = row?.id as string
    // A parcel holds something: the order-level status is derived from the
    // parcels' CONTENT, so an empty one would read as nothing shipped at all.
    await db.insert(shipmentItems).values({ shipmentId: id, variantId, label: "Lunette", qty: 1, part: 1, parts: 1 })
    return id
  }

  const reload = async (id: string) => (await db.select().from(shipments).where(eq(shipments.id, id)).limit(1))[0]
  const orderStatus = async () =>
    (await db.select({ s: orders.shippingStatus }).from(orders).where(eq(orders.id, orderId)).limit(1))[0]?.s

  it("records an arrival, with the carrier's own date and words", async () => {
    const id = await packParcel()
    const deliveredAt = new Date("2026-09-12T14:32:00Z")
    fetchStatus.mockResolvedValue({ state: "delivered", label: "Votre colis est livré.", deliveredAt })

    expect(await runShipmentTrackingSync()).toEqual({ checked: 1, delivered: 1, failed: 0 })

    const parcel = await reload(id)
    expect(parcel?.status).toBe("delivered")
    expect(parcel?.deliveredAt?.toISOString()).toBe(deliveredAt.toISOString())
    expect(parcel?.trackingLabel).toBe("Votre colis est livré.")
    expect(parcel?.trackingCheckedAt).toBeInstanceOf(Date)
    // The order-level status is re-derived from its parcels, never set by hand.
    expect(await orderStatus()).toBe("delivered")
  })

  /** Nobody clicked: the trail has to say what closed the parcel. */
  it("audits an automatic delivery as the system, not as an admin", async () => {
    const id = await packParcel()
    fetchStatus.mockResolvedValue({ state: "delivered", label: "Livré", deliveredAt: new Date() })
    await runShipmentTrackingSync()

    const [entry] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, "shipment"), eq(auditLogs.entityId, id)))
    expect(entry?.userRole).toBe("system")
    expect(entry?.userId).toBeNull()
    expect(entry?.action).toBe("shipment.delivered")
    expect(entry?.newValue).toMatchObject({ source: "carrier_api" })
  })

  it("keeps a travelling parcel travelling, while remembering what it was told", async () => {
    const id = await packParcel()
    fetchStatus.mockResolvedValue({ state: "in_transit", label: "En cours d'acheminement", deliveredAt: null })

    expect(await runShipmentTrackingSync()).toEqual({ checked: 1, delivered: 0, failed: 0 })
    const parcel = await reload(id)
    expect(parcel?.status).toBe("shipped")
    expect(parcel?.deliveredAt).toBeNull()
    expect(parcel?.trackingLabel).toBe("En cours d'acheminement")
  })

  /** ⚠️ An unanswered question is not an answer: nothing may be recorded. */
  it("leaves a parcel untouched when the carrier cannot be reached", async () => {
    const id = await packParcel()
    fetchStatus.mockRejectedValue(new Error("503 Service Unavailable"))

    expect(await runShipmentTrackingSync()).toEqual({ checked: 0, delivered: 0, failed: 1 })
    const parcel = await reload(id)
    expect(parcel?.status).toBe("shipped")
    expect(parcel?.trackingCheckedAt).toBeNull()
    expect(parcel?.trackingLabel).toBeNull()
  })

  it("never touches a parcel that has not left, nor one already delivered", async () => {
    await packParcel({ status: "preparing", shippedAt: null })
    await packParcel({ position: 2, status: "delivered", deliveredAt: new Date(), trackingNumber: "6A0002" })

    expect(await runShipmentTrackingSync()).toEqual({ checked: 0, delivered: 0, failed: 0 })
    expect(fetchStatus).not.toHaveBeenCalled()
  })

  it("skips a carrier nobody can ask, and a parcel with no tracking number", async () => {
    await packParcel({ carrier: "other", trackingNumber: null, trackingUrl: "https://suivi.example/42" })
    await packParcel({ position: 2, carrier: "colissimo", trackingNumber: null })

    expect(await runShipmentTrackingSync()).toEqual({ checked: 0, delivered: 0, failed: 0 })
    expect(fetchStatus).not.toHaveBeenCalled()
  })

  /**
   * ⚠️ One-way only. A human who marked a parcel delivered beats an API that
   * still believes it is moving.
   */
  it("does not unsay a delivery an admin recorded by hand", async () => {
    const id = await packParcel()
    fetchStatus.mockImplementation(async () => {
      // The admin clicks while the carrier is answering us.
      await db.update(shipments).set({ status: "delivered", deliveredAt: new Date() }).where(eq(shipments.id, id))
      return { state: "in_transit", label: "En cours d'acheminement", deliveredAt: null }
    })

    await runShipmentTrackingSync()
    expect((await reload(id))?.status).toBe("delivered")
  })

  it("refreshes a single parcel on demand, through the same path", async () => {
    const id = await packParcel()
    fetchStatus.mockResolvedValue({ state: "delivered", label: "Livré", deliveredAt: new Date() })

    expect(await refreshShipmentTracking(id)).toBe("delivered")
    expect(fetchStatus).toHaveBeenCalledWith("6A0001")
    expect((await reload(id))?.status).toBe("delivered")
  })

  it("truncates a carrier label too long for the column instead of failing the run", async () => {
    const id = await packParcel()
    fetchStatus.mockResolvedValue({ state: "in_transit", label: "x".repeat(400), deliveredAt: null })

    await runShipmentTrackingSync()
    expect((await reload(id))?.trackingLabel).toHaveLength(255)
  })
})
