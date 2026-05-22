# ADR 0001 — Stack initial & migration du schéma Drizzle

- **Date :** 2026-05-22
- **Statut :** Accepté
- **Décideurs :** Franck, Claude (scaffold session)

## Contexte

Initialisation du projet e-commerce armurier (`scsFirearm`). Le prompt d'initialisation (`docs/PROMPT_CLAUDE_CODE.md`) fournit un schéma Drizzle de ~1 100 lignes et une stack cible. Plusieurs choix ont divergé du prompt initial pour des raisons techniques ou de sécurité.

## Décisions

### 1. Versions et politique d'upgrade

- **Politique 90 jours** : on n'utilise jamais une version publiée il y a moins de 90 jours (sauf fix de sécurité critique). Quarantaine contre les attaques supply-chain (typosquatting, mainteneur compromis).
- **Pinning strict** : versions exactes dans `package.json` (pas de `^` ni `~`).
- **Versions retenues au 2026-05-22** : Fastify 5.7.4, Drizzle ORM 0.45.1, Drizzle Kit 0.31.9, Nuxt 4.3.1, PrimeVue 4.5.4, Vue 3.5.28, Biome 2.4.4, Vitest 4.0.18, Postgres 17-alpine, Node 22 LTS.

### 2. Nuxt 4 plutôt que Nuxt 3

Le prompt spécifiait Nuxt 3, mais Nuxt 4 est stable et >90j. On adopte Nuxt 4 directement. Coût : structure `app/pages` au lieu de `pages/` racine. Bénéfice : pas de migration à faire dans 6 mois.

### 3. ESM strict côté API

`"type": "module"` partout (api + shared + web). Imports relatifs avec extension `.js`. Conséquence : `tsx` (4.21.0) au lieu de `esbuild-register` (CJS-only, présent dans le prompt).

### 4. Migration du schéma Drizzle vers l'API 0.45

Le schéma fourni utilisait des APIs Drizzle dépréciées/supprimées. Cinq patterns ont été migrés :

| Pattern legacy                                            | Pattern 0.45                                       |
| --------------------------------------------------------- | -------------------------------------------------- |
| `(t) => ({ nameIdx: ..., fkX: ... })`                     | `(t) => [ ..., ... ]`                              |
| `foreignKey({ columns, references, onDelete: "..." })`    | `foreignKey({ columns, foreignColumns }).onDelete("...")` |
| `.where(t.col.isNull())` / `.where(t.col.eq("x"))`        | `.where(sql\`...\`)` (les expressions paramétrées sont rejetées par `CREATE INDEX`) |
| `check("name", "raw sql string")`                         | `check("name", sql\`raw sql\`)`                    |
| `.default("[]")` sur `jsonb().$type<T[]>()`               | `.default(sql\`'[]'::jsonb\`)`                     |

Conversion automatisée via deux scripts dans `/tmp/` (non versionnés) ; voir l'historique de la session de scaffold. Le schéma actuel est dans `apps/api/src/db/schema.ts` et fait foi. La copie d'origine dans `docs/schema.ts` a été supprimée pour éviter la confusion.

### 5. Module PrimeVue Nuxt

Le prompt référençait `primevue/nuxt` qui n'existe pas. Le vrai module est `@primevue/nuxt-module` (4.5.4), avec import du preset Aura via `@primevue/themes/aura`.

### 6. Drizzle config moderne

`drizzle.config.ts` utilise `dialect: "postgresql"` + `dbCredentials.url` au lieu de `driver: "pg"` (déprécié).

### 7. Sécurité by design (Phase 0)

- `@fastify/helmet` + `@fastify/rate-limit` activés dès le boot.
- Secrets validés par Zod au démarrage (`env.ts`) — l'API refuse de démarrer si JWT_SECRET < 32 chars.
- JWT secrets random générés via `openssl rand -base64 48` à la création du `.env`.
- Argon2id (`@node-rs/argon2`) prévu pour le hash de password (Phase 1).
- CORS allowlist stricte (pas de `*`).
- `.env` dans `.gitignore` — vérifié.

### 8. Outillage qualité

- **Biome 2.4.4** : lint + format (remplace ESLint + Prettier). Bug connu : `pnpm exec biome` OOM sur ce setup. Workaround : scripts npm appellent `./node_modules/.bin/biome` directement.
- **Vitest 4.0.18** : tests sur api + web + shared. Smoke tests en place.
- **Workflow CI GitHub Actions** : différé (à faire J+1).

### 9. Ports & cohabitation Docker

D'autres projets sur la machine occupent 5432–5434 (Postgres) et 8080 (API). On a choisi 5435 (Postgres dev) et 8081 (API dev). Configurable via `.env`.

## Conséquences

- Le code est aligné avec les APIs Drizzle/Nuxt actuelles, pas de dette technique à la livraison du scaffold.
- Toute personne reprenant le projet doit lire ce fichier avant de toucher le schéma (les patterns legacy ne sont **pas** supportés).
- La politique 90 jours impose de revérifier les dates avant chaque `pnpm add` ; voir mémoire `feedback-dependency-versions`.

## À revoir

- Migration vers `drizzle-kit migrate` (versionné) au lieu de `db:push` quand le schéma se stabilise.
- Réviser le bug Biome `pnpm exec` lors de la prochaine version éligible (>90j) — peut-être résolu en 2.4.5+.
