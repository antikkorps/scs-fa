# BACKLOG — Armurier e-commerce

> Source unique de vérité du roadmap, partagée entre machines via git.
> Cocher les items au fur et à mesure. Ajouter nouvelles stories en bas de chaque phase.
> Format BMAD : chaque item = user story + critères d'acceptation + état.

## Principes transverses (à respecter sur chaque story)

- [ ] Tests écrits avec (ou avant) le code feature — Vitest
- [ ] DRY : types/validation/constantes dans `packages/shared`
- [ ] Biome clean (`pnpm lint && pnpm format:check`)
- [ ] Security by design : inputs validés (Zod), RBAC, audit log, secrets en env
- [ ] Doc mise à jour si décision non-triviale (`docs/`)
- [ ] BACKLOG mis à jour (item coché + nouvelles découvertes ajoutées)

---

## PHASE 0 — Scaffold & Infra (en cours)

- [x] Monorepo pnpm workspace (apps/api, apps/web, packages/shared)
- [x] Schema Drizzle copié + migré vers API moderne (0.45 : `(t) => [...]`, `foreignColumns`, chained `.onDelete()`, `sql\`\`` pour partial index)
- [x] Fastify entry point + env Zod validé + helmet + rate-limit
- [x] Nuxt 4 + PrimeVue Aura config
- [x] Shared package (constants, types, validation Zod) + tests
- [x] Docker compose dev (postgres 17-alpine, port hôte 5435)
- [x] `pnpm install` réussi (754 packages, toutes versions ≥90j)
- [x] Biome 2.4.4 configuré + scripts (`lint`, `format`, `check`, `verify`)
- [x] Vitest configuré (api + web + shared) + 1 test smoke par package (8 tests passants)
- [x] Postgres dev up + migrations appliquées + seeds OK (catégories légales + produits)
- [x] `GET /health` répond 200 en local (port 8081)
- [x] Page Nuxt minimale charge avec composant PrimeVue (validé en browser par Franck)
- [x] README racine avec quick start
- [x] Decision log initial dans `docs/ADR/0001-stack-and-drizzle-migration.md`
- [x] Init git repo + commit initial
- [x] `docs/schema.ts` supprimé (canonical = `apps/api/src/db/schema.ts`)
- [x] `docs/seeds_and_workflows.ts` marqué `@ts-nocheck` (référence pour portage workflows)
- [ ] CI GitHub Actions (`pnpm verify`) — différé J+1

## PHASE 1 — Auth (security-first)

**Story 1.1** — Inscription customer ✅

- [x] Critères : email unique (lowercase normalisé), password ≥12 chars, argon2id hash (OWASP 2024 params), RGPD consent stocké (`rgpd_consent_at` + `rgpd_consent_version`)
- [x] Tests : succès (201), email dupliqué (409), password faible (400), payload invalide (400), consent manquant (400), normalisation email
- [x] Endpoint : `POST /api/auth/register` (rate limit 5/min)
- [x] Audit log `user.registered` inséré (IP + user-agent)
- [x] Refactor : `buildApp()` factory pour tests via `fastify.inject`

**Story 1.2** — Login + JWT ✅

- [x] Critères : JWT access 1h + refresh 7d (opaque, sha256-hashé), rotation à chaque /refresh, rate limit 5/min login & 10/min refresh, multi-device (table `refresh_tokens`)
- [x] Lockout : 5 échecs → 15 min (auto-unlock), colonnes `failed_login_attempts` + `locked_until` sur `users`
- [x] Tests : succès, mauvais password (timing-safe via DUMMY_HASH partagé), email inconnu (même 401, anti-énumération), lockout après 5 échecs (423), auto-unlock, refresh rotation + invalidation de l'ancien, refresh expiré (401), logout révoque, logout 204 même token inconnu
- [x] Endpoints : `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`
- [x] Audit logs : `user.login`, `user.token_refreshed`

**Story 1.3** — Profil

- Critères : `GET /api/auth/me` (RBAC), `PATCH` (validation Zod stricte)

**Story 1.4** — Reset password (email token)

- Critères : token jetable 1h, audit log, rate limit

## PHASE 2 — Produits & Catégories

**Story 2.1** — Listing produits avec filtres

- Critères : pagination, filtres (catégorie, prix, légale), search full-text
- Endpoint : `GET /api/products`

**Story 2.2** — Détail produit

- Endpoint : `GET /api/products/:id`

**Story 2.3** — Catégories légales (read-only public)

- Endpoint : `GET /api/legal-categories`

## PHASE 3 — Panier & Commandes

**Story 3.1** — Panier (server-side, attaché user/session)
**Story 3.2** — Création commande (split paiement auto : virement armes / CB autres)

- Cf. `docs/seeds_and_workflows.ts` → `calculateOrderPaymentSplit()`
  **Story 3.3** — Suivi commande customer
  **Story 3.4** — Calcul VIP (1ère arme neuve débloque)
- Cf. `calculateVipDiscount()`

## PHASE 4 — Workflow légal (différenciateur métier)

**Story 4.1** — Upload docs légaux (S3 Scaleway EU)

- Critères : types validés (CNI, permis, etc.), antivirus scan async, chiffrement at-rest
  **Story 4.2** — Espace admin validation 48h SLA
- Critères : queue priorisée, motifs rejet standardisés (cf. `CLARIFICATIONS`), notification email
  **Story 4.3** — État légal commande visible customer
  **Story 4.4** — Alerte SLA dépassé (cron)

## PHASE 5 — Gun Art (tirage limité ≤25)

**Story 5.1** — Pricing dynamique par rareté (`calculateArtworkPrice`)
**Story 5.2** — Réservation atomique d'un numéro de tirage (transaction)
**Story 5.3** — Page collection Gun Art (front)

## PHASE 6 — Paiements

**Story 6.1** — Intégration Stripe (CB) — webhooks signés
**Story 6.2** — Virement : génération RIB + référence unique
**Story 6.3** — Rapprochement bancaire admin (import CSV ou API banque)
**Story 6.4** — Remboursement (full + partiel)

## PHASE 7 — Admin & Observabilité

**Story 7.1** — Dashboard admin (commandes, validations docs)
**Story 7.2** — Logs structurés + alerting (Pino + Loki ?)
**Story 7.3** — Métriques business (CA, conversion, SLA légal)

## PHASE 8 — Mise en prod

**Story 8.1** — Dockerfiles api + web
**Story 8.2** — Caddyfile (HTTPS auto, headers sécurité)
**Story 8.3** — docker-compose.prod.yml + déploiement Hetzner
**Story 8.4** — Backups Postgres automatisés
**Story 8.5** — Monitoring uptime + alertes
**Story 8.6** — Pentest interne avant mise en ligne

---

## Backlog non priorisé / Idées

- Programme fidélité au-delà du VIP ?
- Click & collect en armurerie partenaire ?
- API publique vendeurs tiers ?
- App mobile (long terme)

---

## Décisions architecturales

Voir `docs/ADR/` (Architecture Decision Records — à créer).

## Conventions

- Branches : `feat/<story-id>-short-desc`, `fix/...`, `chore/...`
- Commits : conventional commits (`feat(auth): ...`)
- PRs : référencer la story (`Closes story 1.2`)
- Pas de merge sans : CI verte + tests ajoutés + BACKLOG mis à jour
