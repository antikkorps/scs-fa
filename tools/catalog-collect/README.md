# Catalogue collection (story 12.2)

One-off tooling that collects supplier product sheets and builds the **triage workbook** the client sorts before a single import in the back-office (`/admin/imports`). It runs **locally**, is **never deployed**, and is not a synchronisation.

```
supplier sites ──collect──▶ work/collected/<supplier>.jsonl ──triage──▶ work/tri-catalogues-<date>.xlsx
                                        ▲                                        │ client fills "Importer"
                     work/price-lists/* (client's price lists)                   ▼  + legal category
                                                                     /admin/imports → preview → import
```

## Commands (from this folder)

```bash
pnpm collect --list                                   # available suppliers
pnpm collect bgm-winfield                             # whole catalogue
pnpm collect humbert --only "^optiques$" --limit 20   # one family, trial run
pnpm triage                                           # build the workbook from everything collected
```

`--only` takes case-insensitive regular expressions matched against the supplier's own category labels, and can be repeated. A collection **resumes**: pages already collected are skipped, so an interrupted run or a re-run after a parser fix picks up where it stopped.

## Politeness

Every request goes through `PoliteClient` (`src/http.ts`). It:

- honours `robots.txt`, including `Crawl-delay`;
- spaces requests to one host by at least 1.5 s;
- backs off on 429 and 5xx responses, honouring `Retry-After`;
- identifies itself with its own `User-Agent`;
- caches every product page under `work/cache/`, so no page is fetched twice.

| Supplier | Discovery | Notes |
|---|---|---|
| Agora-Tec, Cor Caroli | category menu, then session-filtered AJAX listing | Same platform. The category comes from the menu entry. No EAN. |
| BGM Winfield | root category `/2-accueil`, 100 per page | JSON-LD Product. Original images (1080 px) rather than the upscaled ones. |
| Humbert | families, then "Voir plus" batches, then each model's sibling articles | Supplier legal class (C1b, B2abis…) kept in its own column. No EAN. |
| Toro Distribution | product sitemap (whole catalogue) or category pagination | `data-product` JSON. `wholesale_price` is never stored. |
| ESP France | stale sitemap plus the first page of each category | `robots.txt` forbids pagination, so coverage is partial **by design**. |
| Armurerie de Paris | none | `robots.txt` disallows everything and there is no online catalogue. Enter by hand or through the import. |

## `work/` (git-ignored: the client's business data)

- `work/config.json`: see `config.example.json`. For each supplier it holds:
  - `marginPct`: margin on the selling price, the same definition as the profitability report;
  - `priceList`: the file, plus which headers hold the reference, the price and optionally the EAN. The header row is found even under title lines;
  - `rules`: regex on the supplier category or the product name, mapped to a proposed category. A legal category is proposed **only** where a human wrote it into a rule.
- `work/price-lists/`: the suppliers' price lists, `.xlsx` or `.csv`. Excel CSVs in Windows-1252 are handled.
- `work/collected/`: one JSON Lines file per supplier, in the pivot format (`collectedProductSchema` in `@armurier/shared`), plus a `.errors.jsonl` of the pages that failed.

## The triage workbook

The workbook has four sheets:

- **À trier**: one row per article, in exactly the columns the import reads back (`CATALOG_IMPORT_COLUMNS`). Articles that matched the price list come first. There are drop-downs for *Importer*, *Catégorie* and *Catégorie légale*.
- **Prix sans fiche**: price-list references for which no product sheet was collected. Nothing disappears silently.
- **Lisez-moi**: the instructions for the client.
- **Listes** (hidden): the source of the category drop-down.

Reconciliation matches on the **normalised supplier reference** (case, spaces, dashes and dots ignored; leading zeros kept), then on the EAN. A reference that appears twice in a price list is reported as ambiguous. It is **never** resolved by picking one of the two prices.
