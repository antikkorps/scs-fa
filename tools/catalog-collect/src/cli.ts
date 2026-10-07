// Command line of the catalogue collection (story 12.2). Run from this package:
//
//   pnpm collect <supplier> [--only <pattern>]... [--limit <n>]
//   pnpm triage [--supplier <id>]... [--out <file.xlsx>]
//   pnpm collect --list
//
// Everything it reads and writes lives under ./work (git-ignored): the page
// cache, the collected products, the supplier price lists and config.json.
// Pro-area logins live in this package's `.env` (git- and Docker-ignored).

import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { type PriceListRow, readPriceList } from "@armurier/shared"
import { readSpreadsheet } from "@armurier/shared/spreadsheet"
import type { Credentials, SupplierAdapter } from "./adapter.js"
import { ADAPTERS, adapterById } from "./adapters/index.js"
import { readCollected, runCollection } from "./collect.js"
import { PoliteClient } from "./http.js"
import {
  buildTriageModel,
  type Category,
  pricesFromCollection,
  type SupplierBatch,
  supplierConfigSchema,
  type TriageConfig,
  triageConfigSchema,
  writeTriageWorkbook,
} from "./triage.js"

const PACKAGE = resolve(import.meta.dirname, "..")
const WORK = join(PACKAGE, "work")
const COLLECTED = join(WORK, "collected")

const log = (message: string) => console.info(`[${new Date().toLocaleTimeString("fr-FR")}] ${message}`)

/** The supplier's pro-area login from `.env`, or null to collect public pages. */
function credentialsFor(adapter: SupplierAdapter): Credentials | null {
  if (!adapter.proLogin) return null
  const login = process.env[`${adapter.proLogin.envPrefix}_LOGIN`]?.trim()
  const password = process.env[`${adapter.proLogin.envPrefix}_PASSWORD`]
  return login && password ? { login, password } : null
}

async function collect(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      only: { type: "string", multiple: true, default: [] },
      limit: { type: "string" },
      list: { type: "boolean", default: false },
    },
  })
  if (values.list || positionals.length === 0) {
    console.info("Suppliers:")
    for (const a of ADAPTERS) console.info(`  ${a.id.padEnd(20)} ${a.supplier} — ${a.origin}`)
    return
  }
  for (const id of positionals) {
    const adapter = adapterById(id)
    if (!adapter) throw new Error(`Unknown supplier "${id}" — see --list`)
    const credentials = credentialsFor(adapter)
    const proLogin = credentials ? adapter.proLogin : undefined
    const client = new PoliteClient({
      // Signed-in pages differ from public ones: they never share a cache.
      cacheDir: join(WORK, "cache", proLogin ? `${id}-pro` : id),
      cookies: true,
      acceptPage: proLogin?.isSignedIn,
      log,
    })
    if (proLogin && credentials) {
      await proLogin.signIn(client, credentials)
      log(`${id}: signed in to the pro area`)
    } else if (adapter.proLogin) {
      log(`${id}: no ${adapter.proLogin.envPrefix}_LOGIN / _PASSWORD in .env — public pages only, no purchase price`)
    }
    log(`${id}: collecting${values.only.length ? ` (only: ${values.only.join(", ")})` : " the whole catalogue"}…`)
    const report = await runCollection(adapter, client, {
      outFile: join(COLLECTED, `${id}.jsonl`),
      errorFile: join(COLLECTED, `${id}.errors.jsonl`),
      scope: { filters: values.only },
      limit: values.limit === undefined ? undefined : Number(values.limit),
      log,
    })
    log(
      `${id}: ${report.collected} new, ${report.alreadyDone} already collected, ${report.duplicates} duplicates, ` +
        `${report.notProducts} non-product pages, ${report.failed} failures`,
    )
  }
}

async function loadConfig(): Promise<TriageConfig> {
  const raw = await readFile(join(WORK, "config.json"), "utf8").catch(() => null)
  return triageConfigSchema.parse(raw ? JSON.parse(raw) : {})
}

async function loadCategories(config: TriageConfig): Promise<Category[]> {
  if (config.categories) return config.categories
  if (!config.apiBaseUrl) {
    log("⚠️  No categories (config.categories or apiBaseUrl): the category column gets no drop-down")
    return []
  }
  const res = await fetch(`${config.apiBaseUrl.replace(/\/$/, "")}/api/product-categories`)
  if (!res.ok) throw new Error(`Categories: HTTP ${res.status} from ${config.apiBaseUrl}`)
  const body = (await res.json()) as { data: Category[] }
  // Gun Art has its own editor: it is never offered to the import.
  return body.data.filter((c) => c.slug !== "gun-art").map(({ slug, name }) => ({ slug, name }))
}

async function triage(args: string[]) {
  const { values } = parseArgs({
    args,
    options: { out: { type: "string" }, supplier: { type: "string", multiple: true, default: [] } },
  })
  const config = await loadConfig()
  const categories = await loadCategories(config)
  // One workbook per supplier keeps each file well under the import's limits
  // (20 000 rows, 15 MB) and lets the client sort one supplier at a time.
  const files = (await readdir(COLLECTED).catch(() => []))
    .filter((f) => f.endsWith(".jsonl") && !f.includes(".errors"))
    .filter((f) => values.supplier.length === 0 || values.supplier.includes(f.replace(/\.jsonl$/, "")))
  if (files.length === 0) {
    throw new Error(
      values.supplier.length > 0
        ? `Nothing collected for ${values.supplier.join(", ")} in ${COLLECTED}`
        : `Nothing collected yet in ${COLLECTED}`,
    )
  }

  const batches: SupplierBatch[] = []
  for (const file of files) {
    const id = file.replace(/\.jsonl$/, "")
    const products = await readCollected(join(COLLECTED, file))
    const supplierConfig = config.suppliers[id] ?? supplierConfigSchema.parse({})
    let prices: PriceListRow[] | null = null
    if (supplierConfig.priceList) {
      const { file: priceFile, sheet, mapping } = supplierConfig.priceList
      const table = await readSpreadsheet(await readFile(resolve(WORK, priceFile)), { sheet })
      const { rows, issues } = readPriceList(table, mapping)
      prices = rows
      log(
        `${id}: price list ${priceFile} — ${rows.length} prices${issues.length ? `, ${issues.length} unreadable lines` : ""}`,
      )
      for (const issue of issues.slice(0, 10)) log(`   line ${issue.line}: ${issue.message}`)
    } else {
      const collected = pricesFromCollection(products)
      if (collected.length > 0) {
        prices = collected
        log(`${id}: no price list — ${collected.length} purchase prices read from the pro area`)
      } else {
        log(`${id}: no price list configured — every article will be "Sans prix"`)
      }
    }
    batches.push({
      supplier: products[0]?.supplier ?? adapterById(id)?.supplier ?? id,
      products,
      prices,
      config: supplierConfig,
    })
  }

  const model = buildTriageModel(batches, categories)
  const label = values.supplier.length > 0 ? `${values.supplier.join("-")}-` : ""
  const out = resolve(values.out ?? join(WORK, `tri-${label}catalogues-${new Date().toISOString().slice(0, 10)}.xlsx`))
  await mkdir(resolve(out, ".."), { recursive: true })
  await writeFile(out, await writeTriageWorkbook(model, categories))
  log(
    `✅ ${out}\n   ${model.rows.length} articles: ${model.stats.matched} matched, ${model.stats.no_price} without price, ` +
      `${model.stats.ambiguous} ambiguous; ${model.orphans.length} prices without a product sheet`,
  )
}

if (existsSync(join(PACKAGE, ".env"))) process.loadEnvFile(join(PACKAGE, ".env"))

const [command, ...rest] = process.argv.slice(2)
try {
  if (command === "collect") await collect(rest)
  else if (command === "triage") await triage(rest)
  else {
    console.error(
      "Usage: cli.ts collect <supplier>… [--only <pattern>] [--limit <n>] | collect --list | triage [--supplier <id>]… [--out <file>]",
    )
    process.exit(2)
  }
} catch (err) {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
