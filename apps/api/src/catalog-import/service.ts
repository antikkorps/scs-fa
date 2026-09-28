// Supplier catalogue import (story 12.2) — planning and committing a batch.
//
// The same plan backs both steps: the preview shows it, the commit executes it.
// Recomputing it at commit time (rather than trusting a plan stored between two
// requests) means what gets written is always checked against the database as
// it is NOW, and the file hash proves it is the file the admin reviewed.

import {
  type CatalogImportRow,
  defaultParcelCount,
  type LegalCategory,
  normaliseHeader,
  normaliseSupplierRef,
  parseCatalogImportTable,
} from "@armurier/shared"
import { and, eq, inArray, or, sql } from "drizzle-orm"
import { db } from "../db/client.js"
import {
  ancientWeapons,
  artworks,
  catalogImportImages,
  catalogImports,
  legalCategories,
  media,
  productCategories,
  products,
  suppliers,
} from "../db/schema.js"
import { sanitizeRichTextHtml } from "../sanitize.js"

export class ImportFileError extends Error {}

export type ImportAction = "create" | "update" | "invalid" | "skipped"

interface ExistingProduct {
  id: string
  supplierSku: string
  name: string
  description: string | null
  longDescription: string | null
  brand: string | null
  ean: string | null
  sourceUrl: string | null
  costPrice: string | null
  legalCategory: LegalCategory | null
  mediaCount: number
  managedElsewhere: boolean
}

export interface ImportPlanRow {
  line: number
  action: ImportAction
  errors: string[]
  warnings: string[]
  supplier: string | null
  supplierSku: string | null
  name: string | null
  sku: string | null
  /** Images that will be queued for download by this row. */
  images: number
  data: CatalogImportRow | null
  categoryId: string | null
  categorySlug: string | null
  existing: ExistingProduct | null
}

export interface ImportPlan {
  rows: ImportPlanRow[]
  suppliersToCreate: string[]
  summary: { create: number; update: number; invalid: number; skipped: number; images: number }
}

/** Categories that have their own editor and must never be fed by a bulk import. */
const EXCLUDED_CATEGORY_SLUGS = new Set(["gun-art"])

const supplierKey = (name: string) => name.trim().toLowerCase()
const productKey = (supplierId: string, ref: string) => `${supplierId}|${normaliseSupplierRef(ref)}`

/**
 * Validate a triage sheet against the database and decide what each row does.
 * Nothing is written. `overwrite` only changes the warnings: without it, an
 * existing product keeps everything a human may have edited.
 */
export async function planCatalogImport(table: string[][], overwrite: boolean): Promise<ImportPlan> {
  const { rows: parsed, missingColumns } = parseCatalogImportTable(table)
  if (missingColumns.length > 0) {
    throw new ImportFileError(`Colonnes obligatoires absentes : ${missingColumns.join(", ")}`)
  }

  const rows: ImportPlanRow[] = parsed.map((p) => ({
    line: p.line,
    action: p.status === "valid" ? "create" : p.status,
    errors: [...p.errors],
    warnings: [],
    supplier: p.data?.supplier ?? null,
    supplierSku: p.data?.supplierSku ?? null,
    name: p.data?.name ?? null,
    sku: p.data?.sku ?? null,
    images: 0,
    data: p.data,
    categoryId: null,
    categorySlug: null,
    existing: null,
  }))
  const active = () => rows.filter((r) => r.data && r.action !== "invalid")
  const invalidate = (row: ImportPlanRow, message: string) => {
    row.action = "invalid"
    row.errors.push(message)
  }

  // Categories: by slug, or by the display name the drop-down offers.
  const categories = await db
    .select({ id: productCategories.id, slug: productCategories.slug, name: productCategories.name })
    .from(productCategories)
  const categoryByKey = new Map<string, { id: string; slug: string }>()
  for (const c of categories) {
    categoryByKey.set(c.slug, c)
    categoryByKey.set(normaliseHeader(c.name), c)
  }
  for (const row of active()) {
    const raw = row.data?.category ?? ""
    const cat = categoryByKey.get(raw) ?? categoryByKey.get(normaliseHeader(raw))
    if (!cat) invalidate(row, `Catégorie inconnue : « ${raw} »`)
    else if (EXCLUDED_CATEGORY_SLUGS.has(cat.slug)) invalidate(row, `La catégorie « ${raw} » a son propre écran`)
    else {
      row.categoryId = cat.id
      row.categorySlug = cat.slug
    }
  }

  // Suppliers: an unknown name is created at commit — and listed in the preview,
  // where a typo ("BGM Winfeld") shows up as an unexpected new supplier.
  const supplierRows = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers)
  const supplierIdByKey = new Map(supplierRows.map((s) => [supplierKey(s.name), s.id]))
  const suppliersToCreate = new Map<string, string>()
  for (const row of active()) {
    const name = row.data?.supplier ?? ""
    if (!supplierIdByKey.has(supplierKey(name)) && !suppliersToCreate.has(supplierKey(name))) {
      suppliersToCreate.set(supplierKey(name), name)
    }
  }

  // Existing products of the known suppliers, keyed on the normalised reference.
  const knownSupplierIds = [...new Set(supplierIdByKey.values())]
  const existingByKey = new Map<string, ExistingProduct>()
  if (knownSupplierIds.length > 0) {
    const existing = await db
      .select({
        id: products.id,
        supplierId: products.supplierId,
        supplierSku: products.supplierSku,
        name: products.name,
        description: products.description,
        longDescription: products.longDescription,
        brand: products.brand,
        ean: products.ean,
        sourceUrl: products.sourceUrl,
        costPrice: products.costPrice,
        legalCategory: legalCategories.category,
        mediaCount: sql<number>`(select count(*)::int from ${media} where ${media.ownerType} = 'product' and ${media.ownerId} = ${products.id})`,
        managedElsewhere: sql<boolean>`exists (select 1 from ${artworks} where ${artworks.productId} = ${products.id})
          or exists (select 1 from ${ancientWeapons} where ${ancientWeapons.productId} = ${products.id})`,
      })
      .from(products)
      .leftJoin(legalCategories, eq(legalCategories.id, products.legalCategoryId))
      .where(and(inArray(products.supplierId, knownSupplierIds), sql`${products.supplierSku} is not null`))
    for (const p of existing) {
      if (p.supplierId && p.supplierSku)
        existingByKey.set(productKey(p.supplierId, p.supplierSku), p as ExistingProduct)
    }
  }

  for (const row of active()) {
    const data = row.data as CatalogImportRow
    const supplierId = supplierIdByKey.get(supplierKey(data.supplier))
    const existing = supplierId ? existingByKey.get(productKey(supplierId, data.supplierSku)) : undefined
    if (!existing) continue
    if (existing.managedElsewhere) {
      invalidate(row, "Ce produit est une œuvre ou une arme de collection : il se modifie depuis son propre écran")
      continue
    }
    row.action = "update"
    row.existing = existing
    row.sku = null
    if (existing.legalCategory !== data.legalCategory) {
      row.warnings.push(
        overwrite
          ? `Catégorie légale modifiée : ${existing.legalCategory ?? "—"} → ${data.legalCategory}`
          : `Catégorie légale en base (${existing.legalCategory ?? "—"}) différente du fichier (${data.legalCategory}) : conservée`,
      )
    }
  }

  // A new product must not collide with another one's SKU or page address —
  // neither in the database nor elsewhere in the file.
  const creates = rows.filter((r) => r.action === "create" && r.data)
  if (creates.length > 0) {
    const skus = creates.map((r) => r.data?.sku as string)
    const slugs = creates.map((r) => r.data?.slug as string)
    const taken = await db
      .select({ sku: products.sku, slug: products.slug })
      .from(products)
      .where(or(inArray(products.sku, skus), inArray(products.slug, slugs)))
    const takenSkus = new Set(taken.map((t) => t.sku))
    const takenSlugs = new Set(taken.map((t) => t.slug))
    const fileSkus = new Map<string, number>()
    const fileSlugs = new Map<string, number>()
    for (const row of creates) {
      const { sku, slug } = row.data as CatalogImportRow
      if (takenSkus.has(sku)) invalidate(row, `SKU déjà utilisé par un autre produit : ${sku}`)
      else if (takenSlugs.has(slug)) invalidate(row, `Adresse de page déjà utilisée : ${slug}`)
      else if (fileSkus.has(sku)) invalidate(row, `SKU identique à la ligne ${fileSkus.get(sku)}`)
      else if (fileSlugs.has(slug)) invalidate(row, `Adresse de page identique à la ligne ${fileSlugs.get(slug)}`)
      else {
        fileSkus.set(sku, row.line)
        fileSlugs.set(slug, row.line)
      }
    }
  }

  for (const row of rows) {
    // Images are fetched for a new product, or for an existing one still
    // without a gallery — never piled onto a gallery someone has curated.
    if (row.action === "create" || (row.action === "update" && row.existing?.mediaCount === 0)) {
      row.images = row.data?.imageUrls.length ?? 0
    }
  }

  const count = (a: ImportAction) => rows.filter((r) => r.action === a).length
  return {
    rows,
    suppliersToCreate: [...new Set(active().map((r) => supplierKey(r.data?.supplier ?? "")))]
      .map((k) => suppliersToCreate.get(k))
      .filter((n): n is string => Boolean(n)),
    summary: {
      create: count("create"),
      update: count("update"),
      invalid: count("invalid"),
      skipped: count("skipped"),
      images: rows.reduce((n, r) => n + r.images, 0),
    },
  }
}

export interface CommitResult {
  importId: string
  created: number
  updated: number
  skipped: number
  invalid: number
  suppliersCreated: number
  imagesQueued: number
}

const money = (n: number | null) => (n === null ? null : n.toFixed(2))
const html = (s: string | null) => (s ? sanitizeRichTextHtml(s) : null)

/**
 * Execute a plan in one transaction: either the whole batch lands or none of
 * it does. Invalid rows are left out — the preview showed them, and holding a
 * 2 000-line batch hostage to one typo would help no one; fixing the line and
 * re-importing is safe because the import is idempotent.
 */
export async function commitCatalogImport(
  plan: ImportPlan,
  meta: { fileName: string; fileSha256: string; overwrite: boolean; userId: string | null },
): Promise<CommitResult> {
  return db.transaction(async (tx) => {
    const legal = await tx.select({ id: legalCategories.id, category: legalCategories.category }).from(legalCategories)
    const legalId = new Map(legal.map((l) => [l.category, l.id]))

    if (plan.suppliersToCreate.length > 0) {
      await tx
        .insert(suppliers)
        .values(plan.suppliersToCreate.map((name) => ({ name })))
        .onConflictDoNothing()
    }
    const supplierRows = await tx.select({ id: suppliers.id, name: suppliers.name }).from(suppliers)
    const supplierId = new Map(supplierRows.map((s) => [supplierKey(s.name), s.id]))

    const [imp] = await tx
      .insert(catalogImports)
      .values({
        fileName: meta.fileName.slice(0, 255),
        fileSha256: meta.fileSha256,
        overwrite: meta.overwrite,
        createdBy: meta.userId,
      })
      .returning({ id: catalogImports.id })
    if (!imp) throw new Error("Catalogue import insert returned no row")

    const queue: { productId: string; urls: string[] }[] = []
    let created = 0
    let updated = 0

    for (const row of plan.rows) {
      const data = row.data
      if (!data || !row.categoryId || !row.categorySlug) continue
      const sid = supplierId.get(supplierKey(data.supplier))
      const lid = legalId.get(data.legalCategory)
      if (!sid || !lid) throw new Error(`Unresolved supplier or legal category on line ${row.line}`)

      if (row.action === "create") {
        const [product] = await tx
          .insert(products)
          .values({
            sku: data.sku,
            slug: data.slug,
            name: data.name,
            description: data.description,
            longDescription: html(data.longDescription),
            categoryId: row.categoryId,
            legalCategoryId: lid,
            supplierId: sid,
            supplierSku: data.supplierSku,
            supplierPrice: money(data.costPriceHt),
            costPrice: money(data.costPriceHt),
            brand: data.brand,
            ean: data.ean,
            sourceUrl: data.sourceUrl,
            priceHt: data.priceHt.toFixed(2),
            vatPct: data.vatPct.toFixed(2),
            stockQty: data.stockQty,
            // Derived, never read from the sheet: a category B firearm needs
            // paperwork whatever a cell says.
            requiresLegalVerification: data.legalCategory !== "none",
            parcelCount: defaultParcelCount(data.legalCategory, row.categorySlug),
            // Going live stays a human gesture.
            published: false,
          })
          .returning({ id: products.id })
        if (!product) throw new Error("Product insert returned no row")
        created++
        if (row.images > 0) queue.push({ productId: product.id, urls: data.imageUrls })
      } else if (row.action === "update" && row.existing) {
        const ex = row.existing
        // Supplier facts always follow the supplier; everything a human may
        // have edited is only filled when empty — unless overwrite is asked.
        const fill = <T>(current: T | null, next: T | null) => (meta.overwrite ? (next ?? current) : (current ?? next))
        await tx
          .update(products)
          .set({
            supplierPrice: money(data.costPriceHt) ?? undefined,
            costPrice: fill(ex.costPrice, money(data.costPriceHt)),
            description: fill(ex.description, data.description),
            longDescription: fill(ex.longDescription, html(data.longDescription)),
            brand: fill(ex.brand, data.brand),
            ean: fill(ex.ean, data.ean),
            sourceUrl: fill(ex.sourceUrl, data.sourceUrl),
            ...(meta.overwrite
              ? {
                  name: data.name,
                  categoryId: row.categoryId,
                  legalCategoryId: lid,
                  requiresLegalVerification: data.legalCategory !== "none",
                  priceHt: data.priceHt.toFixed(2),
                  vatPct: data.vatPct.toFixed(2),
                  stockQty: data.stockQty,
                }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(products.id, ex.id))
        updated++
        if (row.images > 0) queue.push({ productId: ex.id, urls: data.imageUrls })
      }
    }

    let imagesQueued = 0
    for (const { productId, urls } of queue) {
      const inserted = await tx
        .insert(catalogImportImages)
        .values(urls.map((url, position) => ({ importId: imp.id, productId, url, position })))
        .onConflictDoNothing()
        .returning({ id: catalogImportImages.id })
      imagesQueued += inserted.length
    }

    const result = {
      importId: imp.id,
      created,
      updated,
      skipped: plan.summary.skipped,
      invalid: plan.summary.invalid,
      suppliersCreated: plan.suppliersToCreate.length,
      imagesQueued,
    }
    await tx
      .update(catalogImports)
      .set({
        createdCount: created,
        updatedCount: updated,
        skippedCount: result.skipped,
        suppliersCreated: result.suppliersCreated,
      })
      .where(eq(catalogImports.id, imp.id))
    return result
  })
}
