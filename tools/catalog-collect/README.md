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

## Pro areas (signed-in collection)

Some suppliers show a reseller what a public visitor cannot see, chiefly **our purchase price**. When this package's `.env` holds a supplier's login, `pnpm collect` signs in first and reads the price from each product page. The triage then uses it as if it came from a price list, unless a price list is configured, which takes precedence.

```dotenv
# tools/catalog-collect/.env — ignored by git and Docker, never pasted anywhere
BGM_LOGIN=…          BGM_PASSWORD=…
CORCAROLI_LOGIN=…    CORCAROLI_PASSWORD=…   # login code, not an e-mail
AGORATEC_LOGIN=…     AGORATEC_PASSWORD=…
```

The rules that protect the client's accounts:

- **Read-only.** The tool signs in once and reads pages. It never follows a logout link and never touches the account.
- **robots.txt applies to the sign-in too.** If a site disallows its login page, the tool does not sign in there.
- **A refused sign-in is never retried.** A second wrong attempt is how an account gets locked. Fix `.env` and run again.
- **A lost session stops the run.** Every page must still be served signed in. Otherwise the run stops with `SessionLostError` before caching the page, so public pages are never collected as pro ones. Run it again: it resumes.
- **Separate cache.** Signed-in pages are cached under `work/cache/<supplier>-pro/`, never mixed with public pages.
- **A doubtful price is left out.** The price is read only from a signed-in page and only from the block the pro area prints it in. BGM must label it `HT`. The public JSON-LD price is never used.
- Products collected publicly **before** a pro run have no price, and the resume skips them. Delete `work/collected/<supplier>.jsonl` to collect them again signed in.

| Supplier | What the pro area adds |
|---|---|
| BGM Winfield | Purchase price excl. VAT, plus a resale coefficient (not kept). No EAN, no stock quantity, no downloadable price list. |
| Cor Caroli (and Agora-Tec, same platform) | "Votre prix", excl. VAT per their terms of sale ("nets hors taxes départ stock"). No EAN. |
| ESP France | "Prix Revendeur … HT", but **not used**: its `robots.txt` disallows `/authentication.php`, and the client chose to stay strict (2026-10-07). Prices come from ESP's price list. |
| ClearMyVault | Not collectable: the shop is behind an anti-bot challenge (LWS / Anubis). Ask the maker for its catalogue. |

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
