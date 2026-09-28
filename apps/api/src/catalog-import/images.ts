// Image download queue of the catalogue import (story 12.2).
//
// Thousands of supplier images cannot be fetched inside the commit request, so
// the commit only queues them (`catalog_import_images`) and this worker drains
// the queue afterwards. The queue lives in the database: a restart loses
// nothing, and `pnpm catalog:images` resumes it by hand.
//
// Each image goes through the SAME path as an admin upload (`appendOwnerMedia`:
// sharp decode, metadata stripped, every width rendered, gallery order kept),
// and is fetched through `safeGet`, which refuses internal addresses — the URLs
// come from a file, not from us.

import { MAX_MEDIA_SIZE_BYTES } from "@armurier/shared"
import { eq, inArray, sql } from "drizzle-orm"
import type { FastifyBaseLogger } from "fastify"
import { db } from "../db/client.js"
import { catalogImportImages, products } from "../db/schema.js"
import { appendOwnerMedia, UnusableImageError } from "../media/service.js"
import { SafeFetchError, type SafeGetResponse, safeGet } from "../net/safe-fetch.js"

export const MAX_IMAGE_ATTEMPTS = 3

type Fetcher = (url: string) => Promise<SafeGetResponse>

interface ClaimedImage {
  id: string
  productId: string
  url: string
  position: number
  attempts: number
}

/** A failure that no retry will fix: a 4xx, a refused address, bytes that are not an image. */
function isPermanent(err: unknown): boolean {
  if (err instanceof UnusableImageError) return true
  if (err instanceof SafeFetchError) return /^HTTP 4\d\d$|Refused|too large|Invalid URL/i.test(err.message)
  return false
}

/**
 * Claim a batch of pending images. `FOR UPDATE SKIP LOCKED` lets two drains
 * (the in-process one and a CLI run) share the queue without ever processing
 * the same image twice. Claiming counts as an attempt.
 */
async function claimBatch(limit: number): Promise<ClaimedImage[]> {
  const result = await db.execute<{
    id: string
    product_id: string
    url: string
    position: number
    attempts: number
  }>(sql`
    update ${catalogImportImages} set attempts = attempts + 1, updated_at = now()
    where id in (
      select id from ${catalogImportImages}
      where status = 'pending' and attempts < ${MAX_IMAGE_ATTEMPTS}
      order by product_id, position
      limit ${limit}
      for update skip locked
    )
    returning id, product_id, url, position, attempts`)
  // RETURNING follows no particular order: restore the gallery order here.
  return result.rows
    .map((r) => ({ id: r.id, productId: r.product_id, url: r.url, position: r.position, attempts: r.attempts }))
    .sort((a, b) => a.productId.localeCompare(b.productId) || a.position - b.position)
}

async function processOne(image: ClaimedImage, alt: string, fetcher: Fetcher): Promise<boolean> {
  try {
    const res = await fetcher(image.url)
    const row = await appendOwnerMedia("product", image.productId, alt, res.body)
    await db
      .update(catalogImportImages)
      .set({ status: "done", mediaId: row.id, error: null, updatedAt: new Date() })
      .where(eq(catalogImportImages.id, image.id))
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const final = isPermanent(err) || image.attempts >= MAX_IMAGE_ATTEMPTS
    await db
      .update(catalogImportImages)
      .set({ status: final ? "failed" : "pending", error: message.slice(0, 1000), updatedAt: new Date() })
      .where(eq(catalogImportImages.id, image.id))
    return false
  }
}

/**
 * Process one batch. Products are handled in parallel, but the images of one
 * product strictly in order: the gallery order — and so the main visual — is
 * the order of the cell in the triage sheet.
 */
export async function processCatalogImageBatch(
  options: { limit?: number; concurrency?: number; fetcher?: Fetcher } = {},
): Promise<{ claimed: number; done: number; failed: number }> {
  const fetcher = options.fetcher ?? ((url: string) => safeGet(url, { maxBytes: MAX_MEDIA_SIZE_BYTES }))
  const claimed = await claimBatch(options.limit ?? 40)
  if (claimed.length === 0) return { claimed: 0, done: 0, failed: 0 }

  const byProduct = new Map<string, ClaimedImage[]>()
  for (const image of claimed) byProduct.set(image.productId, [...(byProduct.get(image.productId) ?? []), image])
  const names = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(inArray(products.id, [...byProduct.keys()]))
  const altOf = new Map(names.map((n) => [n.id, n.name]))

  let done = 0
  let failed = 0
  const groups = [...byProduct.entries()]
  const worker = async () => {
    for (let next = groups.shift(); next; next = groups.shift()) {
      const [productId, images] = next
      for (const image of images) {
        if (await processOne(image, altOf.get(productId) ?? "Photo du produit", fetcher)) done++
        else failed++
      }
    }
  }
  await Promise.all(Array.from({ length: options.concurrency ?? 4 }, worker))
  return { claimed: claimed.length, done, failed }
}

let draining: Promise<void> | null = null

/**
 * Drain the whole queue in the background. Idempotent while running: a second
 * call joins the drain in progress instead of starting another.
 */
export function drainCatalogImages(log: FastifyBaseLogger): Promise<void> {
  if (draining) return draining
  draining = (async () => {
    try {
      let total = { done: 0, failed: 0 }
      for (;;) {
        const batch = await processCatalogImageBatch()
        if (batch.claimed === 0) break
        total = { done: total.done + batch.done, failed: total.failed + batch.failed }
      }
      log.info({ ...total }, "catalogue import: image queue drained")
    } catch (err) {
      log.error({ err }, "catalogue import: image queue drain aborted")
    } finally {
      draining = null
    }
  })()
  return draining
}

/** Queue counts, per import or overall. */
export async function imageQueueStats(importId?: string) {
  const rows = await db
    .select({ status: catalogImportImages.status, n: sql<number>`count(*)::int` })
    .from(catalogImportImages)
    .where(importId ? eq(catalogImportImages.importId, importId) : undefined)
    .groupBy(catalogImportImages.status)
  const stats = { pending: 0, done: 0, failed: 0 }
  for (const r of rows) stats[r.status] = r.n
  return stats
}
