// Runs one adapter: discover product pages, read each one, validate it against
// the pivot schema and append it to a JSON Lines file. Resumable by design —
// pages already in the file are skipped, so an interrupted collection (or one
// re-run after fixing a parser) picks up where it stopped.

import { appendFile, mkdir, readFile } from "node:fs/promises"
import { dirname } from "node:path"
import { type CollectedProduct, collectedProductSchema, normaliseSupplierRef } from "@armurier/shared"
import type { CollectScope, SupplierAdapter } from "./adapter.js"
import { type PoliteClient, SessionLostError } from "./http.js"

export interface CollectOptions {
  outFile: string
  errorFile: string
  scope: CollectScope
  /** Stop after this many NEW products — for a trial run. */
  limit?: number
  log?: (message: string) => void
}

export interface CollectReport {
  collected: number
  alreadyDone: number
  duplicates: number
  notProducts: number
  failed: number
}

async function readJsonLines(file: string): Promise<unknown[]> {
  const text = await readFile(file, "utf8").catch(() => "")
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as unknown)
}

/** Every product a previous run already wrote to `file`. */
export async function readCollected(file: string): Promise<CollectedProduct[]> {
  return (await readJsonLines(file)).map((row) => collectedProductSchema.parse(row))
}

export async function runCollection(
  adapter: SupplierAdapter,
  client: PoliteClient,
  options: CollectOptions,
): Promise<CollectReport> {
  const log = options.log ?? (() => {})
  await mkdir(dirname(options.outFile), { recursive: true })
  const previous = await readCollected(options.outFile)
  const doneUrls = new Set(previous.map((p) => p.sourceUrl))
  // The same article is often listed under several categories.
  const doneRefs = new Set(previous.map((p) => normaliseSupplierRef(p.supplierSku)))
  const report: CollectReport = { collected: 0, alreadyDone: 0, duplicates: 0, notProducts: 0, failed: 0 }

  for await (const url of adapter.discover(client, options.scope)) {
    if (options.limit !== undefined && report.collected >= options.limit) break
    if (doneUrls.has(url)) {
      report.alreadyDone++
      continue
    }
    doneUrls.add(url)
    try {
      const parsed = adapter.parse(await client.get(url), url)
      if (!parsed) {
        report.notProducts++
        continue
      }
      const product = collectedProductSchema.parse({ ...parsed, supplier: adapter.supplier })
      const ref = normaliseSupplierRef(product.supplierSku)
      if (doneRefs.has(ref)) {
        report.duplicates++
        continue
      }
      doneRefs.add(ref)
      await appendFile(options.outFile, `${JSON.stringify(product)}\n`, "utf8")
      report.collected++
      if (report.collected % 25 === 0) log(`${adapter.id}: ${report.collected} products`)
    } catch (err) {
      // Every page after it would be read signed out: stop, resume later.
      if (err instanceof SessionLostError) throw err
      report.failed++
      const message = err instanceof Error ? err.message : String(err)
      await appendFile(options.errorFile, `${JSON.stringify({ url, error: message.slice(0, 2000) })}\n`, "utf8")
      log(`${adapter.id}: failed on ${url} — ${message.split("\n")[0]}`)
    }
  }
  return report
}
