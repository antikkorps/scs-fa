# PROMPT D'INITIALISATION - ARMURIER E-COMMERCE

## 🎯 CONTEXTE GLOBAL

Vous initialisez un **e-commerce spécialisé armurier** (armes, munitions, accessoires, Gun Art).

**Stack choisi:**

- Frontend: Nuxt 3 + PrimeVue (Aura theme) + Vite
- Backend: Fastify + PostgreSQL + Drizzle ORM + TypeScript
- Infra: Docker Compose + Hetzner + S3 Scaleway (EU RGPD)
- Paiement: Split automatique (virement pour armes, CB pour accessoires/Gun Art)

**Modèle spécifique:**

- Catégories légales françaises (A, B, C, D)
- Workflow légal strict (upload docs + validation admin 48h)
- Gun Art: Tirage limité (max 25), pricing dynamique par rareté
- VIP illimité (après 1ère arme neuve)
- Paiement splitté en 1 commande (virement + CB)

---

## 📁 STRUCTURE À CRÉER

```
armurier-ecommerce/
├── package.json (monorepo pnpm workspaces)
├── pnpm-workspace.yaml
├── turbo.json (optionnel)
│
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── db/
│   │   │   │   ├── client.ts (Drizzle client connection)
│   │   │   │   ├── schema.ts (schéma complet)
│   │   │   │   ├── migrations/ (auto-généré par Drizzle)
│   │   │   │   └── seeds.ts (catégories légales, produits)
│   │   │   ├── routes/ (à créer après)
│   │   │   ├── services/ (à créer après)
│   │   │   ├── middleware/ (à créer après)
│   │   │   ├── types.ts (types globaux)
│   │   │   ├── env.ts (Zod env validation)
│   │   │   └── index.ts (entry point)
│   │   ├── drizzle.config.ts (Drizzle config)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── Dockerfile
│   │
│   └── web/
│       ├── pages/
│       ├── components/
│       ├── composables/
│       ├── public/
│       ├── nuxt.config.ts
│       ├── package.json
│       ├── tsconfig.json
│       └── Dockerfile
│
├── packages/
│   └── shared/
│       ├── src/
│       │   ├── types.ts (Order, Product, User, etc.)
│       │   ├── constants.ts (énums, catégories légales)
│       │   └── validation.ts (Zod schemas)
│       ├── package.json
│       └── tsconfig.json
│
├── docs/
│   ├── schema.ts (v. finale du schéma Drizzle)
│   ├── seeds_and_workflows.ts (logique métier)
│   ├── RESUME_SCHEMA.md (guide complet + exemples)
│   └── CLARIFICATIONS_A_TRANCHER.md (decisions documentées)
│
├── docker-compose.prod.yml
├── Caddyfile
├── .env.example
└── .gitignore
```

---

## 🚀 ÉTAPES À EXÉCUTER (PHASE 1)

### ÉTAPE 1: Initialiser le monorepo Fastify + Nuxt

```bash
# 1.1 Créer le root
mkdir armurier-ecommerce && cd armurier-ecommerce

# 1.2 Init pnpm workspace
pnpm init -w

# 1.3 Créer structure apps/
mkdir -p apps/{api,web} packages/shared

# 1.4 Init chaque package.json
cd apps/api && pnpm init
cd ../../apps/web && pnpm init
cd ../../packages/shared && pnpm init
cd ../../
```

### ÉTAPE 2: Setup Backend (Fastify)

**Dans `apps/api/`:**

```bash
# 2.1 Installer dépendances
pnpm add fastify @fastify/cors @fastify/jwt
pnpm add drizzle-orm pg
pnpm add zod dotenv
pnpm add -D drizzle-kit typescript @types/node

# 2.2 Créer tsconfig.json
# (voir template plus bas)

# 2.3 Copier EXACTEMENT schema.ts depuis docs/
# apps/api/src/db/schema.ts ← schema.ts complet (880 lignes)

# 2.4 Copier seeds_and_workflows.ts depuis docs/
# apps/api/src/db/seeds.ts ← (modifier import paths)
```

### ÉTAPE 3: Drizzle Setup

**Dans `apps/api/`:**

```bash
# 3.1 Créer drizzle.config.ts
# (contenu fourni plus bas)

# 3.2 Créer db/client.ts
# (contenu fourni plus bas)

# 3.3 Générer les migrations
pnpm drizzle-kit generate:pg --name init

# 3.4 Vérifier migrations/ (créé auto)
```

### ÉTAPE 4: Env & Types

**Dans `apps/api/src/`:**

```bash
# 4.1 Créer env.ts (Zod validation)
# (contenu fourni plus bas)

# 4.2 Créer types.ts (types globaux)
# (contenu fourni plus bas)

# 4.3 Créer .env.example
# (contenu fourni plus bas)
```

### ÉTAPE 5: Entry Point Fastify

**Dans `apps/api/src/index.ts`:**

```typescript
// Contenu fourni plus bas (démarrage basique)
```

### ÉTAPE 6: Setup Frontend (Nuxt 3)

**Dans `apps/web/`:**

```bash
# 6.1 Installer Nuxt 3 + PrimeVue
pnpm add nuxt@latest primevue
pnpm add -D typescript @types/node @nuxt/devtools

# 6.2 Générer structure Nuxt auto
npx nuxi init .

# 6.3 Configurer nuxt.config.ts
# (voir template plus bas)
```

### ÉTAPE 7: Shared Package

**Dans `packages/shared/src/`:**

```bash
# 7.1 Créer types.ts
# (copier types depuis RESUME_SCHEMA.md)

# 7.2 Créer constants.ts
# (énums légaux, catégories)

# 7.3 Créer validation.ts
# (Zod schemas pour commandes, produits, etc.)
```

---

## 📋 FICHIERS À CRÉER - CONTENU EXACT

### 1. `apps/api/drizzle.config.ts`

```typescript
import type { Config } from "drizzle-kit"

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  driver: "pg",
  dbCredentials: {
    connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/armurier",
  },
  verbose: true,
  strict: true,
} satisfies Config
```

### 2. `apps/api/src/db/client.ts`

```typescript
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "./schema"
import { env } from "../env"

const pool = new Pool({
  connectionString: env.DATABASE_URL,
})

export const db = drizzle(pool, { schema })
```

### 3. `apps/api/src/env.ts`

```typescript
import { z } from "zod"

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production"]).default("development"),

  // API
  API_PORT: z.coerce.number().default(8080),
  API_HOST: z.string().default("0.0.0.0"),

  // DB
  DATABASE_URL: z.string().url(),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("1h"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),

  // S3
  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  S3_BUCKET: z.string(),
  S3_REGION: z.string(),

  // SMTP
  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string(),
  SMTP_PASS: z.string(),
  SMTP_FROM: z.string().email(),
})

export const env = envSchema.parse(process.env)
export type Env = z.infer<typeof envSchema>
```

### 4. `apps/api/src/types.ts`

```typescript
import { users, orders, products, artworkPrints } from "./db/schema"
import type { InferSelectModel, InferInsertModel } from "drizzle-orm"

// Select (read) types
export type User = InferSelectModel<typeof users>
export type Order = InferSelectModel<typeof orders>
export type Product = InferSelectModel<typeof products>
export type ArtworkPrint = InferSelectModel<typeof artworkPrints>

// Insert (write) types
export type UserInsert = InferInsertModel<typeof users>
export type OrderInsert = InferInsertModel<typeof orders>

// Custom types for API responses
export type OrderResponse = Omit<Order, "itemsJson"> & {
  itemsJson: Array<{
    variantId?: string
    printId?: string
    qty: number
    priceHt: number
    name: string
    sku: string
    category: string
    requiresPaymentVirement: boolean
  }>
}
```

### 5. `apps/api/src/index.ts`

```typescript
import Fastify from "fastify"
import fastifyJwt from "@fastify/jwt"
import fastifyCors from "@fastify/cors"
import { env } from "./env"
import { db } from "./db/client"
import { seedDatabase } from "./db/seeds"

const fastify = Fastify({
  logger: true,
})

// Plugins
fastify.register(fastifyCors, {
  origin: env.NODE_ENV === "production" ? "https://armurier.fr" : "http://localhost:3000",
  credentials: true,
})

fastify.register(fastifyJwt, {
  secret: env.JWT_SECRET,
  sign: { expiresIn: env.JWT_EXPIRES_IN },
})

// Health check
fastify.get("/health", async (request, reply) => {
  return { status: "ok", timestamp: new Date().toISOString() }
})

// Routes (à implémenter)
// fastify.register(authRoutes, { prefix: '/api/auth' });
// fastify.register(productRoutes, { prefix: '/api/products' });
// etc.

// Start
const start = async () => {
  try {
    console.log("🌱 Seeding database...")
    await seedDatabase()

    await fastify.listen({ host: env.API_HOST, port: env.API_PORT })
    console.log(`✅ Server listening on http://${env.API_HOST}:${env.API_PORT}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
```

### 6. `apps/api/.env.example`

```bash
# Database
DATABASE_URL=postgresql://armurier:password@localhost:5432/armurier_dev

# JWT
JWT_SECRET=your-very-long-secret-key-min-32-chars-here
JWT_REFRESH_SECRET=your-very-long-refresh-secret-key-min-32-chars

# API
API_PORT=8080
API_HOST=0.0.0.0

# S3 (Scaleway EU)
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_ACCESS_KEY=your-scw-access-key
S3_SECRET_KEY=your-scw-secret-key
S3_BUCKET=armurier-dev
S3_REGION=fr-par

# SMTP
SMTP_HOST=mail.ovh.net
SMTP_PORT=587
SMTP_USER=noreply@armurier.fr
SMTP_PASS=your-smtp-password
SMTP_FROM=noreply@armurier.fr

# Node
NODE_ENV=development
```

### 7. `apps/api/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "moduleResolution": "node"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

### 8. `apps/api/package.json` (scripts à ajouter)

```json
{
  "scripts": {
    "dev": "node -r esbuild-register src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "db:push": "drizzle-kit push:pg",
    "db:generate": "drizzle-kit generate:pg",
    "db:drop": "drizzle-kit drop",
    "db:studio": "drizzle-kit studio"
  }
}
```

### 9. `apps/web/nuxt.config.ts`

```typescript
export default defineNuxtConfig({
  devtools: { enabled: true },
  modules: ["@nuxt/devtools", "primevue/nuxt"],

  primevue: {
    options: {
      unstyled: false,
      theme: {
        preset: "aura", // Theme Aura
        options: {
          darkModeSelector: "system",
        },
      },
    },
  },

  runtimeConfig: {
    public: {
      apiBase: process.env.API_BASE_URL || "http://localhost:8080/api",
    },
  },

  ssr: true,
  nitro: {
    prerender: {
      crawlLinks: true,
    },
  },
})
```

---

## 🔄 WORKFLOW APRÈS INITIALISATION

### Phase 1A: Database & Seeds (immédiat)

```bash
# 1. Setup DB local ou Hetzner
# 2. pnpm db:push (créer tables)
# 3. pnpm db:studio (vérifier)
# 4. Vérifier seeders fonctionnent
```

### Phase 1B: Auth Routes

- POST `/api/auth/register`
- POST `/api/auth/login`
- POST `/api/auth/refresh`
- GET `/api/auth/me`

### Phase 1C: Products Routes

- GET `/api/products` (avec filters)
- GET `/api/products/:id`
- GET `/api/categories`

### Phase 1D: Cart & Orders

- POST `/api/cart` (add item)
- POST `/api/orders` (créer commande)
- GET `/api/orders/:id` (suivi)

### Phase 1E: Legal Docs

- POST `/api/orders/:id/upload-docs` (S3 upload)
- GET `/api/orders/:id/legal-status` (status)
- POST `/api/admin/validate-docs` (validation)

### Phase 1F: Payments

- POST `/api/orders/:id/payment-carte` (Stripe)
- POST `/api/orders/:id/payment-virement` (virement)
- POST `/api/admin/reconcile-payment` (rapprochement)

---

## 📚 RÉFÉRENCES AUX DOCUMENTS

**Quand vous codez une feature, consultez:**

1. **Schema Drizzle** → `docs/schema.ts`
   - Structure exacte des tables
   - Relations + constraints

2. **Workflows & Logique** → `docs/seeds_and_workflows.ts`
   - Fonctions utilitaires (calculateOrderPaymentSplit, calculateArtworkPrice, etc.)
   - Workflow légal (48h SLA, rejet, etc.)
   - Calculs VIP

3. **Exemples Data** → `docs/RESUME_SCHEMA.md`
   - Data exemples JSON
   - Cas d'usage complets
   - Traces audit

4. **Décisions** → `docs/CLARIFICATIONS_A_TRANCHER.md`
   - Confirmations client
   - Motifs de rejet standardisés
   - SLA réponse

---

## ⚙️ CONFIG INFRASTRUCTURE

### docker-compose.prod.yml

À adapter depuis les docs, avec Postgres + Caddy

### PostgreSQL version

`postgres:16-alpine`

### Node version

`node:20-alpine`

---

## ✅ CHECKLIST AVANT DE LANCER CLAUDE CODE

- [ ] Dossier `docs/` contient tous les fichiers générés
- [ ] Structure monorepo prête (apps/api, apps/web, packages/shared)
- [ ] Fichiers template `.ts` ci-dessus (env, types, drizzle.config)
- [ ] .env.example configuré
- [ ] PostgreSQL local ou accès Hetzner DB

---

## 🎯 OBJECTIF FINAL PHASE 1

Après exécution de ce prompt Claude Code devrait avoir:

- ✅ Monorepo pnpm initialized
- ✅ Drizzle schema + migrations générées
- ✅ Seeds data (catégories légales + produits)
- ✅ Fastify basic setup (JWT, CORS)
- ✅ Nuxt 3 configured (PrimeVue Aura)
- ✅ DB connected et testée
- ✅ First route `/health` working

**Prochaine étape**: Implémenter routes auth, products, cart (Phase 1B-1F)

---

## 📞 BESOIN D'AJUSTEMENTS?

Si Claude Code demande des clarifications, référencez:

- Catégories légales: `docs/CLARIFICATIONS_A_TRANCHER.md` section "Réglementaire & Documents"
- Paiement split: `docs/RESUME_SCHEMA.md` section "PAIEMENT - SPLIT AUTOMATIQUE"
- Pricing Gun Art: `docs/seeds_and_workflows.ts` fonction `calculateArtworkPrice()`
- VIP logic: `docs/seeds_and_workflows.ts` fonction `calculateVipDiscount()`

---

**Status**: Ready to launch Claude Code 🚀
