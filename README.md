# scsFirearm — Firearms e-commerce

Nuxt 4 + Fastify + Drizzle + Postgres monorepo for a firearms e-commerce platform (weapons, ammunition, accessories, Gun Art).

## Stack

- **Frontend**: Nuxt 4, Vue 3, PrimeVue (Aura theme)
- **Backend**: Fastify 5 (ESM), Drizzle ORM 0.45, PostgreSQL 17
- **Shared**: Zod (validation), shared types & constants
- **Tooling**: pnpm workspaces, Biome (lint + format), Vitest, strict TypeScript
- **Security**: `@fastify/helmet`, `@fastify/rate-limit`, JWT access + opaque rotating refresh tokens, argon2id password hashing (OWASP 2024 parameters)

## Requirements

- Node ≥ 22 (LTS)
- pnpm ≥ 10
- Docker (for the dev Postgres)

## Quick start

```bash
# 1. Install dependencies
pnpm install

# 2. Configure the API env (set random JWT secrets)
cp apps/api/.env.example apps/api/.env
# edit apps/api/.env if needed (ports, S3, SMTP)

# 3. Start Postgres (host port 5435)
pnpm docker:up

# 4. Apply the schema + seeds (legal categories + products)
pnpm db:migrate
pnpm db:seed

# 5. Start the API (port 8081)
pnpm dev:api
# sanity check: curl http://localhost:8081/health

# 6. (other terminal) Start the Nuxt front (port 3000)
pnpm dev:web
```

## Useful scripts

| Command               | Purpose                                                    |
| --------------------- | ---------------------------------------------------------- |
| `pnpm dev:api`        | Fastify API in watch mode                                  |
| `pnpm dev:web`        | Nuxt dev server                                            |
| `pnpm test`           | Vitest across all packages                                 |
| `pnpm lint`           | Biome lint                                                 |
| `pnpm format`         | Biome format (auto-fix)                                    |
| `pnpm check`          | Biome lint + format combined                               |
| `pnpm verify`         | `biome ci` + typecheck + tests (must pass before commit)   |
| `pnpm db:generate`    | Generate a SQL migration from `schema.ts` (commit the file) |
| `pnpm db:migrate`     | Apply pending migrations (dev, CI and prod)                |
| `pnpm db:push`        | Diff the schema straight into a DB — **prototyping only**, never on a shared or deployed database |
| `pnpm db:seed`        | Run the seeds                                              |
| `pnpm db:studio`      | Drizzle Studio web UI                                      |
| `pnpm docker:up/down` | Dev Postgres lifecycle                                     |

## CI

`.forgejo/workflows/ci.yml` runs Biome, typecheck and the full test suite on every
pull request and on pushes to `main` (Forgejo Actions — requires a registered
`forgejo-runner` with the Docker backend). It spins up a Postgres service and runs
the tests against it with `TEST_DB_SKIP_PROVISION=true`, which tells the vitest
global setup to skip the docker drop/create and migrate + seed the existing
service database.

Locally, tests auto-provision a throwaway `armurier_test` database — see
`apps/api/src/test/global-setup.ts` — so they never touch dev data. Both paths
build the schema by **applying the migrations**, so CI, dev and prod are created
the same way and cannot drift. Run the same gate locally with `pnpm verify`.

## Database schema

`apps/api/src/db/schema.ts` is what you edit; `apps/api/drizzle/` holds the
generated SQL and is the deployment source of truth. The flow:

```bash
# 1. edit schema.ts, then generate the migration
pnpm db:generate        # writes apps/api/drizzle/NNNN_*.sql

# 2. review the SQL, commit it with the schema change

# 3. apply it
pnpm db:migrate         # dev; CI and prod run the same command
```

Never hand-write ALTERs against a database: a migration that isn't in `drizzle/`
doesn't exist as far as CI and prod are concerned. `db:push` stays available for
throwaway prototyping only.

## Structure

```
.
├── apps/
│   ├── api/                  # Fastify + Drizzle (port 8081)
│   │   ├── src/
│   │   │   ├── auth/              # register / login / refresh / logout
│   │   │   ├── db/
│   │   │   │   ├── schema.ts      # ⚠ schema source of truth
│   │   │   │   ├── client.ts
│   │   │   │   ├── seeds.ts
│   │   │   │   └── seed-cli.ts
│   │   │   ├── env.ts             # Zod-validated env
│   │   │   ├── types.ts
│   │   │   ├── app.ts             # buildApp() factory (used by tests)
│   │   │   └── index.ts           # Fastify entry
│   │   └── drizzle.config.ts
│   └── web/                  # Nuxt 4 (port 3000)
│       ├── app/app.vue
│       └── nuxt.config.ts
├── packages/
│   └── shared/               # Shared types, constants, Zod schemas
│       └── src/{constants,types,validation}.ts
├── docs/
│   ├── ADR/                  # Architecture Decision Records
│   └── ...
├── BACKLOG.md                # ⭐ single source of truth for the roadmap
├── biome.json
├── renovate.json             # 90-day quarantine, grouped updates
├── docker-compose.dev.yml
└── pnpm-workspace.yaml
```

## Auth endpoints (current)

| Method | Path                  | Notes                                                            |
| ------ | --------------------- | ---------------------------------------------------------------- |
| POST   | `/api/auth/register`  | argon2id, RGPD consent recorded, email lowercase normalization   |
| POST   | `/api/auth/login`     | Lockout after 5 failed attempts (15 min auto-unlock), timing-safe |
| POST   | `/api/auth/refresh`   | Rotates the refresh token (single-use), multi-device sessions    |
| POST   | `/api/auth/logout`    | Revokes the supplied refresh token                               |

Access tokens are JWTs (1 h TTL). Refresh tokens are opaque 32-byte values stored as SHA-256 hashes in the `refresh_tokens` table.

## Newsletter (story 11.4)

Segmented opt-in across the three universes (`armurerie`, `collection`, `gun_art`).
One contact carries N subscriptions, each with its own timestamped consent.

| Method | Path                             | Notes                                                          |
| ------ | -------------------------------- | -------------------------------------------------------------- |
| POST   | `/api/newsletter/subscribe`      | Capture only — nothing is mailed and no contact reaches the provider until confirmed |
| POST   | `/api/newsletter/confirm`        | Double opt-in step 2; single-use link, 72 h TTL                 |
| GET    | `/api/newsletter/subscription`   | Segments behind an unsubscribe link (the address is never echoed back) |
| POST   | `/api/newsletter/unsubscribe`    | Per segment, or all; the last one purges the address            |

- **Double opt-in is ours, not the provider's**: consent (when, from which page, which IP/user-agent) is recorded and timestamped in our own database, so it stays provable if the sending provider ever changes.
- **`NewsletterService`** (`apps/api/src/newsletter/`) is the provider-agnostic seam, mirroring `StorageService`. `brevo` speaks the REST API v3 over plain `fetch`; `memory` is the in-process driver used by tests, CI and local dev. Set `NEWSLETTER_DRIVER` plus the `BREVO_*` list ids — nothing Brevo-specific exists outside that folder.
- **GDPR**: a full unsubscribe **erases the address**; the row survives anonymised (email hash + consent/withdrawal timestamps) so a past consent stays provable without keeping personal data. Consent, confirmation and withdrawal are also written to `audit_logs`.
- Our database is the source of truth: a provider outage never blocks a confirmation, it only leaves `provider_synced_at` null.

## Gun Art image protection (story 11.5)

⚠️ **Deterrence, not a guarantee — say so to the client.** Anything a browser displays is in its cache, and a screenshot defeats every client-side trick. Only the first measure below survives one.

| Measure | Where | What it actually buys |
| ------- | ----- | --------------------- |
| Burnt-in watermark | `apps/api/src/artworks/watermark.ts` (sharp + SVG text) | Survives a screenshot and a re-encode — the only real protection for a limited edition |
| Capped public resolution | `ARTWORK_PUBLIC_MAX_WIDTH` (1400 px) | The print-grade file never leaves the private bucket; a stolen visual is unprintable at size |
| Right-click / drag blocking | `ProtectedImage.vue` (Gun Art views only) | Raises the effort of a casual save. Nothing more |

- **Upload**: `POST /api/admin/artworks/:slug/image` (admin) stores the untouched original at `gun-art/originals/<uuid>` (**private**) and publishes only a capped, watermarked derivative at `gun-art/public/<uuid>.webp`. Both keys share one id, so nothing extra is stored on the artwork; replacing a visual deletes the previous pair.
- **Original**: `GET /api/admin/artworks/:slug/image/original` — admin only, `no-store`, sent as an attachment. That is the file order processing prints, and the only route those bytes travel.
- **Aesthetics are configuration**, because the call belongs to the artist: `ARTWORK_WATERMARK_TEXT`, `_POSITION` (`bottom-right` discreet · `center` · `tiled` assumed and crop-proof), `_OPACITY`, `_SCALE`.
- ⚠️ The mark is **SVG text**, so the runtime needs a font: the API image installs `fonts-dejavu-core`. A font-less runtime would publish visuals with an **empty** watermark — a test asserts ink is actually laid down.
- Deliberately **not** applied to armurerie product photos: no reproduction stake there.

## Gun Art editorial: series, themes and artist (story 11.6)

The collection is read **by series**, not only piece by piece. Three notions became tables rather than columns:

| Table | Why a table |
| ----- | ----------- |
| `artists` | The name, bio and portrait used to be duplicated on **every** artwork — an artist page had no source of truth to read. One row now, with the book link |
| `artwork_themes` | A theme carries its own indexable page, so its label must be unique and stable instead of retyped per series |
| `artwork_series` | The editorial unit: title, presentation text, film or universe of reference, display order |

- **Public routes**: `/collection/serie/:slug`, `/collection/theme/:slug`, `/collection/artiste/:slug`. `/collection/artiste` redirects to the sole artist while there is only one, and is `noindex`.
- **API**: `GET /api/artworks/series`, `/series/:slug`, `/themes`, `/themes/:slug`, and `GET /api/artists`, `/api/artists/:slug`.
- ⚠️ **Reserved artwork slugs** — a static segment wins over `/api/artworks/:slug`, so an artwork carrying one of these becomes unreachable: **`images`** (story 11.5), **`series`**, **`themes`**.
- ⚠️ **The artist name left `search_vector`.** A generated column can only read its own row, so moving the artist out of `artworks` took the name out of the index. `search/global.ts` matches it through the join instead — a test locks that down, because the failure mode is a silent empty result.
- ⚠️ **Migration 0005 drops and re-creates the generated column**, which silently takes its GIN index with it; the Drizzle snapshot still believes the index exists, so the migration re-creates `idx_artworks_search` by hand. Migration 0004 backfills `artists` from the old columns before 0005 removes them.
- **The affiliate book link** is stored on the artist (editable from the backoffice, not by redeploy) and rendered `target="_blank" rel="sponsored noopener"`.
- **SEO**: `Person` on the artist page, `CreativeWorkSeries` on a series, `isPartOf` on an artwork; series, themes and artists are in `sitemap.xml` and `llms-full.txt`.

## Engineering principles

1. **Tests-first** — Vitest on every feature; no merge without a test.
2. **DRY** — Shared types/validation/constants live in `packages/shared`.
3. **Security by design** — Zod at boundaries, RBAC, argon2id, audit log.
4. **90-day dependency policy** — No dependency newer than 90 days (except security fixes). Enforced by Renovate.
5. **BMAD** — Stories with acceptance criteria, plan before code, living docs.
6. **Multi-machine** — State lives in the repo (`BACKLOG.md`, `docs/`), not in local memory.

## Workflow

1. Read `BACKLOG.md` to identify the next story.
2. Create a branch `feat/<story-id>-short-desc` from `main`.
3. Write the tests, then the code, then make sure `pnpm verify` is green.
4. Update the BACKLOG (tick the item, add new findings at the bottom).
5. Commit using conventional commits and open a PR referencing the story.

See `docs/ADR/` for the structural decisions.

## Local cohabitation

If you run other Docker projects on the same machine:

- Dev Postgres on **5435** (5432–5434 are often taken).
- Dev API on **8081**.
- Front on **3000** (Nuxt default).

Adjust `apps/api/.env` and `docker-compose.dev.yml` if you hit a conflict.
