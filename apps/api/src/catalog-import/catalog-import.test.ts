import { CATALOG_IMPORT_COLUMNS, CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { and, eq, inArray, like } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import FormData from "form-data"
import sharp from "sharp"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import {
  auditLogs,
  catalogImportImages,
  catalogImports,
  legalCategories,
  media,
  products,
  suppliers,
  users,
} from "../db/schema.js"
import { SafeFetchError } from "../net/safe-fetch.js"
import { processCatalogImageBatch } from "./images.js"

const PASSWORD = "MotDePasseTresLong123!"
const BASE = "/api/admin/catalog-imports"
// Every supplier of this suite starts with the prefix, so cleanup is exact.
const SUPPLIER = "Testcatimp Fournisseur"
const OTHER_SUPPLIER = "Testcatimp Nouveau"

type Cells = Partial<Record<(typeof CATALOG_IMPORT_COLUMNS)[number]["key"], string>>

const csvCell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
function sheet(rows: Cells[]): Buffer {
  const header = CATALOG_IMPORT_COLUMNS.map((c) => c.header).join(";")
  const lines = rows.map((r) => CATALOG_IMPORT_COLUMNS.map((c) => csvCell(r[c.key] ?? "")).join(";"))
  return Buffer.from([header, ...lines].join("\n"), "utf8")
}

const row = (over: Cells = {}): Cells => ({
  import: "oui",
  supplier: SUPPLIER,
  supplierSku: "RED-DOT-1",
  name: "Testcatimp Viseur point rouge",
  brand: "Aimpoint",
  category: "Aides à la visée",
  legalCategory: "Aucune",
  costPriceHt: "300",
  priceHt: "429,99",
  description: "Viseur compact",
  longDescription: "<p>Fiche <strong>complète</strong></p><script>alert(1)</script>",
  imageUrls: "https://images.example.com/1.jpg | https://images.example.com/2.jpg",
  sourceUrl: "https://supplier.example.com/p/1",
  ...over,
})

describe("admin catalogue import (story 12.2)", () => {
  let app: FastifyInstance
  let adminToken: string
  let customerToken: string

  async function cleanup() {
    const supplierIds = db.select({ id: suppliers.id }).from(suppliers).where(like(suppliers.name, "Testcatimp%"))
    const productIds = db.select({ id: products.id }).from(products).where(inArray(products.supplierId, supplierIds))
    await db.delete(media).where(and(eq(media.ownerType, "product"), inArray(media.ownerId, productIds)))
    await db.delete(products).where(inArray(products.supplierId, supplierIds))
    await db.delete(suppliers).where(like(suppliers.name, "Testcatimp%"))
    const userIds = db.select({ id: users.id }).from(users).where(like(users.email, "testcatimp-%"))
    await db.delete(catalogImports).where(inArray(catalogImports.createdBy, userIds))
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
    await db.delete(users).where(like(users.email, "testcatimp-%"))
  }

  async function makeUser(email: string, role: "customer" | "admin") {
    const passwordHash = await hash(PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    await db.insert(users).values({
      email,
      passwordHash,
      role,
      firstname: "Test",
      lastname: "Import",
      rgpdConsentAt: new Date(),
      rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
    })
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })
    return login.json().accessToken as string
  }

  function upload(url: string, file: Buffer, fields: Record<string, string> = {}, token = adminToken) {
    const form = new FormData()
    for (const [k, v] of Object.entries(fields)) form.append(k, v)
    form.append("file", file, { filename: "tri.csv", contentType: "text/csv" })
    return app.inject({
      method: "POST",
      url,
      headers: { authorization: `Bearer ${token}`, ...form.getHeaders() },
      payload: form,
    })
  }

  async function importFile(file: Buffer, overwrite = false) {
    const preview = await upload(`${BASE}/preview`, file, { overwrite: String(overwrite) })
    expect(preview.statusCode).toBe(200)
    const res = await upload(BASE, file, {
      overwrite: String(overwrite),
      expectedSha256: preview.json().data.fileSha256,
    })
    return { preview: preview.json().data, res }
  }

  const productByRef = async (ref: string) => {
    const [p] = await db
      .select({ product: products, legal: legalCategories.category, supplier: suppliers.name })
      .from(products)
      .innerJoin(suppliers, eq(suppliers.id, products.supplierId))
      .leftJoin(legalCategories, eq(legalCategories.id, products.legalCategoryId))
      .where(and(like(suppliers.name, "Testcatimp%"), eq(products.supplierSku, ref)))
    return p
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await cleanup()
    adminToken = await makeUser("testcatimp-admin@testcatimp.local", "admin")
    customerToken = await makeUser("testcatimp-cust@testcatimp.local", "customer")
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it("refuses anyone but an admin", async () => {
    expect((await app.inject({ method: "GET", url: BASE })).statusCode).toBe(401)
    expect((await upload(`${BASE}/preview`, sheet([row()]), {}, customerToken)).statusCode).toBe(403)
  })

  it("previews without writing anything, row by row", async () => {
    const res = await upload(
      `${BASE}/preview`,
      sheet([
        row(),
        row({ supplierSku: "NO-LEGAL", name: "Testcatimp Sans catégorie légale", legalCategory: "" }),
        row({ supplierSku: "BAD-CAT", name: "Testcatimp Mauvaise catégorie", category: "Inexistante" }),
        row({ supplierSku: "GUNART", name: "Testcatimp Gun Art", category: "gun-art" }),
        row({ supplierSku: "LATER", import: "non" }),
        row({ supplierSku: "NEW-SUP", name: "Testcatimp Autre fournisseur", supplier: OTHER_SUPPLIER }),
      ]),
    )
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data.fileSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(data.summary).toEqual({ create: 2, update: 0, invalid: 3, skipped: 1, images: 4 })
    expect(data.suppliersToCreate.sort()).toEqual([OTHER_SUPPLIER, SUPPLIER].sort())
    // Skipped rows are not echoed back.
    expect(data.rows.map((r: { line: number }) => r.line)).toEqual([2, 3, 4, 5, 7])
    const byLine = new Map(data.rows.map((r: { line: number }) => [r.line, r]))
    expect((byLine.get(3) as { errors: string[] }).errors.join()).toMatch(/Catégorie légale obligatoire/)
    expect((byLine.get(4) as { errors: string[] }).errors.join()).toMatch(/Catégorie inconnue/)
    expect((byLine.get(5) as { errors: string[] }).errors.join()).toMatch(/propre écran/)

    expect(await db.select().from(suppliers).where(like(suppliers.name, "Testcatimp%"))).toEqual([])
  })

  it("refuses a file without the required columns, and a file that is not a spreadsheet", async () => {
    const noColumns = await upload(`${BASE}/preview`, Buffer.from("Nom;Prix\nx;1"))
    expect(noColumns.statusCode).toBe(400)
    expect(noColumns.json().message).toMatch(/Fournisseur/)
    const binary = await upload(`${BASE}/preview`, Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 1, 2]))
    expect(binary.statusCode).toBe(400)
  })

  it("refuses a commit whose file is not the previewed one", async () => {
    const missing = await upload(BASE, sheet([row()]))
    expect(missing.statusCode).toBe(409)
    const wrong = await upload(BASE, sheet([row()]), { expectedSha256: "0".repeat(64) })
    expect(wrong.statusCode).toBe(409)
  })

  it("creates unpublished products, the supplier, and queues the images", async () => {
    const { res } = await importFile(
      sheet([
        row(),
        row({
          supplierSku: "RIFLE-1",
          name: "Testcatimp Carabine",
          category: "arme-longue",
          legalCategory: "B",
          imageUrls: "",
        }),
      ]),
    )
    expect(res.statusCode).toBe(201)
    expect(res.json().data).toMatchObject({ created: 2, updated: 0, suppliersCreated: 1, imagesQueued: 2 })

    const redDot = await productByRef("RED-DOT-1")
    expect(redDot?.product).toMatchObject({
      published: false,
      requiresLegalVerification: false,
      priceHt: "429.99",
      supplierPrice: "300.00",
      costPrice: "300.00",
      brand: "Aimpoint",
      sku: "TESTCATIMP-FOURNISSEUR-REDDOT1",
      slug: "aimpoint-testcatimp-viseur-point-rouge-red-dot-1",
      parcelCount: 1,
    })
    // Rich text is sanitised like the product form does.
    expect(redDot?.product.longDescription).toContain("<strong>complète</strong>")
    expect(redDot?.product.longDescription).not.toContain("script")

    const rifle = await productByRef("RIFLE-1")
    // Derived from the legal category, never from a cell: B needs paperwork and two parcels.
    expect(rifle?.product).toMatchObject({ requiresLegalVerification: true, parcelCount: 2 })
    expect(rifle?.legal).toBe("B")

    const [history] = (
      await app.inject({ method: "GET", url: BASE, headers: { authorization: `Bearer ${adminToken}` } })
    )
      .json()
      .data.filter((h: { fileName: string }) => h.fileName === "tri.csv")
    expect(history).toMatchObject({ createdCount: 2, updatedCount: 0, images: { pending: 2, done: 0, failed: 0 } })
  })

  it("re-importing updates instead of duplicating, and keeps what a human edited", async () => {
    const before = await productByRef("RED-DOT-1")
    await db
      .update(products)
      .set({ description: "Texte retouché à la main", priceHt: "499.00" })
      .where(eq(products.id, before?.product.id as string))

    const { preview, res } = await importFile(
      sheet([row({ supplierSku: "red dot 1", costPriceHt: "310", priceHt: "450", legalCategory: "C" })]),
    )
    expect(preview.summary).toMatchObject({ create: 0, update: 1 })
    expect(preview.rows[0].warnings.join()).toMatch(/Catégorie légale en base \(none\).*conservée/)
    expect(res.json().data).toMatchObject({ created: 0, updated: 1, suppliersCreated: 0, imagesQueued: 0 })

    const after = await productByRef("RED-DOT-1")
    expect(after?.product.id).toBe(before?.product.id)
    expect(after?.product).toMatchObject({
      description: "Texte retouché à la main",
      priceHt: "499.00",
      // The supplier's price is a supplier fact: it always follows.
      supplierPrice: "310.00",
      costPrice: "300.00",
    })
    expect(after?.legal).toBe("none")
  })

  it("overwrites everything when asked to", async () => {
    const { preview, res } = await importFile(
      sheet([row({ costPriceHt: "310", priceHt: "450", legalCategory: "C", description: "Nouvelle" })]),
      true,
    )
    expect(preview.rows[0].warnings.join()).toMatch(/modifiée : none → C/)
    expect(res.statusCode).toBe(201)
    const after = await productByRef("RED-DOT-1")
    expect(after?.product).toMatchObject({
      description: "Nouvelle",
      priceHt: "450.00",
      costPrice: "310.00",
      requiresLegalVerification: true,
    })
    expect(after?.legal).toBe("C")
  })

  it("refuses a new product whose SKU is already taken by another one", async () => {
    const { preview } = await importFile(
      sheet([
        row(),
        row({ supplierSku: "CLASH", name: "Testcatimp Collision", sku: "TESTCATIMP-FOURNISSEUR-REDDOT1" }),
      ]),
    )
    expect(preview.rows[1].action).toBe("invalid")
    expect(preview.rows[1].errors.join()).toMatch(/SKU déjà utilisé/)
  })

  describe("image queue", () => {
    const png = () =>
      sharp({ create: { width: 64, height: 48, channels: 3, background: "#884422" } })
        .png()
        .toBuffer()

    it("downloads queued images into the gallery, in the sheet's order", async () => {
      const seen: string[] = []
      const body = await png()
      const result = await processCatalogImageBatch({
        concurrency: 1,
        fetcher: async (url) => {
          seen.push(url)
          return { body, contentType: "image/png", finalUrl: url }
        },
      })
      expect(result).toMatchObject({ claimed: 2, done: 2, failed: 0 })
      expect(seen).toEqual(["https://images.example.com/1.jpg", "https://images.example.com/2.jpg"])

      const redDot = await productByRef("RED-DOT-1")
      const gallery = await db
        .select()
        .from(media)
        .where(and(eq(media.ownerType, "product"), eq(media.ownerId, redDot?.product.id as string)))
      expect(gallery.map((m) => m.position).sort()).toEqual([0, 1])
      expect(gallery.every((m) => m.alt === redDot?.product.name)).toBe(true)
      expect(redDot?.product.featuredImageUrl).toBeTruthy()

      const queue = await db
        .select()
        .from(catalogImportImages)
        .where(eq(catalogImportImages.productId, redDot?.product.id as string))
      expect(queue.every((q) => q.status === "done" && q.mediaId)).toBe(true)
    })

    it("fails a 404 at once, and lets an admin requeue it", async () => {
      const { res } = await importFile(
        sheet([
          row({
            supplierSku: "BROKEN-IMG",
            name: "Testcatimp Image cassée",
            imageUrls: "https://images.example.com/missing.jpg",
          }),
        ]),
      )
      const importId = res.json().data.importId as string
      const result = await processCatalogImageBatch({
        fetcher: async () => {
          throw new SafeFetchError("HTTP 404")
        },
      })
      expect(result).toMatchObject({ claimed: 1, failed: 1 })

      const auth = { authorization: `Bearer ${adminToken}` }
      const failed = await app.inject({ method: "GET", url: `${BASE}/${importId}/failed-images`, headers: auth })
      expect(failed.json().data).toEqual([
        expect.objectContaining({ url: "https://images.example.com/missing.jpg", error: "HTTP 404", attempts: 1 }),
      ])

      const retry = await app.inject({ method: "POST", url: `${BASE}/${importId}/retry-images`, headers: auth })
      expect(retry.json().data).toEqual({ requeued: 1 })
      const [queued] = await db.select().from(catalogImportImages).where(eq(catalogImportImages.importId, importId))
      expect(queued).toMatchObject({ status: "pending", attempts: 0, error: null })
    })

    it("retries a transient failure, then gives up after the last attempt", async () => {
      const flaky = async () => {
        throw new SafeFetchError("socket hang up")
      }
      const first = await processCatalogImageBatch({ fetcher: flaky })
      expect(first.failed).toBe(1)
      const [still] = await db.select().from(catalogImportImages).where(eq(catalogImportImages.status, "pending"))
      expect(still?.attempts).toBe(1)
      await processCatalogImageBatch({ fetcher: flaky })
      await processCatalogImageBatch({ fetcher: flaky })
      expect(await processCatalogImageBatch({ fetcher: flaky })).toMatchObject({ claimed: 0 })
      const [gaveUp] = await db
        .select()
        .from(catalogImportImages)
        .where(eq(catalogImportImages.id, still?.id as string))
      expect(gaveUp?.status).toBe("failed")
    })
  })
})
