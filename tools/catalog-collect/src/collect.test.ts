import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { SupplierAdapter } from "./adapter.js"
import { readCollected, runCollection } from "./collect.js"
import { PoliteClient } from "./http.js"

const pages: Record<string, string> = {
  "https://s.fr/p/1": "REF-1|Produit un",
  "https://s.fr/p/2": "REF-2|Produit deux",
  "https://s.fr/p/2-bis": "ref 2|Produit deux (autre catégorie)",
  "https://s.fr/cms/cgv": "not a product",
  "https://s.fr/p/broken": "|",
}

const adapter: SupplierAdapter = {
  id: "fake",
  supplier: "Fournisseur Test",
  origin: "https://s.fr",
  async *discover() {
    yield* Object.keys(pages)
  },
  parse(html, url) {
    if (!html.includes("|")) return null
    const [supplierSku, name] = html.split("|")
    return {
      supplier: "ignored",
      supplierSku: supplierSku ?? "",
      name: name ?? "",
      imageUrls: [],
      specs: {},
      sourceUrl: url,
    }
  },
}

const client = () =>
  new PoliteClient({
    fetch: async (url) => new Response(pages[url] ?? "", { status: pages[url] ? 200 : 404 }),
    minIntervalMs: 0,
    sleep: async () => {},
  })

describe("runCollection", () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "collect-"))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const opts = () => ({
    outFile: join(dir, "fake.jsonl"),
    errorFile: join(dir, "fake.errors.jsonl"),
    scope: { filters: [] },
  })

  it("collects valid products, skipping duplicates, non-products and broken pages", async () => {
    const report = await runCollection(adapter, client(), opts())
    expect(report).toEqual({ collected: 2, alreadyDone: 0, duplicates: 1, notProducts: 1, failed: 1 })

    const products = await readCollected(opts().outFile)
    expect(products.map((p) => p.supplierSku)).toEqual(["REF-1", "REF-2"])
    // The supplier name is the adapter's, whatever the parser said.
    expect(products.every((p) => p.supplier === "Fournisseur Test")).toBe(true)
    expect(await readFile(opts().errorFile, "utf8")).toContain("https://s.fr/p/broken")
  })

  it("resumes: a second run only fetches what is missing", async () => {
    await runCollection(adapter, client(), { ...opts(), limit: 1 })
    const second = await runCollection(adapter, client(), opts())
    expect(second.alreadyDone).toBe(1)
    expect(second.collected).toBe(1)
    expect((await readCollected(opts().outFile)).map((p) => p.supplierSku)).toEqual(["REF-1", "REF-2"])
  })
})
