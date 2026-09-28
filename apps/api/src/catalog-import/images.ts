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
/** How long a worker owns a claimed image before another may take it over. */
const LEASE_MS = 5 * 60_000
/** Wait before a new attempt, after attempt 1 and attempt 2. */
const RETRY_DELAYS_MS = [30_000, 120_000]
/** A drain waits for a scheduled retry only if it is this close. */
const MAX_DRAIN_WAIT_MS = 5 * 60_000

type Fetcher = (url: string) => Promise<SafeGetResponse>

interface ClaimedImage {
  id: string
  productId: string
  url: string
  attempts: number
}

/**
 * A failure no retry will fix: a 4xx (except 408 and 429, which say "later"),
 * a refused address, a file too large, bytes that are not an image.
 */
function isPermanent(err: unknown): boolean {
  if (err instanceof UnusableImageError) return true
  if (err instanceof SafeFetchError) {
    return /^HTTP 4(?!08|29)\d\d$|Refused|too large|Invalid URL/i.test(err.message)
  }
  return false
}

/**
 * A worker that died mid-download (redeploy, crash) leaves its row pending
 * with an expired lease. Past the last attempt nothing would ever take it
 * again: mark it failed so an admin sees it and can requeue it.
 */
async function reapAbandoned() {
  await db.execute(sql`
    update ${catalogImportImages}
    set status = 'failed', locked_until = null, updated_at = now(),
        error = coalesce(error, 'Interrupted during download')
    where status = 'pending' and attempts >= ${MAX_IMAGE_ATTEMPTS} and locked_until < now()`)
}

/**
 * Claim pending images under a lease: a claimed row is invisible to every
 * other drain (the in-process one, a CLI run, another API instance) until its
 * lease expires. Only the FIRST pending image of each product is claimable —
 * `appendOwnerMedia` appends at the end of the gallery, so fetching strictly in
 * sheet order is what keeps the supplier's first photo the main one, whatever
 * fails and retries in between. Claiming counts as an attempt.
 */
async function claimBatch(limit: number): Promise<ClaimedImage[]> {
  const result = await db.execute<{ id: string; product_id: string; url: string; attempts: number }>(sql`
    update ${catalogImportImages} set attempts = attempts + 1, locked_until = now() + ${`${LEASE_MS} milliseconds`}::interval, updated_at = now()
    where id in (
      select i.id from ${catalogImportImages} i
      where i.status = 'pending' and i.attempts < ${MAX_IMAGE_ATTEMPTS}
        and (i.locked_until is null or i.locked_until <= now())
        and not exists (
          select 1 from ${catalogImportImages} e
          where e.product_id = i.product_id and e.position < i.position and e.status = 'pending'
        )
      order by i.created_at, i.product_id
      limit ${limit}
      for update skip locked
    )
    returning id, product_id, url, attempts`)
  return result.rows.map((r) => ({ id: r.id, productId: r.product_id, url: r.url, attempts: r.attempts }))
}

async function processOne(image: ClaimedImage, alt: string, fetcher: Fetcher): Promise<boolean> {
  try {
    const res = await fetcher(image.url)
    const row = await appendOwnerMedia("product", image.productId, alt, res.body)
    await db
      .update(catalogImportImages)
      .set({ status: "done", mediaId: row.id, error: null, lockedUntil: null, updatedAt: new Date() })
      .where(eq(catalogImportImages.id, image.id))
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const final = isPermanent(err) || image.attempts >= MAX_IMAGE_ATTEMPTS
    const retryIn = RETRY_DELAYS_MS[image.attempts - 1] ?? RETRY_DELAYS_MS.at(-1) ?? 0
    await db
      .update(catalogImportImages)
      .set({
        status: final ? "failed" : "pending",
        error: message.slice(0, 1000),
        // A transient failure is retried later, not in the very next batch.
        lockedUntil: final ? null : new Date(Date.now() + retryIn),
        updatedAt: new Date(),
      })
      .where(eq(catalogImportImages.id, image.id))
    return false
  }
}

/** Process one batch: one image per product, products in parallel. */
export async function processCatalogImageBatch(
  options: { limit?: number; concurrency?: number; fetcher?: Fetcher } = {},
): Promise<{ claimed: number; done: number; failed: number }> {
  const fetcher = options.fetcher ?? ((url: string) => safeGet(url, { maxBytes: MAX_MEDIA_SIZE_BYTES }))
  await reapAbandoned()
  const claimed = await claimBatch(options.limit ?? 40)
  if (claimed.length === 0) return { claimed: 0, done: 0, failed: 0 }

  const names = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(
      inArray(
        products.id,
        claimed.map((c) => c.productId),
      ),
    )
  const altOf = new Map(names.map((n) => [n.id, n.name]))

  let done = 0
  let failed = 0
  const queue = [...claimed]
  const worker = async () => {
    for (let image = queue.shift(); image; image = queue.shift()) {
      if (await processOne(image, altOf.get(image.productId) ?? "Photo du produit", fetcher)) done++
      else failed++
    }
  }
  await Promise.all(Array.from({ length: options.concurrency ?? 4 }, worker))
  return { claimed: claimed.length, done, failed }
}

/** Milliseconds until the next scheduled retry, or null when none is waiting. */
async function nextRetryInMs(): Promise<number | null> {
  const [row] = await db
    .select({ at: sql<Date | null>`min(${catalogImportImages.lockedUntil})` })
    .from(catalogImportImages)
    .where(sql`${catalogImportImages.status} = 'pending' and ${catalogImportImages.attempts} < ${MAX_IMAGE_ATTEMPTS}`)
  if (!row?.at) return null
  return Math.max(0, new Date(row.at).getTime() - Date.now())
}

let draining: Promise<void> | null = null
let rerun = false

/**
 * Drain the whole queue in the background, waiting for scheduled retries when
 * they are close. A call while a drain runs does not start a second one, but
 * makes the running one go round again before stopping — so images queued
 * while it was finishing are never left behind.
 */
export function drainCatalogImages(log: FastifyBaseLogger): Promise<void> {
  if (draining) {
    rerun = true
    return draining
  }
  draining = (async () => {
    try {
      let total = { done: 0, failed: 0 }
      for (;;) {
        rerun = false
        const batch = await processCatalogImageBatch()
        total = { done: total.done + batch.done, failed: total.failed + batch.failed }
        if (batch.claimed > 0 || rerun) continue
        const wait = await nextRetryInMs()
        if (wait === null || wait > MAX_DRAIN_WAIT_MS) break
        await new Promise((resolve) => setTimeout(resolve, wait + 1000))
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

/** Queue counts of several imports, in one query. */
export async function imageQueueStats(importIds: string[]) {
  const stats = new Map<string, { pending: number; done: number; failed: number }>()
  if (importIds.length === 0) return stats
  const rows = await db
    .select({
      importId: catalogImportImages.importId,
      status: catalogImportImages.status,
      n: sql<number>`count(*)::int`,
    })
    .from(catalogImportImages)
    .where(inArray(catalogImportImages.importId, importIds))
    .groupBy(catalogImportImages.importId, catalogImportImages.status)
  for (const r of rows) {
    const entry = stats.get(r.importId) ?? { pending: 0, done: 0, failed: 0 }
    entry[r.status] = r.n
    stats.set(r.importId, entry)
  }
  return stats
}
