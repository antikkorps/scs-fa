# scsFirearm — E-commerce armurier

Monorepo Nuxt 4 + Fastify + Drizzle + Postgres pour un e-commerce armurier (armes, munitions, accessoires, Gun Art).

## Stack

- **Frontend** : Nuxt 4, Vue 3, PrimeVue (theme Aura)
- **Backend** : Fastify 5 (ESM), Drizzle ORM 0.45, PostgreSQL 17
- **Shared** : Zod (validation), types & constantes partagés
- **Outillage** : pnpm workspaces, Biome (lint+format), Vitest, TypeScript strict
- **Sécurité** : `@fastify/helmet`, `@fastify/rate-limit`, JWT + refresh, argon2id (à venir)

## Prérequis

- Node ≥ 22 (LTS)
- pnpm ≥ 10
- Docker (pour Postgres dev)

## Quick start

```bash
# 1. Installer les dépendances
pnpm install

# 2. Configurer l'env api (génère des secrets JWT random)
cp apps/api/.env.example apps/api/.env
# édite apps/api/.env si besoin (ports, S3, SMTP)

# 3. Démarrer Postgres (port hôte 5435)
pnpm docker:up

# 4. Créer les tables + seeds (catégories légales + produits)
pnpm db:push
pnpm db:seed

# 5. Démarrer l'API (port 8081)
pnpm dev:api
# vérifier : curl http://localhost:8081/health

# 6. (autre terminal) Démarrer le front Nuxt (port 3000)
pnpm dev:web
```

## Scripts utiles

| Commande              | Effet                                                    |
| --------------------- | -------------------------------------------------------- |
| `pnpm dev:api`        | API Fastify en watch                                     |
| `pnpm dev:web`        | Nuxt en dev                                              |
| `pnpm test`           | Vitest sur tous les packages                             |
| `pnpm lint`           | Biome lint                                               |
| `pnpm format`         | Biome format (auto-fix)                                  |
| `pnpm check`          | Biome lint + format combinés                             |
| `pnpm verify`         | `biome ci` + typecheck + tests (à passer avant commit)   |
| `pnpm db:push`        | Pousse le schéma vers Postgres (dev, non versionné)      |
| `pnpm db:generate`    | Génère une migration SQL (prod)                          |
| `pnpm db:seed`        | Exécute les seeds                                        |
| `pnpm db:studio`      | UI web Drizzle Studio                                    |
| `pnpm docker:up/down` | Lifecycle du Postgres dev                                |

## Structure

```
.
├── apps/
│   ├── api/                  # Fastify + Drizzle (port 8081)
│   │   ├── src/
│   │   │   ├── db/
│   │   │   │   ├── schema.ts      # ⚠ source de vérité du schéma
│   │   │   │   ├── client.ts
│   │   │   │   ├── seeds.ts
│   │   │   │   └── seed-cli.ts
│   │   │   ├── env.ts             # Zod-validated env
│   │   │   ├── types.ts
│   │   │   └── index.ts           # Fastify entry
│   │   └── drizzle.config.ts
│   └── web/                  # Nuxt 4 (port 3000)
│       ├── app/app.vue
│       └── nuxt.config.ts
├── packages/
│   └── shared/               # Types, constants, Zod schemas partagés
│       └── src/{constants,types,validation}.ts
├── docs/
│   ├── ADR/                  # Architecture Decision Records
│   ├── PROMPT_CLAUDE_CODE.md
│   ├── RESUME_SCHEMA.md
│   ├── CLARIFICATIONS_A_TRANCHER.md
│   └── seeds_and_workflows.ts  # workflow de référence (ts-nocheck, à porter)
├── BACKLOG.md                # ⭐ source unique de vérité du roadmap
├── biome.json
├── docker-compose.dev.yml
└── pnpm-workspace.yaml
```

## Principes d'engineering

1. **Tests-first** — Vitest sur chaque feature, pas de merge sans test.
2. **DRY** — Types/validation/constantes partagés via `packages/shared`.
3. **Security by design** — Zod aux frontières, RBAC, argon2, audit log.
4. **Politique deps 90j** — Aucune dépendance < 90 jours (sauf fix de sécurité).
5. **BMAD** — Stories avec critères d'acceptation, plan avant code, docs vivants.
6. **Multi-machines** — État dans le repo (`BACKLOG.md`, `docs/`), pas dans la mémoire locale.

## Workflow

1. Lire `BACKLOG.md` pour identifier la prochaine story.
2. Créer une branche `feat/<story-id>-short-desc`.
3. Écrire les tests, puis le code, puis vérifier `pnpm verify`.
4. Mettre à jour le BACKLOG (case cochée, nouvelles découvertes en bas).
5. Commit (conventional commits) + PR référençant la story.

Voir `docs/ADR/` pour les décisions structurantes.

## Cohabitation locale

Si tu fais tourner d'autres projets Docker sur la machine :

- Postgres dev sur **5435** (5432–5434 souvent pris).
- API dev sur **8081**.
- Front sur **3000** (défaut Nuxt).

Modifier `apps/api/.env` + `docker-compose.dev.yml` si conflit.
