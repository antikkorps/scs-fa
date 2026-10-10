# BACKLOG — Armurier e-commerce

> Source unique de vérité du roadmap, partagée entre machines via git.
> Cocher les items au fur et à mesure. Ajouter nouvelles stories en bas de chaque phase.
> Format BMAD : chaque item = user story + critères d'acceptation + état.

## Principes transverses (à respecter sur chaque story)

- [ ] **TDD strict** (depuis le 2026-10-07) — Vitest. Les tests sont notre ceinture de sécurité contre les régressions. Pour chaque comportement et chaque bug :
  1. écrire le test ;
  2. le voir **échouer pour la bonne raison** ;
  3. écrire le code minimal ;
  4. refactorer, suite au vert.

  Pour un bug, le test qui le reproduit précède le correctif. Un test qui ne peut pas venir d'abord (pure mise en page, site tiers inconnu) est signalé et ajouté juste après. On n'affaiblit jamais un test pour le faire passer.
- [ ] **DRY et réutilisable** : types, validation et constantes dans `packages/shared`. On cherche ce qui existe avant d'écrire, et on factorise dès la deuxième copie.
- [ ] **Lisibilité humaine**, bonnes pratiques à l'état de l'art :
  - **pas de ternaire imbriqué** (`if` avec retour anticipé, `switch` ou table de correspondance) ;
  - **pas de variable d'une lettre**, paramètres de fonctions fléchées compris (`(row) =>`, pas `(r) =>`) ; seuls les indices de boucle `i` / `j` sont tolérés ;
  - fonctions courtes avec une seule responsabilité, noms qui disent l'intention, commentaires qui expliquent le **pourquoi** ;
  - on relit chaque diff avec ces règles avant de commiter : Biome ne vérifie pas tout.
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
- [x] 🐞 **Correctif 2026-10-03** : le compteur d'échecs **n'expirait jamais** (remis à zéro seulement par un succès ou un verrouillage) → des fautes de frappe d'il y a des semaines + 2 essais le jour même verrouillaient le compte (constaté sur l'admin de dev). Fenêtre glissante de **15 min** (`last_failed_login_at`, migration **0016**, comptage atomique en SQL) ; chaque échec et le verrouillage sont **journalisés** (`user.login_failed` / `user.login_locked`, nombre de tentatives — jamais le mot de passe tenté ; un e-mail inconnu n'est pas journalisé)
- [x] Tests : succès, mauvais password (timing-safe via DUMMY_HASH partagé), email inconnu (même 401, anti-énumération), lockout après 5 échecs (423), auto-unlock, refresh rotation + invalidation de l'ancien, refresh expiré (401), logout révoque, logout 204 même token inconnu
- [x] Endpoints : `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`
- [x] Audit logs : `user.login`, `user.token_refreshed`

**Story 1.3** — Profil ✅

- [x] Critères : `GET /api/auth/me` (RBAC via JWT authenticate preHandler), `PATCH /api/auth/me` (validation Zod stricte — firstName/lastName/phone/address only, rejects email/role changes)
- [x] Tests : GET success (200), GET sans JWT (401), GET token invalide (401), PATCH update name, PATCH update address, PATCH phone nullable, PATCH audit log, PATCH body vide (400), PATCH email interdit (400), PATCH role interdit (400), PATCH sans JWT (401), PATCH phone invalide (400)
- [x] Audit log `user.profile_updated` inséré (IP + user-agent + new values)

**Story 1.4** — Reset password (email token) ✅

- [x] Critères : token jetable (single-use) 1h TTL, SHA-256 hashé en DB (`password_reset_tokens`), rate limit forgot-password 3/15min, réponse constante anti-énumération email
- [x] Endpoints : `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`
- [x] Reset révoque tous les refresh tokens (re-login forcé sur chaque device), email via nodemailer (SMTP env)
- [x] Audit logs : `user.password_reset_requested`, `user.password_reset`
- [x] Tests (9) : forgot 200 + création token, forgot email inexistant (200 anti-énumération), forgot email invalide (400), reset succès, reset révoque refresh tokens, token expiré, token déjà utilisé, token bidon, password faible (400)

## PHASE 2 — Produits & Catégories

**Story 2.1** — Listing produits avec filtres ✅

- [x] Critères : pagination (page/limit, max 100), filtres catégorie (slug `product_categories`), prix (minPrice/maxPrice sur priceHt), légale (enum A/B/C/D/none), search full-text Postgres
- [x] Endpoint public : `GET /api/products` (published-only, enveloppe `{ data, pagination }`, priceTtc calculé)
- [x] Full-text : colonne générée `products.search_vector` (tsvector `french`, name=A/description=B/longDescription=C) + index GIN, ranking via `ts_rank` + `websearch_to_tsquery` (appliqué via psql ALTER + reflété dans schema.ts)
- [x] Validation : `productFiltersSchema` (shared) — slug regex, refine maxPrice ≥ minPrice
- [x] Tests (11) : pagination, published-only, filtre catégorie/légale/prix min+max, search full-text, priceTtc, 400 (prix négatif, maxPrice<minPrice, slug invalide)
- Endpoint : `GET /api/products`

**Story 2.2** — Détail produit ✅

- [x] Endpoint public : `GET /api/products/:id` (UUID), published-only
- [x] Critères : détail enrichi vs listing — `longDescription`, `seo` (metaTitle/metaDescription/keywords), `ageMinRequired`, restrictions accessoires, objet `legalCategory` complet (name/description/requiresVerification/minAge/requiredDocTypes), `priceTtc` calculé
- [x] Validation : `productIdParamSchema` (shared) — param UUID, 400 si invalide ; 404 si inexistant ou non publié
- [x] DRY : helper `computePriceTtc` extrait dans `packages/shared` (réutilisé par listing 2.1)
- [x] Tests (7) : détail complet, priceTtc, objet légal complet, catégorie `none`, 404 non publié, 404 id inconnu, 400 id non-UUID
- Variantes produit : différées (hors périmètre, non seedées) — à traiter dans une story ultérieure

**Story 2.3** — Catégories légales (read-only public) ✅

- [x] Endpoint public : `GET /api/legal-categories` (données de référence, enveloppe `{ data }`, sans pagination — 5 lignes seedées)
- [x] Renvoie les 5 catégories A/B/C/D/none triées par ordre d'enum, avec name/description/requiresVerification/minAge/requiredDocTypes
- [x] Tests (3) : 200 + 5 catégories ordonnées, shape complète par catégorie, `none` → requiresVerification false + docs vides

## PHASE 3 — Panier & Commandes

**Story 3.1** — Panier (server-side, attaché user) ✅

- [x] Panier rattaché à l'utilisateur connecté (JWT) — pas de panier anonyme (`cart_items.user_id` notNull)
- [x] Gère les 2 types : variants produits (`cart_items`) ET tirages Gun Art (`artwork_cart_items`)
- [x] Endpoints : `GET /api/cart`, `POST /api/cart/items` (variant XOR print), `PATCH /api/cart/items/:id` (qty), `DELETE /api/cart/items/:id`, `DELETE /api/cart/artwork-items/:id`, `DELETE /api/cart`
- [x] Snapshot prix à l'ajout (`priceHtAtTime` = prix produit + delta variant ; tirage = `priceHtUnit`), TTC recalculé via `computePriceTtc`
- [x] Validation stock (qty ≤ stock variant → 400), ownership, published-only, tirage unique par user + disponibilité (409)
- [x] DRY : service `loadCart` réutilisé par la commande ; helpers `round2`/`computePriceTtc` + `updateCartItemSchema`/`uuidParamSchema` dans `shared`
- [x] Tests (15) : auth requise, panier vide, ajout+snapshot delta, incrément qty, stock dépassé, variant non publié, body invalide, update qty, update>stock, update inconnu, suppression, ajout tirage, doublon tirage (409), tirage indisponible (409), vidage

**Story 3.2** — Création commande (split paiement auto : virement armes / CB autres) ✅

- [x] `POST /api/orders` (JWT) — commande construite depuis le panier serveur (réutilise `loadCart`)
- [x] Split paiement auto (`calculateOrderPaymentSplit` dans `shared`) : virement (cat A/B/C) vs CB (cat D/none/Gun Art) → `virement_only` / `carte_only` / `mixed` — règle confirmée (isolée dans `requiresVirement()`)
- [x] Statut légal : `pending` si la commande contient un article à vérification légale, sinon `payment_pending`
- [x] Transaction atomique : insert commande (snapshot `itemsJson` + totaux + snapshot adresses) → décrément stock (garde anti-survente) → réservation tirages (`reserved` + orderId) → vidage panier ; rollback + 409 si stock/tirage indisponible
- [x] Adresse : `POST /api/orders` prend `shippingAddressId` (+ `billingAddressId?`) depuis le carnet (ownership → 404), snapshot immuable dans `orders.shipping_address`/`billing_address` (jsonb)
- [x] Audit log `order.created` (IP + user-agent)
- [x] Tests : 8 intégration (auth, body invalide, panier vide, adresse non possédée 404, virement_only + statut légal + décrément stock + snapshot adresse + panier vidé, carte_only, mixed + réservation tirage, rollback 409 stock) + 5 unitaires `shared` (requiresVirement, 3 types de split)
- Exécution paiement (RIB/IBAN, intent Stripe, lignes `payment_virement`/`payment_carte`) → Phase 6 (ordre roadmap, pas une coupe de scope)
- Cf. `docs/seeds_and_workflows.ts` → `calculateOrderPaymentSplit()`

**Story 3.x (découverte)** — Carnet d'adresses ✅

- [x] Table `addresses` (multi-adresses par user, type shipping/billing/both, `isDefault`) + colonnes snapshot `shipping_address`/`billing_address` (jsonb) sur `orders` — appliqué via `drizzle-kit push`
- [x] CRUD `GET/POST/PATCH/DELETE /api/addresses` (JWT, ownership) ; 1ère adresse ou `isDefault:true` → défaut unique
- [x] Validation `createAddressSchema`/`updateAddressSchema` (shared) ; helper HTTP `validationError` factorisé (`apps/api/src/http.ts`)
- [x] Tests (7) : auth, création + défaut auto, payload invalide, listing (défaut en tête + unicité), update, 404 inconnu, suppression

**Story 3.3** — Suivi commande customer ✅

- [x] `GET /api/orders` (JWT) — liste les commandes du user, plus récentes d'abord, enveloppe `{ data, pagination }` (`paginationSchema` partagé, max 100) ; résumé par commande (statuts légal/paiement, totaux, itemCount)
- [x] `GET /api/orders/:id` (JWT, ownership) — détail complet : items (snapshot `itemsJson`), totaux, statut légal + paiement, snapshots adresses livraison/facturation ; 404 si inconnu ou non possédé
- [x] Tests (6) : auth requise, listing paginé newest-first, pas de fuite inter-user, détail avec items + adresses, 404 inconnu, 404 commande d'un autre user

**Story 3.4** — Calcul VIP (1ère arme neuve débloque) ✅

- [x] Éligibilité : 1ère commande **payée** contenant une **arme neuve** (catégorie légale ∈ {B,C,D} ET catégorie produit hors `occasion`/`arme-ancienne`) → VIP illimité (`vipActive`, `vipStatus='premium'`, `vipEligibleSince`)
- [x] Service `recomputeVipStatus(userId)` (idempotent) — destiné à être appelé à la confirmation de paiement (Phase 6) ; testé en direct ; statuts payés = `received`/`reconciled` (`PAID_PAYMENT_STATUSES` partagé)
- [x] Remise VIP = **50% de la marge produit** (marge 30% → 15%), **hors munitions** ; appliquée par ligne dans `loadCart` (panier) et persistée sur la commande (`vipDiscountAmount`, `vipDiscountAppliedPct`, totaux nets) ; split paiement calculé sur les montants nets
- [x] Helpers `shared` : `isNewFirearmQualifying`, `calculateVipDiscount` ; statut VIP exposé sur `GET /api/auth/me`
- [x] Tests : 9 intégration (éligibilité payée/non-payée/occasion/munition, remise panier VIP, exclusion munition, non-VIP, persistance commande, `/me`) + 3 unitaires `shared`
- Cf. `calculateVipDiscount()` (réf. `docs/seeds_and_workflows.ts`)
- Activation réelle branchée à la confirmation de paiement en Phase 6 (le service est prêt)

## PHASE 4 — Workflow légal (différenciateur métier)

**Story 4.1** — Upload docs légaux (stockage objet S3-compatible) ✅

- [x] Critères : types validés (CNI, permis, etc.), antivirus scan async, chiffrement at-rest
- [x] Upload multipart `POST /api/legal-documents` (`@fastify/multipart`), JWT user-scoped ; validation type MIME (pdf/jpeg/png) + taille (≤ 10 Mo)
- [x] Abstraction stockage **provider-agnostique** `StorageService` (`put`/`getUrl`/`delete`) dans `apps/api/src/storage/` — impl S3-compatible (`@aws-sdk/client-s3`, marche AWS/Scaleway/MinIO via `endpoint`+`forcePathStyle`) + impl InMemory (tests/CI) ; pilotée par `STORAGE_DRIVER`
- [x] Chiffrement at-rest via SSE-S3 (AES256) ; lecture par URL présignée courte (`@aws-sdk/s3-request-presigner`) sur `GET /:id`
- [x] Antivirus = `scan_status` (pending/clean/infected) + hook async stubbé (`scanDocument` marque `clean` en dev ; ClamAV plus tard) ; upload → `pending`
- [x] `GET /api/legal-documents` (liste user), `GET /:id` (+ downloadUrl présignée, ownership), `DELETE /:id` (objet + ligne)
- [x] shared : `LEGAL_DOC_TYPES`, `ALLOWED_LEGAL_DOC_MIME_TYPES`, `MAX_LEGAL_DOC_SIZE_BYTES`, `legalDocumentMetaSchema` ; 13 tests d'intégration (multipart via `form-data`)

**Story 4.2** — Espace admin validation 48h SLA ✅

- [x] Critères : queue priorisée, motifs rejet standardisés (cf. `CLARIFICATIONS`), notification email
- [x] Guard `requireRole("admin")` (JWT `role`) ; routes `/api/admin/legal-documents`
- [x] `GET /` queue triée par `verification_deadline` croissante (NULLS LAST), flag `overdue`, filtre `?status=` (défaut `pending`, `all` possible), pagination, identité uploader jointe
- [x] `GET /:id` détail + URL présignée ; `POST /:id/approve` (exige scan antivirus `clean`) ; `POST /:id/reject` (motif standardisé + note, obligatoire si `other`) — 409 si déjà tranché (guard anti-concurrence dans le WHERE)
- [x] SLA : `verification_deadline = upload + 48h` (`LEGAL_DOC_REVIEW_SLA_HOURS`) ; colonne `rejection_reason` ajoutée
- [x] Motifs standardisés (réponse C1) : `document_expired`, `document_illegible`, `wrong_document_type`, `information_mismatch`, `document_incomplete`, `underage`, `suspected_fraud`, `other`
- [x] Audit trail (`audit_logs`) + emails `sendLegalDocApprovedEmail`/`sendLegalDocRejectedEmail` (best-effort) ; 18 tests d'intégration

**Story 4.3** — État légal commande visible customer ✅

- [x] `GET /api/orders/:id/legal` (JWT, ownership) — checklist actionnable : statut global + par doc requis `{ docType, status: missing|pending_scan|infected|pending_review|approved|rejected, rejectionReason?, documentId? }`
- [x] Docs requis dérivés des catégories légales de l'order (`itemsJson` × `legal_categories.required_doc_types`, union multi-catégories)
- [x] Service `recomputeOrderLegalStatus(userId)` (`apps/api/src/orders/legal-status.ts`) : les décisions admin font avancer les commandes — hooks sur upload, delete, résultat scan, approve/reject ; lecture self-healing sur `GET /:id/legal`
- [x] Transitions : pending → docs_verifying (dossier complet) → docs_verified (tout approuvé, `legalVerifiedAt/By`) / docs_rejected (motif copié sur l'order) ; `docs_verified` ne régresse jamais ; réupload après rejet → docs_verifying (réponse D1 : réupload autorisé)
- [x] shared : `ORDER_REQUIRED_DOC_STATUS` ; 14 tests d'intégration ; vitest API passe en `fileParallelism: false` (queue admin globale = état partagé entre fichiers)

**Story 4.4** — Alerte SLA dépassé (cron) ✅

- [x] Cœur testable `runLegalDocSlaBreachCheck(now)` (`apps/api/src/legal-documents/sla.ts`) : détecte les docs `pending` dont `verification_deadline < now` jamais encore alertés
- [x] Anti-spam idempotent : colonne `sla_breach_notified_at` + index partiel `idx_legal_docs_sla_breach` (pending & non alertés) ; un breach n'est notifié qu'une fois
- [x] Alerte = email **digest** aux admins (`role = 'admin'`) `sendLegalDocSlaBreachEmail` ; envoi **avant** le marquage (un échec de livraison réessaie au run suivant au lieu d'avaler l'alerte) ; pas d'admin → rien marqué (retry)
- [x] Audit trail : entrée `audit_logs` par breach (`action = 'legal_doc_sla_breached'`, acteur `system`/userId null, `newValue = { deadline, hoursOverdue }`) ; marquage + audit dans une transaction
- [x] Câblage : scheduler in-process `startLegalDocSlaScheduler` (`SLA_CHECK_INTERVAL_MINUTES`, défaut 60 ; 0 ou test = no-op ; `clearInterval` sur `onClose`) + CLI `sla-cli.ts` / script `sla:check` pour cron externe (Docker, Phase 8)
- [x] 7 tests d'intégration (breach détecté/marqué/audité/emailé, idempotence, deadline future ignorée, docs non-pending ignorés, sans-deadline ignorés, digest multi-docs/multi-admins, branche sans admin)

## PHASE 5 — Gun Art (tirage limité ≤25)

**Story 5.1** — Pricing dynamique par rareté (`calculateArtworkPrice`) ✅

- [x] Fonction pure `calculateArtworkPrice(basePriceHt, priceIncrementHt, editionLimit, printNumber, format)` dans `packages/shared/src/artwork.ts` : `base * format.priceFactor + increment * (editionLimit - printNumber)`, arrondi `round2` (cf. formule `docs/seeds_and_workflows.ts`)
- [x] Rareté = bonus décroissant : tirage 1/25 le plus cher, 25/25 = base seule ; le format ne scale que la base, jamais le bonus
- [x] Garde-fous (`RangeError`) : `printNumber` entier ∈ [1, editionLimit], `editionLimit ≥ 1`, `priceFactor > 0`, prix ≥ 0 (aligné sur `chk_print_number` en base)
- [x] `ArtworkFormat` (type partagé) + `calculateArtworkPriceBreakdown(...)` → `{ priceHt, priceTtc }` via `computePriceTtc`
- [x] 11 tests unitaires (exemples de référence 5/25, 25/25, 1/25, monotonie rareté, scaling format, arrondi, édition 1/1, bornes invalides)
- Building block branché en 5.2 (réservation atomique d'un tirage) / 5.3 (page collection), comme `calculateVipDiscount` l'a été en Phase 6
**Story 5.2** — Réservation atomique d'un numéro de tirage (transaction) ✅

- [x] Module `apps/api/src/artworks/reservation.ts` : `reservePrintForCart` (available→in_cart), `releasePrintFromCart` (in_cart→available), `reservePrintForOrder` (in_cart→reserved + orderId) — chacun en **compare-and-set** (garde de statut dans le WHERE), exécutable sur `db` ou une transaction (`DbExecutor`)
- [x] Correctif race : l'ajout panier réserve désormais le tirage **au moment de l'ajout** (avant, le statut restait `available` → 2 clients pouvaient détenir le même numéro et le 2ᵉ ne le découvrait qu'au checkout). Claim + insert ligne panier dans **une transaction** (rollback = pas de hold orphelin)
- [x] Libération : retrait d'une ligne (`DELETE /api/cart/artwork-items/:id`) et vidage (`DELETE /api/cart`) repassent le(s) tirage(s) `in_cart→available`, en transaction
- [x] Checkout (`POST /api/orders`) promeut le tirage `in_cart→reserved` via `reservePrintForOrder` (au lieu de `available→reserved`), garde anti-concurrence conservée
- [x] Tests : 5 nouveaux (`reservation.test.ts` : helpers compare-and-set, **2 acheteurs concurrents → un seul gagne**, blocage tant que non libéré) + cart.test enrichi (in_cart à l'ajout, libération au retrait/vidage) ; orders.test inchangé (statut `reserved` après commande)
**Story 5.3** — Page collection Gun Art (front) ✅

- [x] API publique lecture : `GET /api/artworks` (œuvres publiées, `availableCount`/`soldCount`/`priceFrom` HT+TTC agrégés) + `GET /api/artworks/:slug` (œuvre + tirages + formats), module `apps/api/src/artworks/public.ts` ; 4 tests d'intégration
- [x] Seed Gun Art : 6 œuvres + tirages (prix par rareté via `calculateArtworkPrice`, quelques exemplaires `sold`), images placeholder **Lorem Picsum** déterministes (`featuredImageUrl`, modifiable depuis le back) ; nettoyage du code mort dupliqué dans `seeds.ts` (DRY)
- [x] Front Nuxt 4 + PrimeVue : identité visuelle « galerie » sombre (laiton + serif Cormorant), **mobile-first** ; layout (header sticky + burger, footer), page d'accueil (hero), **page collection** (grille responsive 1→2→3 col), page détail (image + tirages dispo + prix)
- [x] SEO : SSR, `useSeoMeta` (title/description/OG) par page, canonical, **JSON-LD** (Organization, ItemList, VisualArtwork, BreadcrumbList), `lang=fr`, `robots.txt`, 404 réel sur slug inconnu
- [x] Perf/Lighthouse : images `width/height` + `aspect-ratio` (zéro CLS), `loading`/`fetchpriority` (LCP), `decoding=async`, polices `display=swap` + preconnect, `prefers-reduced-motion`, focus-visible
- [x] `format.ts` (helpers purs : `formatEuros`, `artworkImage`/fallback Picsum, `availabilityLabel`) + 5 tests unitaires ; override Biome pour les SFC `.vue` (faux positifs unused var/import, le lint script reste actif)
- Note : panier/checkout côté front = stories ultérieures (auth UI requise) ; le CTA « Acquérir » mène à la collection pour l'instant

## PHASE 6 — Paiements

**Story 6.1** — Intégration Stripe (CB) — webhooks signés ✅

- [x] Dépendance `stripe@20.4.1` (quarantaine 90j respectée), wrapper mince `apps/api/src/payments/stripe.ts` (`createPaymentIntent` / `retrievePaymentIntent` / `constructWebhookEvent`) — tout l'I/O réseau isolé derrière 3 fonctions → mockable, zéro clé en test
- [x] Env `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (validés `env.ts`, documentés `.env.example`, valeurs factices dans `vitest.config.ts`)
- [x] Persistance du bucket carte **à la création de commande** : ligne `payment_carte` (montant = `split.carte.amountTtc`) insérée dans la transaction (l'`itemsJson` immuable ne stocke pas la TVA par ligne → le montant carte est figé ici, pas recalculé)
- [x] `POST /api/payments/stripe/intent` (JWT, ownership 404) : crée/réutilise un PaymentIntent pour le montant carte, renvoie `clientSecret` ; **idempotent** (réutilise un intent encore en attente au lieu d'en empiler) ; 400 si commande virement-only, 409 si déjà payé
- [x] `POST /api/webhooks/stripe` (no-auth, **raw body** + vérif signature) : parser `application/json` en Buffer encapsulé au plugin ; `payment_intent.succeeded/payment_failed/canceled` → transition `payment_carte` ; signature KO/absente → 400
- [x] `recomputeOrderPaymentStatus` : la commande passe `received` **seulement quand tous les buckets dus sont réglés** (carte 6.1 + virement 6.2) → forward-compatible ; le flip déclenche `recomputeVipStatus` + `recomputeOrderLegalStatus`
- [x] 13 tests (`payments.test.ts`, Stripe mocké) : création→`payment_carte`, init (création/réutilisation/404/400/409/401), webhook (succeeded carte_only→received, mixed reste pending, failed, intent inconnu no-op, signature KO/absente)
- Note : UI de paiement (Stripe Elements) = **Phase 10** (tunnel d'achat, dépend de l'auth front) ; 6.1 = backend complet, consommable tel quel

**Story 6.2** — Virement : génération RIB + référence unique ✅

- [x] Helper pur `virementReferenceFromBytes` (`packages/shared/src/orders.ts`) : référence `SCS-XXXX-XXXX` en base32 **Crockford** (sans I/L/O/U → robuste à la saisie manuelle / dictée), entropie injectée par l'appelant (testable), unicité déléguée à la DB ; 4 tests unitaires
- [x] RIB de réception SCS en **variables d'env** (`VIREMENT_IBAN`/`BIC`/`BANK_NAME`/`ACCOUNT_HOLDER`, validées `env.ts`, documentées `.env.example`, valeurs factices dans `vitest.config.ts`) — cohérent avec le pattern `STRIPE_*`
- [x] Schéma : colonne `bic_recipient` ajoutée à `payment_virements` + **contrainte UNIQUE** sur `payment_reference` (appliquées en base via `ALTER TABLE`)
- [x] Persistance du bucket virement **à la création de commande** (en miroir de `payment_carte` 6.1) : ligne `payment_virement` insérée dans la transaction quand `split.virement.amountTtc > 0` ; RIB **figé** sur la ligne (un changement d'env ne réécrit pas les instructions déjà émises) ; référence unique allouée avec retry anti-collision (5 tentatives)
- [x] `GET /api/payments/virement/:id` (JWT, ownership 404) : renvoie les instructions RIB (référence, montant attendu, IBAN/BIC/banque/titulaire, statut) ; 400 si commande carte-only (`NoBankTransfer`), 401 sans token
- [x] `recomputeOrderPaymentStatus` (déjà forward-compatible depuis 6.1) consomme désormais un vrai bucket virement ; le passage `received` attend toujours **tous** les buckets dus
- [x] 8 tests d'intégration ajoutés (`payments.test.ts`) : création virement-only/mixte (réf unique + RIB snapshoté), distinction des réf entre commandes, lecture RIB, 404 cross-user/inconnu, 400 carte-only, 400 uuid malformé, 401 ; suite API complète au vert (189 tests)
- Note : la **réconciliation** (statut → `reconciled`, settle du bucket virement, claim client) = Story 6.3 ; 6.2 = génération + lecture des instructions

**Story 6.3** — Rapprochement bancaire admin (import CSV ou API banque) ✅

- [x] Helpers purs (`packages/shared/src/orders.ts`, 9 tests unitaires) : `extractTransferReference` (repère `SCS-XXXX-XXXX` dans un libellé bancaire libre, normalise en majuscules, ignore I/L/O/U hors alphabet), `parseBankAmount` (FR `1 234,56` / EN `1,234.56` / signe / symbole devise), `parseBankStatementCsv` (délimiteur `;`/`,` auto, en-têtes accent/espace-insensibles, champs entre guillemets, colonnes `label`+`amount` requises → throw sinon), `amountsMatchToCent` (comparaison au centime, anti-drift flottant)
- [x] Schémas zod (`claimVirementSchema`, `virementQueueQuerySchema`, `reconcileVirementSchema`, `importBankStatementSchema`) + `VIREMENT_RECONCILE_STATUSES`
- [x] Claim client : `POST /api/payments/virement/:id/claim` (JWT, ownership 404) — déclaration « j'ai fait le virement » → bucket `awaiting_transfer`→`transfer_claimed`, stocke `client_reported_*` (advisory ; le relevé bancaire reste la source de vérité) ; 409 si déjà réconcilié, 400 carte-only
- [x] Cœur réutilisable `reconcileVirementBucket` : settle le bucket (`amount_received_ttc`, `received_at`, `received_from_iban`, `reconciled_at/by`, notes) → statut `reconciled`, garde de statut **répétée dans le WHERE** (anti double-settle concurrent), puis `recomputeOrderPaymentStatus` → la commande bascule `received` quand tous les buckets dus sont réglés ; renvoie `amountMatched` (le settle a lieu quoi qu'il arrive, l'admin assume la décision)
- [x] Admin (`requireRole("admin")`, monté `/api/admin/payments`) : `GET /virements` (file d'attente filtrable par statut + pagination, jointe au client), `GET /virements/:id` (détail), `POST /virements/:id/reconcile` (settle manuel), `POST /import` (CSV → auto-réconciliation)
- [x] Import CSV **conservateur** : n'auto-settle qu'au triple match (référence connue + bucket en attente + montant au centime) ; tout le reste classé pour revue manuelle sans toucher l'état (`unknown_reference`/`no_reference`/`not_a_credit`/`amount_mismatch`) ; **idempotent** (un relevé ré-importé ne re-settle rien — la réf n'est plus dans l'ensemble « en attente »)
- [x] Audit log sur claim + reconcile (oldValue/newValue, `userId` = client ou admin)
- [x] 21 tests d'intégration ajoutés (`payments.test.ts`) : claim (succès/vide/404 cross-user/409 réconcilié/400 carte-only/401), garde de rôle admin (403 client/401 anonyme), file/détail (200/404), reconcile manuel (settle+commande `received`/mismatch flaggé/409/404/400 montant), import CSV (auto-réconciliation/mismatch/classification mixte/idempotence/400 illisible) — suite API complète au vert (**210 tests**), shared (**51 tests**)
- Note : pas de connecteur API banque temps réel (DSP2/Bridge) en 6.3 — l'import CSV couvre le besoin opérationnel ; l'UI d'admin du rapprochement = Phase 7 (dashboard admin)

**Story 6.4** — Remboursement (full + partiel) ✅

- [x] Schéma : table `refunds` (une ligne par action de remboursement, canal `carte`/`virement`, montant, statut, `stripe_refund_id`, `initiated_by`, audit) + enums `refund_channel`/`refund_status` + valeurs `partially_refunded`/`refunded` ajoutées à `payment_status` (appliqués en base via psql `ALTER TYPE`/`CREATE`)
- [x] `PAID_PAYMENT_STATUSES` inclut désormais `partially_refunded` (achat toujours abouti, biens conservés) ; `refunded` n'en fait pas partie → sort des commandes payées
- [x] Wrapper Stripe : `createRefund` (refund total/partiel sur PaymentIntent, montant en centimes)
- [x] Cœur `createOrderRefund` (par canal) : garde « commande payée » (400 sinon), montant **plafonné** au remboursable restant par canal (pending + succeeded décomptés → 400 dépassement, 409 si canal déjà soldé) ; **carte** via Stripe (peut être `pending` → finalisé par webhook) ; **virement** = remboursement manuel enregistré `succeeded` (le virement retour est hors-ligne, l'admin l'atteste, zéro appel Stripe)
- [x] Cascade `applyRefundEffects` : remboursement **total** (cumul succeeded ≥ total commande) → commande `refunded` **en une seule transition** (compare-and-set) qui **restocke les variantes**, **libère les tirages Gun Art réservés** (`reserved`→`available`, `orderId` null) et **recalcule le VIP** ; **partiel** → `partially_refunded`. Idempotent : un webhook rejoué ne restocke jamais deux fois
- [x] `recomputeVipStatus` rendu **bidirectionnel** (révocable) : accorde ou **révoque** le VIP selon l'existence d'une commande payée qualifiante ; un remboursement total qui était la seule commande qualifiante retire le VIP, un remboursement partiel le conserve ; état déjà correct laissé tel quel (`vipEligibleSince` préservé)
- [x] Webhook Stripe étendu : `refund.updated` / `refund.created` → `settleStripeRefund` (match par `stripe_refund_id`, idempotent, déclenche la cascade quand le refund passe `succeeded`). *2026-10-10 : `charge.refunded` retiré (l'API Stripe n'inclut plus `refunds` dans la charge, branche morte) ; carte (last4/marque) lue via `latest_charge` (l'ancien `intent.charges` n'existe plus depuis 2022, les champs restaient vides). Événements à abonner sur l'endpoint Stripe : `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `refund.created`, `refund.updated`.*
- [x] Routes admin (`requireRole("admin")`) : `POST /api/admin/payments/orders/:orderId/refunds` (201), `GET .../refunds` (historique)
- [x] Audit log sur chaque remboursement (`entityType: refund`, `userId` = admin)
- [x] 32 tests d'intégration ajoutés (`payments.test.ts`) : carte partiel/total (montant Stripe en centimes, statut commande), restauration stock (commande réelle), libération tirage, webhook async + idempotence, virement total→révocation VIP / partiel→VIP conservé, plafonds (montant > remboursable, cumul, canal non payé, commande non payée), 404, gardes rôle 403/401, historique — suite API complète au vert (**224 tests**), shared (**51 tests**)
- Note : remboursement déclenché côté admin (UI = Phase 7) ; pas de génération d'avoir comptable Henrri ici (Phase facturation)

**Phase 6 — COMPLÈTE** (6.1 CB Stripe, 6.2 virement RIB, 6.3 rapprochement, 6.4 remboursement)

## PHASE 7 — Admin & Observabilité

**Story 7.1** — Dashboard admin (commandes, validations docs) ✅

- [x] API admin commandes (`apps/api/src/orders/admin.ts`, `requireRole("admin")`, monté `/api/admin/orders`) : `GET /` (liste tous clients, filtres `paymentStatus`/`legalStatus`/`search` email + pagination, jointe au client), `GET /:id` (détail complet + buckets carte/virement + remboursements), `GET /summary` (compteurs dashboard — déclaré avant `/:id` pour ne pas être capté comme un id). 12 tests d'intégration (auth 403/401, liste, filtres, recherche, 400 statut hors-bornes, détail+refunds, 404/400, summary)
- [x] Constantes exactes `ORDER_PAYMENT_STATUSES`/`ORDER_LEGAL_STATUSES` (shared) alignées sur les enums DB (les anciennes `ORDER_LEGAL_STATUS`/`PAYMENT_STATUS` de `constants.ts` étaient périmées — laissées intactes, non autoritatives) + `adminOrderQuerySchema`
- [x] **Front admin** (Nuxt 4 — première brique authentifiée). Fondation auth : `useAuth` (token + user en cookies SSR-safe, login via `/api/auth/login`), `useApi` (`$fetch` avec bearer + bascule login sur 401), middleware `admin` (garde rôle → redirect), page `/admin/login` autonome
- [x] Shell admin (`layouts/admin.vue` : sidebar responsive + topbar + déconnexion) + dashboard `/admin` (cartes d'indicateurs depuis `/summary`, deep-links filtrés)
- [x] `/admin/orders` (tableau filtrable + pagination, filtres miroir dans l'URL) + `/admin/orders/[id]` (articles, totaux, client/adresse, buckets paiement, remboursements)
- [x] `/admin/legal-docs` (file de validation, onglets de statut, drawer détail avec URL de téléchargement présignée, **approuver/rejeter** avec motif normalisé + note — consomme l'API admin 4.2 existante)
- [x] Composant `AdminStatusTag` + utils `status.ts` (libellés FR + sévérité couleur) + `format.ts` étendu (`formatDate`/`formatDateTime`, +2 tests)
- [x] Seed admin **idempotent** (`ADMIN_SEED_EMAIL`/`ADMIN_SEED_PASSWORD`, défauts dev documentés `.env.example`) → backoffice utilisable dès le seed
- [x] Smoke test réel : login admin → 3 endpoints admin 200 / 401 sans token ; front `/admin/login` rendu 200, gardes `/admin` & `/admin/orders` → 302 vers login. Suite complète au vert (**236 API, 51 shared, 8 web**), typecheck (shared/api/web) + Biome OK
- Note : réconciliation virement / remboursements pilotables depuis l'UI = itération suivante (les API existent déjà, 6.3/6.4) ; le détail commande les affiche en lecture seule

**Story 7.2** — Logs structurés + alerting (Pino + Loki ?) ✅

- [x] Logger Pino durci (`apps/api/src/logging/logger.ts`) : `buildLoggerOptions(env)` — JSON structuré en prod (prêt pour un agrégateur type Loki/Phase 8), `pino-pretty` en dev, `silent` en test ; niveau résolu par env + override `LOG_LEVEL` ; **redaction** des chemins sensibles (`authorization`/`cookie`/`stripe-signature`/`set-cookie` + `*.password`/`*.token`/`*.accessToken`…) ; chaque ligne taguée `service`/`env`
- [x] Corrélation : `genReqId` honore un `x-request-id` entrant (tracé proxy/front propagé) sinon UUID, longueur plafonnée (anti-abus) — propagé sur `incoming request` → `request completed`
- [x] Alerting throttlé (`logging/alerting.ts`) : `createAlerter` pur/injectable — au plus **une alerte par signature d'erreur** par fenêtre de cooldown (`ERROR_ALERT_COOLDOWN_MINUTES`, défaut 15), best-effort (jamais d'exception dans la requête), purge anti-croissance de la map
- [x] Error handler centralisé (`logging/error-handler.ts`) : les 4xx repassent tels quels ; les **5xx** sont loggés (reqId/route/stack) + déclenchent l'alerte throttlée ; corps **générique en prod** (zéro fuite de stack/SQL/chemin), détaillé en dev
- [x] Email d'alerte admin (`sendErrorAlertEmail`) ; câblage (`logging/index.ts` `setupErrorAlerting`) : alertes **off hors prod** sauf `ERROR_ALERTS_ENABLED=true` (dev/test ne touchent jamais SMTP), lookup admins **paresseux** (un admin créé après le boot reçoit les alertes sans redémarrage)
- [x] 16 tests (8 logger : niveaux/redaction/base/transport/reqId ; 4 alerting : dispatch/throttle/signatures distinctes/échec avalé ; 4 error handler : 500 shaped+alerte, message dev vs prod générique, 4xx passthrough sans alerte) ; **fix d'isolation** : `sla.test` possède désormais l'ensemble global des admins (le check SLA notifie *tous* les admins → un admin seedé faussait le compte)
- [x] Smoke réel (boot prod) : logs JSON `service`/`env`, `reqId` repris de `x-request-id` et propagé incoming→completed, `responseTime`/`statusCode`. Suite complète au vert (**252 API, 51 shared, 8 web**), typecheck + Biome OK
- Note : expédition vers un agrégateur (Loki/Grafana) = Phase 8 (infra) ; ici tout est prêt côté applicatif (JSON sur stdout)

**Story 7.3** — Métriques business (CA, conversion, SLA légal) ✅

- [x] Service métriques (`apps/api/src/metrics/service.ts`) : `computeMetrics({from,to,commissionRatePct})` — tout en agrégats SQL (sum/count/group-by/filter), zéro ligne tirée en JS, sur les commandes placées dans `[from, to)`
- [x] **CA net** = brut TTC des commandes payées (`received`/`reconciled`/`partially_refunded`) − remboursements `succeeded` sur ces commandes ; **commission** = `COMMISSION_RATE_PCT` % du net (défaut 5%, env, documenté `.env.example`) — **reporting transparent** de la part partenaire
- [x] **Entonnoir + conversion** (total/payées/en attente/remboursées/échouées, `conversionPct`) ; **SLA légal** (docs décidés dans la période : `withinSlaPct` `verifiedAt ≤ deadline`, `avgReviewHours`, + `pendingOverdue` point-in-time) ; **timeseries** CA brut quotidien (ordonné)
- [x] `GET /api/admin/metrics?from=&to=` (`requireRole("admin")`, fenêtre 30j par défaut, `to` inclusif fin-de-journée) + `adminMetricsQuerySchema` (shared, `from ≤ to`)
- [x] Front `/admin/metrics` : cartes KPI (CA net, commission 5%, conversion, SLA 48h), sélecteur 7/30/90j, **mini-graphe CA/jour en CSS inline** (zéro dépendance de charting — respecte la quarantaine deps), entonnoir détaillé ; lien dans la nav admin
- [x] 7 tests d'intégration sur **période historique (mars 2025)** → isolation déterministe malgré la base partagée (les données `now`-datées des autres suites tombent hors fenêtre) : revenu net+commission, entonnoir+conversion, SLA, timeseries exacte, défaut 30j, 400 période inversée, gardes 403/401
- [x] Smoke réel : endpoint sur serveur live → `netTtc 240 / commission 12 (=5%) / conversion 100% / timeseries`; page guardée (302). Suite complète au vert (**259 API, 51 shared, 8 web**), typecheck + Biome OK
- Reco suivi : **base de test séparée** — tests et dev partagent un Postgres ; `sla.test` doit posséder l'ensemble global des admins (le check notifie *tous* les admins), ce qui supprime l'admin démo seedé à chaque run (re-seed idempotent nécessaire). Une DB de test dédiée éliminerait ce couplage (à cadrer Phase 8 infra)

**Story 7.4** — Backoffice : actions paiement (réconciliation + remboursement) ✅

- [x] **Remboursement depuis le détail commande** (`/admin/orders/[id]`) : calcul du **remboursable par canal** (montant payé − remboursements `pending`/`succeeded` déjà enregistrés ; le backend applique le même plafond), bouton « Rembourser » → modal (canal limité aux canaux payés, montant ≤ remboursable, motif) → `POST /api/admin/payments/orders/:id/refunds` → refresh. Types paiement affinés (`PaymentCarte`/`PaymentVirement` au lieu de `Record<string,unknown>`)
- [x] **Page file de réconciliation virements** (`/admin/payments/virements`, miroir de la file docs) : onglets de statut (En attente / Déclarés / Rapprochés / Tous), tableau (référence, client + date déclarée, attendu/reçu, statut), pagination ; drawer détail montrant les **infos déclarées par le client** (IBAN/date/montant/note) + formulaire **Marquer reçu & rapprocher** (montant reçu pré-rempli à l'attendu, IBAN émetteur, note) → `POST .../virements/:id/reconcile` ; lecture seule si déjà rapproché
- [x] **Import CSV** intégré (panneau dépliable) : textarea → `POST /api/admin/payments/import` → rapport inline (rapprochées / à revoir + libellé d'`outcome` par ligne) ; lien « Virements » ajouté à la nav admin
- [x] Front-only (les API 6.3/6.4 existaient) ; smoke réel sur serveur live : **réconciliation → virement `reconciled` + commande `received`** (cascade), **remboursement virement → `partially_refunded`** ; pages guardées (302). Suite complète au vert (**259 API, 51 shared, 8 web**), typecheck (shared/api/web) + Biome OK
- Correctif IDE : `import process from "node:process"` dans `vitest.config.ts` (fichier hors `include` tsconfig → le global `process` n'était pas typé pour l'éditeur)

**PHASE 7 — COMPLÈTE** (7.1 dashboard admin, 7.2 logs+alerting, 7.3 métriques+commission, 7.4 actions paiement UI)

**Story 7.5a** — Backoffice catalogue : le CRUD complet ✅ _(scindée de la 7.5 le 2026-09-10)_

> Constat de Franck : « sinon comment tu veux qu'ils les mettent ? ils vont pas faire des requêtes SQL ». Tout le contenu livré depuis la 11.1 — tags, armes de collection, œuvres, séries, thèmes, artistes — ne se saisissait que **par le seed**. La 7.5 d'origine ne parlait que du **pipeline d'images** ; elle est scindée : **7.5a** = les écrans de saisie (celle-ci), **7.5b** = les médias.
>
> ⚠️ Périmètre **tout le catalogue d'un coup**, choisi par Franck contre ma recommandation de commencer par Gun Art seul. Livré en entier.

- [x] **Schémas partagés** (`packages/shared/src/validation.ts`) : artiste, thème, série, œuvre (avec ses formats), tag, produit (avec ses variantes). Une seule porte d'entrée, tenue par l'API et reflétée par les formulaires
- [x] ⚠️ **Piège zod 4 attrapé au démarrage** : `.omit()` sur un schéma **affiné** passe le typecheck et **explose à l'exécution**. Les objets de base restent donc nus, les `.refine()` vivent sur les schémas dérivés
- [x] **API Gun Art éditorial** (`/api/admin/gun-art/{artists,themes,series}`) : CRUD complet, slug en conflit renvoyé en **409** plutôt qu'une 500 Postgres, référence pendante **nommée** (« Unknown theme: … ») plutôt qu'une erreur de clé étrangère. Chaque liste affiche **ce qui pointe vers l'entité** : les FK sont en `set null`, donc supprimer un thème vide une étiquette au lieu de détruire une série — encore faut-il le voir avant de cliquer
- [x] **API œuvres** (`/api/admin/artworks`) : création de l'**œuvre, de son produit support et de toute l'édition numérotée** en une transaction — sans produit, une œuvre ne pourrait jamais être achetée. **Le garde-fou de prix de la 11.7 trouve enfin son point d'application** : il est vérifié à la création *et* au patch, et **sur la grille d'après le patch**, pas sur les champs que le patch transporte — changer le seul incrément suffit à casser une grille dont les facteurs n'ont pas bougé. Le refus transporte les **deux remèdes chiffrés**
- [x] **Re-tarification honnête** : un tirage vendu ou réservé **garde son prix**, c'est ce qui a été promis à l'acheteur ; seuls les tirages encore en rayon suivent un changement de prix ou de format. Suppression **refusée** dès qu'un tirage est au panier, réservé ou vendu, avec l'alternative dans le message (« dépubliez-la »)
- [x] ⚠️ **Tension de modèle documentée, pas masquée** : `artwork_prints.format_id` fige un format à la création alors que la règle client (11.7) veut les 25 numéros **partagés entre formats**, l'acheteur choisissant sa taille. En attendant l'arbitrage, l'édition est numérotée dans le **format d'entrée** — ce que le seed faisait déjà — et l'admin peut **re-formater un tirage encore disponible**, ce qui le re-tarife
- [x] **API produits** (`/api/admin/products`) : CRUD avec **variantes réconciliées, pas écrasées** (l'id d'une variante voyage dans les paniers et les lignes de commande) ; retirer une variante présente sur une commande est **refusé** avec « mettez son stock à zéro ». `requiresLegalVerification` est **déduit** de la catégorie légale, jamais saisi. Les produits qui portent une œuvre ou une arme de collection sont **exclus** du formulaire générique : ils ont leurs propres écrans, qui savent ce qu'est une édition ou une provenance
- [x] **API tags** (`/api/admin/tags`) — l'écran laissé ouvert par la 11.1. La **facette n'est pas modifiable** : elle pilote le sens du filtrage (OU dans une facette, ET entre facettes), la changer réécrirait silencieusement tous les filtres enregistrés
- [x] ⚠️ **Piège Drizzle attrapé au smoke** : dans un fragment `sql` brut, Drizzle ne **qualifie** les colonnes que si la requête externe a une **jointure**. Sur une requête mono-table, la colonne externe sort nue et Postgres la rattache à la table de la sous-requête — **compteurs à zéro sans une erreur**. Tous les compteurs passent désormais par une jointure + `count(distinct)`. *(Vérifié : le code de la 11.6 déjà mergé est correct, ses requêtes ont des jointures.)*
- [x] **Écrans** : `/admin/produits`, `/admin/armes-anciennes`, `/admin/gun-art/oeuvres` (liste + formulaire chacun), et un composant générique `AdminEntityManager` pour artistes, thèmes, séries et tags — quatre entités « une poignée de lignes, une dizaine de champs » qui auraient sinon été quatre fois le même code. Navigation admin complétée
- [x] **Le garde-fou de prix est aussi rendu en direct** dans le formulaire d'œuvre, via **la même fonction partagée** que le serveur : ce n'est pas un remplacement du contrôle serveur, c'est la différence entre le savoir maintenant et le découvrir après un refus
- [x] ⚠️ **Défaut vu au rendu, pas au code** : `[...DEFAULT_FORMATS]` copie le tableau mais **partage les objets** — éditer les formats d'une nouvelle œuvre réécrivait le gabarit pour toute la session. Copie profonde
- [x] ⚠️ **Défaut de langue** : « + Nouveau artiste », « Aucun série ». Le français élide et genre : les libellés sont **donnés**, plus assemblés
- [x] **Vérifié** : Biome clean, `pnpm -r typecheck` clean, **API 423 / shared 91 / web 187 = 701** au vert (+51) ; **smoke réel au navigateur** (les 6 écrans chargent sans erreur, création d'un artiste à la souris de bout en bout, garde-fou de prix réagissant à la saisie, tirages et variantes affichés). Captures : `/tmp/scs-pw/crud-*.png`
- Reste ouvert : **saisie du visuel par URL** en attendant la 7.5b (l'upload Gun Art de la 11.5 renseigne déjà le champ) ; pas encore de **prévisualisation** ni de **journalisation d'audit** sur ces écrans

**Story 7.5b** — Médias catalogue : upload, galerie & variantes responsives ✅

> Reliquat de la 7.5 d'origine, une fois la saisie débloquée par la 7.5a : le visuel se saisissait encore **par URL à la main**. Constat au moment de cadrer : ce ne sont plus deux porteurs mais **quatre** — produit, œuvre, **couverture de série** et **portrait d'artiste** (11.6). Deux tables explicites n'en couvraient déjà que la moitié.

- [x] **Décisions validées avec Franck avant de coder** : table `media` **polymorphe** (et non une table par porteur, ni deux) ; **pré-génération de N largeurs au upload** (et non redimensionnement au edge, qui contredirait la contrainte d'agnosticité du fournisseur que la story pose elle-même) ; `featuredImageUrl` **conservé mais écrit par le serveur** depuis la position 0 — une seule source de vérité, et tout le front existant continue de marcher
- [x] **Schéma** `media` (`owner_type` en enum + `owner_id`, position, **texte alternatif obligatoire**, largeurs réellement disponibles, dimensions, poids, `watermarked`) + migration 0006
- [x] ⚠️ **Le prix du polymorphisme, assumé et payé** : **aucune FK** ne garantit que le porteur existe encore. La création vérifie l'existence du porteur à la main (404 sinon), et **chaque suppression de porteur** — produit, œuvre, arme de collection, artiste, série — appelle explicitement le nettoyage. Sans cela, chaque suppression aurait laissé ses fichiers dans le bucket et ses lignes en base, **pour toujours**. Un test le verrouille
- [x] ⚠️ **La galerie ne perce PAS la protection de la 11.5.** Un visuel d'œuvre servi tel quel ici aurait annulé la seule mesure qui survit à une capture d'écran. Un upload `artwork` est donc **filigrané et plafonné** dans ce pipeline, et l'**original qualité tirage est rangé en privé** — accessible en admin seulement, en `no-store`. Un test vérifie que **de l'encre est réellement déposée** (l'écart-type d'un fond plat serait nul)
- [x] **Pipeline durci** repris de la 9.4b : le **décodage sharp est le vrai contrôle de contenu** (fichiers mislabellisés et polyglots rejetés), `.rotate()` avant le strip des métadonnées (EXIF GPS = fuite), re-encodage WebP, **pas de SVG**, plafond de taille **dans le handler** (les limites par requête de `@fastify/multipart` sont inopérantes, cf. 11.5)
- [x] **Variantes responsives** 400 / 800 / 1400 px pré-générées, **jamais d'agrandissement** : une petite image garde sa taille, et la ligne enregistre **les largeurs qu'elle a réellement** — le front ne peut pas les deviner. `srcset` prêt à l'emploi dans la réponse
- [x] **API** : `GET/POST /api/admin/media`, `PATCH /:id` (alt, position), **`PATCH /reorder`** (la galerie entière **en un appel** : réordonner image par image laisserait la galerie à moitié triée et l'image principale clignotante), `DELETE /:id` (qui **referme le trou** de positions, sans quoi « position 0 » ne veut plus rien dire), `GET /:id/original` (admin). Public : `GET /api/media/:id/:largeur.webp`, immuable
- [x] **Galerie d'administration** `AdminMediaGallery` branchée sur les **cinq** écrans (produit, arme de collection, œuvre, série, artiste) : glisser-déposer, miniatures, réordonnancement, texte alternatif éditable, suppression, badge **« image principale »** sur la première — puisque c'est elle qui alimente les cartes, les partages et le plan du site. La saisie d'URL à la main a disparu des formulaires
- [x] ⚠️ **Défaut attrapé par un test** : après un réordonnancement refusé, le rechargement **effaçait le message d'erreur** — l'admin ne voyait rien. On recharge d'abord, on reporte ensuite
- [x] ⚠️ **Défaut vu au rendu** : le titre « Visuels » s'affichait deux fois (le panneau et le composant). Un seul désormais
- [x] **Vérifié** : Biome clean, `pnpm -r typecheck` clean, **API 439 / shared 91 / web 196 = 726** au vert (+25) ; **smoke réel** (upload produit et œuvre, filigrane visuellement confirmé sur le rendu de galerie, original privé en 404 anonyme et 200 en admin, alt obligatoire, non-image rejetée, traversal en 404) et **parcours navigateur complet** (upload par la galerie, réordonnancement déplaçant l'image principale, badge filigrane sur les œuvres). Captures : `/tmp/scs-pw/media-*.png`
- Reste ouvert : **AVIF** (gain LCP à mesurer contre le coût CPU, à traiter avec la 9.6) ; **image sitemap** et OG images par produit (9.6) ; l'`imagesCount` historique sur `artworks` n'est plus alimenté — à retirer ou à recâbler ; les visuels **publiés avant cette story** restent des URL saisies à la main tant qu'ils ne sont pas re-téléversés

## PHASE 8 — Mise en prod

**Story 8.0** — Base de test dédiée (isolation tests / dev) ✅

- [x] `globalSetup` vitest (`apps/api/src/test/global-setup.ts`) : provisionne une base **jetable `armurier_test`** avant la suite — drop+create, **clone du schéma dev** via `pg_dump -s` (le dev est la source de vérité, pas de baseline de migration), puis seed des données de référence. Recréée à neuf à chaque run → départ propre garanti
- [x] `vitest.config` pointe `DATABASE_URL` sur la base de test (var dédiée `TEST_DATABASE_URL` pour override CI, sans qu'un `DATABASE_URL` traînant ne redirige vers dev) ; overrides `TEST_DB_SKIP_PROVISION`/`TEST_DB_NAME`/`TEST_DB_SOURCE`/`TEST_DB_CONTAINER` documentés `.env.example`
- [x] **Résout** le couplage 7.x : `sla.test`/`metrics.test` opèrent sur l'état global (admins/commandes) → ne touchent plus jamais la base dev. **L'admin démo survit désormais à `pnpm test`** (vérifié : présent dans `armurier_dev` après run complet ; `armurier_test` provisionnée avec 5 cat. légales / 10 cat. produit)
- [x] Suite complète au vert contre la base de test (**259 API, 51 shared, 8 web**), typecheck + Biome OK
- Note : pour CI (Phase 8.3+), `TEST_DATABASE_URL` + `TEST_DB_SKIP_PROVISION=true` ciblent un Postgres de CI sans docker

**Story 8.0b** — CI (lint + typecheck + tests) ✅

- [x] Workflow Forgejo Actions (`.forgejo/workflows/ci.yml`) sur **PR + push main** : service Postgres, pnpm@10 + Node 22, `pnpm install --frozen-lockfile`, **Biome ci**, **typecheck** (`pnpm -r typecheck`), création du schéma via **`drizzle-kit push --force`** (non-interactif ; `schema.ts` = source de vérité, pas de baseline de migration), puis **tests** (`pnpm -r test`)
- [x] La base CI est ciblée directement : `TEST_DATABASE_URL` + `TEST_DB_SKIP_PROVISION=true` → le `globalSetup` seed la base CI sans tenter le clone docker local ; toutes les vars requises par `env.ts` (JWT/S3/SMTP/Stripe/RIB) fournies en **dummies sûrs** (Stripe mocké, storage mémoire, aucun mail)
- [x] Validé **localement en simulant le flux CI** : `drizzle-kit push --force` crée 24 tables (refunds + enums OK), puis suite complète au vert contre cette base avec skip-provision (**259 API, 51 shared, 8 web**) ; `biome ci .` exit 0 (warnings `!important` non bloquants)
- Pré-requis : un **`forgejo-runner` (backend Docker) enregistré** ; les jobs tournent en conteneur → le service Postgres est joint par son nom de service. Label `ubuntu-latest` (= runner Renovate). Actions `actions/checkout`/`pnpm/action-setup`/`actions/setup-node` résolues depuis github.com
- Piège résolu : le service nommé `postgres` **entrait en collision** avec une autre base du réseau du runner (qui sert aussi Renovate contre la base dev) → les connexions tombaient sur la mauvaise base (auth `armurier` rejetée). Service **renommé `testdb`** + auth `trust` (base CI éphémère) → vérifié vert de bout en bout (lint + typecheck + 318 tests)

**Story 8.1** — Dockerfiles api + web ✅

- [x] `apps/api/Dockerfile` multi-stage (build context = racine) : stage build `pnpm install --frozen-lockfile` + **`pnpm deploy --legacy --prod /app`** (bundle autonome : API + `@armurier/shared` en source TS + node_modules prod **dont tsx**) ; runtime `node:22-slim` non-root, healthcheck `/health`, **`CMD tsx src/index.ts`** — l'API tourne la source TS via tsx, ce qui résout le paquet workspace `@armurier/shared` (publié en TS, pas de build JS)
- [x] `apps/web/Dockerfile` multi-stage : build `nuxt build` → `.output` (Nitro bundle tout, dont shared) ; runtime `node:22-slim` non-root, **`.output` auto-contenu** (zéro node_modules), `CMD node .output/server/index.mjs` ; URLs injectées au runtime via `NUXT_PUBLIC_*` → image agnostique de l'environnement
- [x] `tsx` déplacé en **dependency** de l'API (entrée prod) ; `pnpm.onlyBuiltDependencies` (argon2/esbuild) au niveau racine ; `start` API = `tsx src/index.ts` ; `.dockerignore` racine (exclut node_modules/.output/.env/secrets)
- [x] **Vérifié en réel** (docker build + run) : API → `/health` 200 + **login admin OK** (argon2 natif + DB + shared tous fonctionnels en conteneur), image **451 MB** ; web → `/admin/login` & `/` rendus 200, logs propres, image **360 MB**
- Note : bases `node:22-slim` (Debian) choisies pour la fiabilité des modules natifs (argon2/esbuild) vs alpine/musl ; slim possible plus tard si on veut réduire la taille
**Story 8.2** — Caddyfile (HTTPS auto, headers sécurité) ✅

- [x] `Caddyfile` reverse proxy : **HTTPS automatique** (Let's Encrypt via `{$ACME_EMAIL}`), domaine `{$DOMAIN}` paramétrable. Hôte canonique **`www.scs-firearms.com`** ; l'apex redirige (301) vers www
- [x] **Single-origin** : `/api/*` + `/health` → backend `api:8080`, tout le reste → `web:3000` (Nitro) → front et API sur la même origine = **pas de CORS navigateur** ; `encode zstd gzip`
- [x] **Headers de sécurité** sur toutes les réponses : HSTS (1 an, preload), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, **CSP** (self + Google Fonts + hôtes images ; `'unsafe-inline'` script/style = réalité SSR Nuxt, à durcir en nonces plus tard), `-Server`
- [x] **Domaine réel corrigé** : les références périmées `armurier.fr` (CORS `app.ts`, URLs d'emails reset + file admin dans `email.ts`) remplacées par une variable **`WEB_BASE_URL`** (`env.ts`, défaut `https://www.scs-firearms.com`, documentée `.env.example`)
- [x] **Vérifié** : `caddy validate` → *Valid configuration* (auto HTTP→HTTPS confirmé), `caddy fmt` ; suite API au vert (**259 tests**) après migration CORS/email, typecheck OK
- Note : les noms de service `api`/`web` résolvent sur le réseau du compose prod (Story 8.3, qui fournira `DOMAIN`/`ACME_EMAIL`/`WEB_BASE_URL`/`SITE_URL`/`NUXT_PUBLIC_API_BASE`)
**Story 8.3** — docker-compose.prod.yml + déploiement Hetzner ✅

- [x] `docker-compose.prod.yml` : stack complète **Postgres + API + Web + Caddy** sur un réseau privé `internal` ; **seul Caddy publie** 80/443 (+ 443/udp HTTP/3), tout le reste joignable par nom de service. `api`/`web` buildés depuis leurs Dockerfiles (contexte = racine), `depends_on` avec `condition: service_healthy` sur Postgres. Volumes nommés persistants : `postgres_data` (DB) + `caddy_data` (certs/ACME)
- [x] **Source unique de secrets** : `.env` (copié de `.env.prod.example`) lu **deux fois** — interpolation compose `${VAR}` (postgres/web/caddy) **et** injecté dans le conteneur API via `env_file`. `DATABASE_URL` posé par compose vers le service `postgres` (donc absent de l'exemple) ; web câblé en single-origin via `NUXT_PUBLIC_API_BASE`/`NUXT_PUBLIC_SITE_URL` (surcharge runtime de `runtimeConfig.public`)
- [x] **Schéma prod** : service `migrate` gated par profil (`--profile migrate`) buildant le **stage build** de l'API (qui a `drizzle-kit` en devDep, absent de l'image runtime prod-only) → `drizzle-kit push --force` (schema.ts = source de vérité, pas de baseline). Seed via `exec api tsx src/db/seed-cli.ts`
- [x] Guide `docs/DEPLOY.md` : provisioning VM Hetzner (ufw 22/80/443, user `deploy`, Docker), DNS apex+www, déploiement first-boot (migrate → up --build → seed), updates, ops (logs/psql/restart), gotchas (staging ACME, volumes persistants)
- [x] **Vérifié** : `docker compose config` OK pour le up par défaut **et** le profil migrate ; `.env` bien gitignoré (`.env.prod.example` suivi), seul Caddy expose des ports
- Note : backups Postgres = Story 8.4, monitoring uptime = Story 8.5 ; en attendant, snapshot VM Hetzner avant changement risqué
**Story 8.4** — Backups Postgres automatisés ✅

- [x] Service `backup` (sidecar `postgres:17-alpine` + `aws-cli`, `infra/backup/`) ajouté au compose prod : **`pg_dump -Fc -Z9` planifié par cron** (défaut `0 3 * * *` UTC) → upload **off-site vers S3** (réutilise les credentials `S3_*` Scaleway de l'app, mappés en `AWS_*`). Démarre avec la stack (`restart: unless-stopped`), healthcheck `pgrep crond`
- [x] **Rotation** par rétention : conserve les `BACKUP_RETENTION_COUNT` derniers dumps (défaut 14), purge les plus anciens (noms horodatés `YYYYMMDDTHHMMSSZ` → tri lexical = chronologique ; `sort -r | tail -n +N` portable busybox)
- [x] **Restore** (`restore.sh`) : dernier dump auto-détecté ou fichier nommé, `pg_restore --clean --if-exists --no-owner`. On-demand : `docker compose run --rm backup backup.sh|restore.sh`
- [x] Piège busybox crond résolu : les jobs cron tournent avec un **env vide** → l'entrypoint persiste l'environnement (`export -p > /etc/backup.env`) que les scripts sourcent ; sortie des jobs redirigée vers `/proc/1/fd/*` (crond = PID 1) pour apparaître dans `docker logs`
- [x] **Vérifié en réel e2e** (Postgres + MinIO éphémères) : build image OK (pg_dump 17.10, aws-cli 2.34), 3 backups avec rétention=2 → 2 conservés + le plus ancien purgé, puis **drop table → restore → données récupérées**. Vars documentées (`.env.prod.example`) + procédure complète (`docs/DEPLOY.md` §6, avec note PII/chiffrement bucket)
- Note : dump = PII clients → bucket privé à credentials scopés ; object-lock/versioning + SSE recommandés (defence-in-depth)
**Story 8.5** — Monitoring uptime + alertes — ⏸️ **DIFFÉRÉE** (2026-06-18), approche tranchée (2026-09-19)

- **Décision (2026-09-19)** : **healthchecks.io**. Uptime Kuma auto-hébergé écarté — un moniteur qui tourne sur la machine qu'il surveille tombe avec elle, exactement le jour où on veut être prévenu. Prometheus/Grafana/Loki écarté aussi : c'est un chantier, pas une story. Sentry reste un candidat **complémentaire** (erreurs applicatives), pas une sonde uptime : son offre gratuite se limite à ~1 moniteur uptime et ~5 000 erreurs/mois.
- **Modèle à retenir** : healthchecks.io est un **dead man's switch**, il ne sonde pas le site — c'est le VM qui le ping. C'est ce qui le rend pertinent ici : un ping cron depuis le VM Hetzner disparaît *de facto* si la machine tombe, et l'alerte part depuis l'extérieur. Conditionner le ping à un `curl` local sur `GET /health` (`app.ts:87`) pour distinguer « la machine répond » de « l'app fonctionne », et utiliser `/fail` en cas d'échec plutôt que de rester muet.
- **Surfaces à brancher** (3 checks, tiennent dans l'offre gratuite) : le heartbeat VM+app ci-dessus ; le **cron de backup** `pg_dump → S3` (`infra/backup/`, story 8.4) — un backup qui ne tourne plus est une panne silencieuse coûteuse ; le **cron SLA** `sla-cli.ts` (voir `sla.ts:85`).
- Reste à faire le jour de la reprise : créer les checks (compte au nom du client, cf. [[project_service_providers]]), poser les pings dans les crons, documenter dans `docs/DEPLOY.md`. L'alerting applicatif sur 5xx existe déjà (Story 7.2).

**Story 8.6** — Pentest interne avant mise en ligne ✅

- [x] **Audit complet** des 6 surfaces d'attaque (auth/authz, paiements, upload/PII, injection, infra/secrets) → rapport `docs/SECURITY_PENTEST_8.6.md`. Base saine confirmée (IDOR scoping, `requireRole`, argon2id, webhook Stripe signé, autorité prix côté serveur, Drizzle paramétré, redaction erreurs).
- [x] **Critique — upload durci** : validation par **magic bytes** (`packages/shared/src/file-signature.ts`) — le type sniffé doit être autorisé ET correspondre au `Content-Type` déclaré (bloque les payloads HTML/SVG déguisés en image). + tests unitaires shared & rejet API d'un Content-Type usurpé
- [x] **Critique — ClamAV câblé** : `getBytes` sur l'abstraction storage + client `clamd` INSTREAM sans dépendance (`legal-documents/clamav.ts`) ; `scan.ts` scanne réellement, **gated par `CLAMAV_ENABLED`** (off en dev/test, on en prod via sidecar `clamav` dans le compose, volume DB virale persistant + healthcheck). Échec daemon/storage → `error` → document reste `pending` (jamais « clean » silencieux)
- [x] **Critique — CVE deps patchées** (bypass quarantaine 90j) : fastify 5.8.5, drizzle-orm 0.45.2, form-data 4.0.6, nodemailer 9, nuxt 4.4.8, vitest 4.1.9, vite 7.3.5 → `pnpm audit` **0 high/critical**
- [x] **High — téléchargement gated sur le scan** : URL présignée émise seulement si `scanStatus === "clean"` (routes client + admin) — bytes non scannés/infectés jamais servis
- [x] **Medium** : escape JSON-LD (`serializeJsonLd`, anti-XSS stocké, 4 sites) ; vérif montant webhook Stripe (`amount_received` ≥ dû, sinon non encaissé + audit) ; algo JWT épinglé HS256 ; `Content-Disposition: attachment` sur les présignés ; `no-new-privileges` sur tous les services prod
- [x] **Vérifié** : typecheck clean (shared/api/web), **262 API / 56 shared / 10 web** au vert (nouvelle couverture : magic-bytes, Content-Type usurpé, download gated, JSON-LD, montant Stripe), compose prod valide
- [x] **Nonce CSP (drop `unsafe-inline` sur script-src)** — CSP désormais posée **par Nitro** par requête avec un nonce frais (`apps/web/server/plugins/csp.ts` + util pur testé `server/utils/csp.ts`) ; le hook `render:html` tague tous les `<script>` inline (payload d'hydratation, JSON-LD). Caddy ne pose plus la CSP. **Bonus** : ajout des origines **Stripe** (js/api/hooks/m.stripe.network) que l'ancienne CSP oubliait → le paiement CB aurait été cassé en prod. `style-src` garde `unsafe-inline` (PrimeVue injecte des `<style>` au runtime côté client — à durcir via `csp.nonce` de PrimeVue). Vérifié : build prod + preview, 0 violation CSP en navigateur (accueil/boutique/collection), +8 tests unitaires.
- Différé (documenté) : baseline de migration (vs `push --force`), rotation des secrets, clé S3 dédiée least-privilege pour les backups, `style-src` nonce (PrimeVue `csp.nonce`), 3 moderates `pnpm audit` dev/build-time uniquement, durcissement conteneur avancé (cap_drop/read_only) à valider en staging

**Audit sécurité 2026-09-05 (post-Phase 10)** — 3 audits parallèles (auth/BFF, paiement/checkout, compte/légal/admin/storage). Paiement + compte/légal/admin/storage = **RAS** (autorité prix serveur, aucun IDOR, RBAC complet, présignés gated+scoped+attachment, upload durci sans traversal, webhook signé+idempotent). Corrigé : [x] validation `?redirect=` (open-redirect) `utils/navigation.ts` ; [x] middleware CSRF Origin sur `/bff/**` `server/middleware/csrf-origin.ts` ; [x] `secure` flag sur `scs_token`/`scs_user` ; [x] 404 neutre 2 univers.

**Story 8.8** — Session **httpOnly** (token d'accès hors JS) + **reuse detection** refresh (RTR) ✅

- [x] **httpOnly** : proxy BFF `/bff/api/**` (`server/routes/bff/api/[...].ts`) attache le Bearer serveur-side depuis le cookie httpOnly `scs_token` + rotation-retry sur 401 ; body bufferisé → JSON **et** multipart passent. BFF auth pose les 2 tokens en httpOnly (renvoie seulement le user) ; `useApi` route via `/bff/api` en `useRequestFetch` (cookie forwardé en SSR) ; `useAuth` sans token en JS (`isAuthenticated` dérive de `scs_user` non secret) ; middleware gatent sur `scs_user` (l'API applique le vrai rôle). **Vérifié e2e (Playwright, stack complète)** : `scs_token` httpOnly + absent de `document.cookie` ; GET SSR authentifié, **upload légal multipart via proxy**, admin, et le chemin **401→refresh→retry** OK.
- [x] **RTR** : `refresh_tokens` += `family_id` (indexé) + `revoked_at` ; le token consommé est **gardé révoqué** (pas supprimé) → rejeu détecté ⇒ **révocation de la famille** + audit `user.token_reuse_detected` ; logout révoque la famille. Tests API +2 (rejeu tue la famille dont le token courant + audit ; rotation normale = pas de faux positif). **Suite API 299 verte.** Schéma : les 2 colonnes sont dans `schema.ts` (source de vérité) → appliquées automatiquement par `drizzle-kit push` (prod : service `migrate` = `push --force` / `just migrate` ; dev : `pnpm db:push`). L'ALTER psql local n'était que l'équivalent immédiat de `db:push` — pas de SQL à rejouer à la main. (Une baseline migration Drizzle reste une story différée.)
- Finding HIGH de l'audit : `scs_token` (JWT d'accès) + `scs_user` sont dans des cookies **lisibles en JS** → tout XSS = vol de session (mitigé partiellement par le `secure` flag + la CSP nonce, mais pas résolu).
- Fix propre = **proxy BFF `/bff/api/**`** qui lit le token dans un cookie **httpOnly** et attache le Bearer côté serveur ; l'API reste inchangée (pure Bearer). Implique : **streaming multipart** (upload docs légaux + images blog), **retry+refresh sur 401** côté proxy, **forwarding cookie SSR** (`useRequestFetch`), réécriture de `useApi`/`useAuth`. Touche **tous les appels authentifiés** → **re-test e2e exhaustif** (login, compte, commandes, upload, checkout, admin) obligatoire avant merge.
- **+ Reuse detection (RTR)** — le refresh existant est déjà solide (httpOnly, rotation, sha256, 7 j, révoqué au reset) mais **ne détecte pas la réutilisation** : rejouer un refresh token déjà tourné échoue juste en local (401) sans réaction. À ajouter : au lieu de **supprimer** le token consommé, le marquer `used_at` avec un **`family_id`** ; présenter un token déjà consommé = signal de vol → **révoquer toute la famille** (déconnexion partout) + audit log. Schéma `refresh_tokens` += `family_id`/`used_at`. Se teste avec le refacto httpOnly (même couche session, mêmes tests e2e).

**Story 8.7** — `justfile` d'orchestration ops (go-live) ✅

- Runner `just` (binaire statique, `set dotenv-load`) **en complément** des scripts pnpm — scope **ops/déploiement uniquement** : rend exécutables les blocs copier-coller de `docs/DEPLOY.md §3-§7` pour réduire l'erreur humaine à la mise en ligne.
- [x] `justfile` à la racine : recettes `deploy` (compose build + up -d), `migrate` (profile migrate), `seed`, `update` (pull+migrate+build+prune), `up` / `down` / `ps`, `logs <svc>`, `restart <svc>`, `psql`, `backup`, `backups` (liste S3), `restore [dump]` (destructif → **confirmation** via bloc bash). Validé avec `just 1.58.0` (`--list` + `--dry-run`). Pointé depuis `docs/DEPLOY.md`.
- **Décision tranchée (2026-09-05)** : `just` **plutôt que Make** — pas de pièges tabs/`.PHONY`, paramètres, `--list` auto-documenté, chargement `.env` natif, binaire unique facile à déposer sur le VM Hetzner (Ubuntu minimal). Ne **remplace pas** les scripts pnpm dev/build/test. Voir [[project_delivery_strategy]] pour le bar qualité.

**Story 8.9** — Isolation des suites de tests : supprimer la dépendance à l'ordre des fichiers ✅

> Relevé le 2026-09-10 en cherchant l'échec CI de la 7.5b (qui, lui, avait une tout autre cause : le boot Nuxt dépassait le `hookTimeout`). La suite API **passe ou échoue selon l'ordre des fichiers**. Aujourd'hui l'ordre est déterministe et tombe du bon côté, donc la CI est verte — mais elle l'est **par chance**, pas par construction. Ajouter, renommer ou scinder un fichier de test peut faire basculer l'ordre et rendre rouge une suite que personne n'a touchée.

- **Mesure** : en ne mélangeant que l'**ordre des fichiers** (`--sequence.shuffle.files=true --sequence.shuffle.tests=false`), 2 passes sur 3 sont propres et la 3ᵉ casse **4 tests**. ⚠️ Ne pas mesurer avec `--sequence.shuffle` tout court : celui-ci mélange aussi les tests **à l'intérieur** d'un fichier, ce qui casse par construction toute suite d'intégration écrite comme un récit (créer → modifier → supprimer) et gonfle le chiffre à ~25 échecs sans rien révéler d'utile.
- **Cause identifiée, précise** :
  - `legal-documents/sla.test.ts:43` fait `delete(users).where(eq(users.role, "admin"))` — il supprime **tous** les admins, **y compris celui du seed**. C'est délibéré : son test « aucun admin à notifier » exige qu'il n'en reste aucun.
  - `ancient-weapons/ancient-weapons.test.ts:380` **emprunte** l'admin qui se trouve là (`where(eq(users.role, "admin")).limit(1)`) au lieu d'en créer un, comme le font toutes les autres suites. Si la SLA passe avant, il échoue sur `No admin seeded (run db:seed)`.
- **Correctif proposé** (petit) : faire créer à `ancient-weapons.test.ts` **son propre** admin dans son `beforeAll`, avec un préfixe d'e-mail qui lui est propre, et le supprimer dans son `afterAll` — la convention que suivent déjà les 20 autres suites.
- **À vérifier au passage** : `sla.test.ts` porte deux assertions qui dépendent de l'**état global** (« exactement 2 destinataires », « aucun admin »). Elles tiennent tant que les suites nettoient derrière elles, mais elles casseraient dès qu'une suite fuirait un admin — par exemple si elle échoue avant son `afterAll`. Envisager d'assouplir la première (`toContain` plutôt que `toHaveLength`).
- [x] **Correctif** : `ancient-weapons.test.ts` crée **son propre** admin (`admin-test112@collection.local`) dans son `beforeAll` via un helper `makeAdmin`, signe le JWT avec cet id (plus de requête `where(role = admin)` ni d'`await` dans `adminHeaders`) ; le `cleanup()` existant le supprime déjà (préfixe `%test112@collection.local`, audit_logs purgés avant à cause de la FK)
- [x] **Durci** : dans `sla.test.ts`, « un seul digest à tous les admins » n'assertait plus `recipients.toHaveLength(2)` mais `arrayContaining` sur les e-mails des **deux admins créés par le test** — un admin fuité par une suite morte avant son `afterAll` ne rend plus ce test rouge
- [x] **Reproduction confirmée** : avant correctif, 2 passes sur 4 (2 fichiers, ordre mélangé) échouaient sur 4 tests `No admin seeded (run db:seed)` ; après correctif, 4/4 vertes sur le couple et **3/3 passes vertes sur la suite complète** (45 fichiers, **508 tests**)
- [x] **Documenté** dans le `README.md` (§ « Test isolation: checking the suite does not depend on file order ») : la commande de mesure, les deux règles (une suite crée son admin ; on assert sur ses propres lignes, pas sur un compte global) et l'avertissement de ne pas utiliser `--sequence.shuffle` tout court
- **Done** : les trois passes en ordre de fichiers mélangé sont vertes, et la mesure est documentée dans le README pour qu'on la refasse au lieu de la redécouvrir.

**Chore** — Passage à Postgres 18 avant la mise en prod ✅ _(2026-10-04, PR Renovate restée bloquée)_
- [x] Fait **avant** la mise en ligne, tant qu'aucune donnée de prod n'est à migrer (choix de Franck)
- [x] `postgres:18-alpine` en dev, en prod, en CI et dans l'image de sauvegarde (`pg_dump` doit suivre la version majeure du serveur)
- [x] ⚠️ L'image 18 range ses données dans `/var/lib/postgresql/18/docker` et **refuse un volume monté sur `…/data`** : le volume se monte désormais sur `/var/lib/postgresql`, ce qui permettra un futur `pg_upgrade --link`
- [x] Vérifié sur un Postgres 18.6 jetable : **597 tests API verts**, sauvegarde `pg_dump` 18.6 → restauration (41 tables) ; procédure de migration d'une base de dev 17 répétée sur une copie (données et 17 migrations identiques) et documentée dans le README

## PHASE 9 — Front, SEO & Découvrabilité (transverse)

> Remarques Franck (2026-06-10, après démo front 5.3). Palette laiton + charbon **validée** — à conserver.

**Story 9.1** — Recherche globale (armes + Gun Art) ✅

- [x] **Schéma** : colonne générée `search_vector` + index GIN `idx_artworks_search` sur `artworks` (titre A / artiste B / description C), miroir de `products` (ALTER appliqué sur `armurier_dev`, clonée par la test DB)
- [x] **API agrégée** `GET /api/search?q=&limit=` (`search/global.ts`) : produits **et** œuvres matchés sur leur `search_vector` via `websearch_to_tsquery('french', …)`, classés par `ts_rank` ; publiés uniquement ; envelope `{ query, products, artworks }`. Dédup : les produits qui adossent une œuvre Gun Art ne remontent que comme œuvres (`not exists`). Validation `searchQuerySchema` (shared)
- [x] **Front** : composant `SearchBar` réutilisable dans le header (desktop + mobile, navigue vers `/recherche?q=`) ; page `/recherche` SSR avec recherche live **debouncée** (300 ms, URL `?q=` en `replace`), états vide/erreur, mobile-first, SEO `noindex`
- Périmètre : la page résultats affiche **les œuvres** (lien `/collection/:slug`) ; les résultats « armes » sont déjà renvoyés par l'API mais seront branchés au front en **Phase 10** (la boutique armurerie n'existe pas encore) → pas de liens morts
- [x] **Vérifié** : typecheck clean (shared/api/web), **266 API** (4 nouveaux : envelope, produit non publié masqué, dédup œuvre, priceTtc/dispo, requête sans résultat) / 56 shared / 10 web au vert, Biome clean

**Story 9.2** — Page 404 soignée ✅

- [x] `app/error.vue` Nuxt cohérent avec l'identité galerie (canvas charbon + laiton, `eyebrow` « Erreur 404 », chiffre géant en hairline, message distinct 404 / 500), wrappé dans `NuxtLayout` (header + footer conservés)
- [x] CTA « Voir la collection » (primary) + « Retour à l'accueil » (ghost) via `clearError({ redirect })` (réinitialise la frontière d'erreur avant navigation, contrairement à un lien nu)
- [x] Bon status HTTP (404 réel renvoyé sur slug inconnu) ; SEO `robots: noindex, follow`
- [x] **Vérifié** : SSR sur route inconnue → 404 + page galerie rendue (chiffre 404, titre, CTA, noindex) ; 10 tests web au vert, Biome clean (typecheck `nuxt typecheck` KO sur cette machine — toolchain `vue-tsc`/`vue-router` 5.0.3, indépendant du changement)

**Story 9.3** — Œuvres en orientation portrait ET paysage ✅

- [x] **Data** : colonne `orientation` (`portrait` | `landscape` | `square`, défaut `portrait`) sur `artworks` — propriété de l'image, pas du format papier, donc stockée explicitement et éditable au backoffice (ALTER appliqué sur `armurier_dev`, cloné par la test DB). Type + garde `normalizeOrientation` dans `shared`
- [x] **API** : `orientation` exposée par `GET /api/artworks` (liste), `GET /api/artworks/:slug` (détail) et `GET /api/search`
- [x] **Front** : helper `artworkGeometry(orientation)` → `{ ratio, width, height }` ; carte (`ArtworkCard`) et hero détail à `aspect-ratio` dynamique (object-fit cover, plus de `4/5` figé), `width`/`height` intrinsèques alignés (anti-CLS) ; grilles collection + recherche en `align-items: start` (hang galerie léger quel que soit le ratio)
- [x] **Seeds** : orientations variées (3 paysage / 2 portrait / 1 carré) + image picsum aux dimensions correspondantes
- [x] **Vérifié** : payload API (orientation par œuvre), SSR collection (2× `4/5`, 3× `3/2`, 1× `1/1`) + détail paysage `3/2` / portrait `4/5` ; **266 API** / 58 shared (`normalizeOrientation`) / 13 web (`artworkGeometry`) au vert, Biome clean

**Story 9.4** — Blog (SEO-first) ✅

- [x] **Data** : table `blog_posts` déjà présente (slug, title, excerpt, content, authorId FK users, category, tags, featuredImageUrl, meta\*, published, featured, publishedAt) — réutilisée ; FK `author_id` passée en `ON DELETE SET NULL` (un admin supprimé ne bloque plus / n'orpheline plus ses articles)
- [x] **Shared** : `blogSlugSchema`, `blogArticleCreateSchema` (.strict), `blogArticleUpdateSchema` (.strict.refine), `blogQuerySchema` (published+search+pagination) + types + tests
- [x] **API public** : `GET /api/blog` (publiés, newest-first, paginé, auteur joint) + `GET /api/blog/:slug` (contenu complet, 404 sur brouillon/inconnu)
- [x] **API admin** : `/api/admin/blog` CRUD (`requireRole("admin")`) — liste filtrable, get, create (auteur=session, `publishedAt` auto), update (bascule publication → stamp/clear `publishedAt`), delete ; 409 slug en double
- [x] **Front public** : `/blog` (SSR, SEO, JSON-LD `Blog`/`BlogPosting`, lien RSS) + `/blog/:slug` (SSR, JSON-LD `BlogPosting` + `BreadcrumbList`, corps HTML, 404 réel) ; `BlogCard` ; liens header + footer
- [x] **Front admin** : `/admin/blog` (liste + filtres + pager), `/admin/blog/new` + `/admin/blog/:id` (formulaire partagé `AdminBlogForm`, slugify auto, suppression) ; entrée nav backoffice
- [x] **RSS** : route Nitro `/blog/rss.xml` (RSS 2.0, cache 10 min) ; `<link rel=alternate>` sur l'index. (`sitemap.xml` global → story 9.5)
- [x] **Seed** : 3 articles de démo (Histoire / Atelier / Collection) avec images picsum
- [x] **Vérifié** : `pnpm -r typecheck` clean, **279 API** (13 blog) / 65 shared / 13 web au vert (suite API stable ×3), Biome clean ; smoke SSR `/blog`, `/blog/:slug`, 404, RSS OK
- [x] **9.4b — Éditeur WYSIWYG** (décision validée avec Franck : rich text plutôt que HTML brut) : `RichTextEditor` (TipTap 3.20.4 — gras/italique/souligné/barré, H2/H3, listes, citation, **liens**, **images**) dans `AdminBlogForm`. Upload d'images `POST /api/admin/blog/images` (admin) → conversion **WebP** (sharp 0.34.5, qualité 80, max 1600px) → service public durable `GET /api/blog/images/:filename` (cache long). URL relative + devProxy Nitro en dev (origine unique via Caddy en prod). **Sanitization serveur** au save (`sanitize-html` 2.17.2, liste blanche alignée sur la sortie TipTap). Vérifié : **284 API** (5 nouveaux : upload→WebP→serve e2e via storage mémoire, rejets non-image, 403/401, 404 path-traversal, sanitization au save) / 65 shared / 21 web au vert, Biome clean, devProxy OK

**Story 9.5** — Agent-ready / découvrabilité IA ✅

- [x] **`sitemap.xml`** : route Nitro dynamique (`server/routes/sitemap.xml.get.ts`) — accueil + collection + journal + chaque œuvre + chaque article (lastmod sur les articles), tirée de l'API ; `/recherche` exclue (noindex)
- [x] **`robots.txt`** : passé en route Nitro dynamique (statique supprimé) avec directive `Sitemap:` absolue + `Disallow: /recherche` et `/admin`
- [x] **`llms.txt` + `llms-full.txt`** (convention llmstxt.org) : `/llms.txt` concis (résumé + sections + liens + endpoints API JSON) ; `/llms-full.txt` enrichi (catalogue des œuvres + articles avec descriptions), tiré de l'API
- [x] **Structured data** : ajout sitewide `WebSite` + `SearchAction` (sitelinks search box → `/recherche?q=`) et enrichissement `Organization` (description, slogan) dans `app.vue` ; JSON-LD existant conservé (VisualArtwork/Offer/ItemList/BreadcrumbList/BlogPosting/Blog)
- [x] **Builders purs** `server/utils/seo.ts` (`buildSitemap`/`buildRobots`/`buildLlmsTxt`/`buildLlmsFull`/`escapeXml`, réutilisé par le flux RSS) — testés (`server/**` ajouté à l'include vitest web)
- Périmètre : exposition MCP en lecture **étudiée mais non implémentée** (l'API JSON publique est déjà documentée dans `llms.txt` comme surface agent ; MCP = amélioration future)
- [x] **Vérifié** : smoke `/sitemap.xml` (12 URLs), `/robots.txt`, `/llms.txt`, `/llms-full.txt`, WebSite/SearchAction en home ; `pnpm -r typecheck` clean, **279 API / 65 shared / 21 web** (8 nouveaux `seo.test.ts`) au vert, Biome clean

**Story 9.6** — SEO avancé « aux petits oignons » — ✅ **codée le 2026-09-24** (branche `feat/story-9.6-seo`, PR à ouvrir)

> Objectif : passer d'un SEO déjà solide (9.1–9.5) à un niveau **irréprochable** — audit Lighthouse SEO 100 + Rich Results Test / validateur Schema.org verts comme critères de *done*.

- **⚠️ Combler le retard Phase 10 (prioritaire)** : la Phase 9 SEO a été construite **avant** que la boutique armurerie existe → aujourd'hui **le sitemap ne liste que Gun Art** (collection/œuvres/blog, **aucun `/boutique` ni produit**), et `llms.txt`/`llms-full.txt` décrivent l'armurerie comme « à terme ». À corriger : sitemap += `/boutique` + chaque produit (+ catégories), llms.txt/full réécrits pour les **2 univers**, `Organization`/`WebSite` cohérents.
- **Données structurées produit** : `Product` + `Offer` complets sur les fiches armurerie (prix TTC, disponibilité, marque, SKU, catégorie légale), `BreadcrumbList` sur boutique/produit/collection, `ItemList` sur les listings ; valider chaque type au Rich Results Test.
- **Social cards** : OG + **Twitter `summary_large_image`** complets partout (title/description/image/url), images OG dédiées par produit/œuvre (featured ou générées), `og:type` correct par page.
- **Perf / Core Web Vitals** : images responsives (`srcset` + AVIF/WebP — évaluer `@nuxt/image`, **décision dépendance à trancher**), preload LCP, `font-display` + preconnect (déjà partiel), budget Lighthouse ; viser LCP < 2,5 s / CLS ~0 / INP bas.
- **Sitemap avancé** : `lastmod` partout, `changefreq`/`priority` cohérents, **image sitemap**, split si volumineux ; ping/déclaration.
- **Rich results métier** : `FAQPage` / `HowTo` sur pages réglementation (« comment acheter une arme légalement », catégories B/C/D) ; `Store`/`LocalBusiness` (adresse, horaires) si point de vente physique.
- **Hygiène technique** : canonicals sur vues filtrées/paginées, cohérence trailing-slash + redirections 301, **audit des meta descriptions/titres uniques**, `hreflang` fr, `theme-color`, `manifest`.
- **Mesure** : Search Console (vérification + soumission sitemap) et **analytics** (GA4 / Plausible — **décision en attente**, cf. `docs/CLARIFICATIONS_A_TRANCHER.md` §I/G2).
- **Agent-ready** : maintenir `llms.txt` à jour avec les 2 univers ; envisager l'exposition MCP en lecture (étudiée en 9.5, non implémentée).

**Livré (2026-09-24)** — décisions de Franck du jour : images = **variantes sharp côté API** (pas de `@nuxt/image`), analytics = **Umami auto-hébergé + bandeau de consentement quoi qu'il arrive**, **pages de catégorie indexables**, **pas de point de vente physique**, **pages réglementation rédigées par Claude puis relues**, **politique de confidentialité dans la 9.6**, et correction du rate-limit par **appel interne + IP de confiance**.

- [x] **Sitemap complet** via `GET /api/seo/sitemap` (une requête, `updatedAt` + image, mêmes règles de visibilité que les pages) : boutique, **catégories**, **chaque produit**, armes de collection, Gun Art, journal ; `lastmod` partout, **image sitemap**, URL percent-encodées. 🐞 L'espace de noms était `sitemap.org` au lieu de `sitemaps.org`
- [x] **Pages de catégorie** `/boutique/categorie/[slug]` (title, description, H1, canonical propres) ; `?category=` → **301** ; slug produit `categorie` réservé (schémas partagés) ; composant `ShopCatalogue` partagé ; 🐞 les sélecteurs de catégorie affichaient « toutes » après hydratation
- [x] **llms.txt / llms-full.txt** réécrits pour les **2 univers** (contraintes légales pour un agent, catalogue armurerie complet par catégorie, prix au format français)
- [x] **Données structurées** : `Product`/`Offer` complets (vendeur, état neuf/occasion, fabricant, catégorie légale, `AggregateOffer` sur déclinaisons), œuvres en `VisualArtwork` + `Product` tant qu'il reste des tirages, `ItemList` sur les listings, **`AppBreadcrumbs`** unique (fil visible + `BreadcrumbList`, passe par la catégorie / la série), **une seule `Organization`** avec `@id` et deux `OnlineStore`. 🐞 `image` était l'objet `{src, fallback}` (placeholder `data:`) sur produits et œuvres, et relative sur le journal
- [x] **Social cards** partout (`usePageSeo`) : OG + Twitter complets, **carte de marque** 1200×630 par défaut, descriptions bornées à 160 car. ; favicon, icônes, manifest (**monogramme provisoire** en attendant un logo)
- [x] **Hygiène** : slash final et majuscules → **301** ; **`X-Robots-Tag: noindex`** sur compte/panier/commande/auth/newsletter/recherche ; `robots.txt` ne bloque plus `/recherche` (son noindex n'était jamais lu) ; `hreflang` jugé inutile (site monolingue)
- [x] **Images responsives** : AVIF + WebP à 400/800/1400 px (le filigrane aussi en AVIF), `<picture>` + `sizes` par mise en page, **backfill** `media:backfill-avif`. Mesuré : une carte desktop charge 47 Ko (`400.avif`) au lieu d'environ 255 Ko
- [x] **Consentement + Umami** (3.2.0, base dédiée, script servi depuis `/_a/`, tableau de bord sur `stats.`) ; **politique de confidentialité** `/confidentialite` ; **guide réglementation** `/reglementation` + `FAQPage` (pas de `HowTo` : abandonné par Google en 2023)
- [x] **Search Console** : balise de vérification par variable d'env, procédure dans `docs/DEPLOY.md`
- [x] 🔐 **Sécurité (trouvé en audit)** : tout le SSR partageait **un seul quota de rate-limit** (IP du serveur Nuxt) — un robot suffisait à faire tomber le catalogue ; `trustProxy: true` rendait le rate-limit **contournable** (XFF choisi par le client) ; les fiches répondaient **404 sur toute erreur API** (désindexation). Corrigé : appel interne + IP visiteur + secret, confiance limitée au pair privé, Caddy écrase XFF, **503** hors vrai 404
- [x] ⚡ **Perf** : le module PrimeVue injectait **~470 Ko de CSS** et sérialisait le thème (~125 Ko) dans **chaque page publique** → HTML 645 Ko → **76 Ko**
- [x] **Mesuré (Lighthouse mobile, build de prod derrière compression)** : **SEO 100 sur les 8 pages types**, CLS 0, accessibilité 95-100, performance 83-89, **LCP 3,2-3,9 s**

**Reste ouvert :**

- ⚠️ **Relecture de Fred et Steph** : `/confidentialite` et `/reglementation` sont en **noindex** et hors sitemap tant que `reviewed` n'est pas basculé dans `apps/web/shared/utils/editorialPages.ts`. La politique attend : **raison sociale, SIRET, adresse, e-mail de contact**, **durées de conservation** (compte, pièces justificatives, journal d'audit, statistiques), prestataire SMTP
- ⚠️ **Données de seed à corriger après validation** : la catégorie D est décrite « libres de **port**/détention » (faux : port et transport interdits sans motif légitime) ; la catégorie C n'accepte que le permis de chasser comme pièce (la **licence de tir** devrait l'être aussi)
- **LCP mobile 3,2-3,9 s** (objectif 2,5 s). Pistes mesurées : **retirer PrimeVue**, installé mais **aucun composant n'est utilisé** (bundle d'entrée 397 → 209 Ko, LCP accueil 3,3 → 3,0 s) — ✅ **retiré le 2026-10-03** (accord de Franck) : module, thème Aura et 3 dépendances supprimés, aucun composant/directive/composable PrimeVue n'était utilisé (vérifié par analyse des gabarits) ; build de prod : bundle d'entrée **211 Ko** (79 Ko gzip), aucune trace de PrimeVue dans le HTML ; `style-src 'unsafe-inline'` conservé (CSS inliné par Nuxt au SSR + attributs `:style`, qu'un nonce ne couvre pas) ; ensuite police de titre en sous-ensemble, CSS critique
- **Droits RGPD** : pas de **suppression de compte** ni d'**export des données** en libre-service (la politique renvoie vers l'e-mail) ; pas de purge des comptes supprimés (`deletedAt` jamais utilisé)
- Alerte « Content security policy » dans les bonnes pratiques Lighthouse (déjà présente avant la story, sans détail) — à creuser
- Images OG **générées** par produit sans visuel (aujourd'hui : carte de marque) ; exposition **MCP** en lecture (non faite) ; logo définitif
- Mise en ligne : créer la base Umami, `INTERNAL_API_SECRET`, enregistrement DNS `stats`, backfill AVIF (`docs/DEPLOY.md`)

**Story 12.1** — Mentions légales & CGV — 🚧 **CODÉE, TEXTES EN ATTENTE DU CLIENT ET D'UN JURISTE** _(créée le 2026-09-24, sortie de la 9.6 ; codée le 2026-09-29)_

- Pages **mentions légales** (éditeur, hébergeur, directeur de publication) et **CGV** (vente à distance, droit de rétractation et ses exceptions, spécificités des armes réglementées, livraison, garanties), rédigées puis **relues par un juriste** ; même mécanisme de relecture que `/confidentialite`
- Liens dans le pied de page et au tunnel d'achat (acceptation des CGV à la commande)

**Décisions validées avec Franck (2026-09-29) :**

- [x] Acceptation des CGV **versionnée et enregistrée** : `orders.terms_version` + `terms_accepted_at` (migration `0013`)
- [x] **Une seule CGV** pour les deux univers : tronc commun + article 12 (articles réglementés) + article 13 (tirages Gun Art)
- [x] Identité légale en **champs à compléter** (le client ne l'a pas encore fournie) ; hébergeur pré-rempli (Hetzner)

**Livré :**

- [x] **`CURRENT_TERMS_VERSION`** (`packages/shared/src/terms.ts`, date ISO du texte) : la case du tunnel l'envoie, l'API **refuse en 409 `TermsOutdated`** une autre version (texte modifié depuis l'ouverture de la page) et la stocke avec l'heure d'acceptation — preuve du texte sous lequel chaque commande a été passée. ⚠️ **Toute modification du texte de `/cgv` doit incrémenter cette version**
- [x] **Tunnel** : case jamais pré-cochée + lien vers `/cgv` (nouvel onglet), bouton renommé **« Commander avec obligation de paiement »** (art. L221-14 C. conso. : « Valider la commande » n'était pas conforme)
- [x] **`/mentions-legales`** et **`/cgv`** (avec le **formulaire type de rétractation**, annexe à l'art. R221-1), en brouillon `noindex` hors sitemap via `EDITORIAL_PAGES` ; liens dans le pied de page
- [x] **Identité légale écrite une seule fois** (`apps/web/shared/utils/legalIdentity.ts`) et reprise par les trois pages (confidentialité comprise) via `<LegalFact>` ; **un test interdit de basculer `reviewed`** sur l'une d'elles tant qu'un champ manque
- [x] **E-mail de confirmation de commande** (art. L221-13, trouvé manquant pendant la story) — décisions Franck : **texte intégral des CGV dans l'e-mail** (un lien vers une page modifiable n'est pas un support durable) et **colonne + relance**. Le texte des CGV devient des **données partagées** (`packages/shared/src/terms-content.ts`) que la page `/cgv` et l'e-mail rendent tous deux ; l'identité légale passe dans `shared`. Envoi **en tâche de fond** après la commande, **au plus une fois** (`orders.confirmation_sent_at` réclamé avant l'envoi, libéré en cas d'échec, migration `0014`) ; relance toutes les `ORDER_CONFIRMATION_RETRY_MINUTES` (15) ou `orders:confirmations` en cron. Contenu : récapitulatif, prochaines étapes (carte, virement + référence, pièces à déposer), adresse, rétractation, vendeur, **CGV acceptées + formulaire de rétractation**. `orderReference()` factorise la référence recopiée dans 5 fichiers
- [x] Cadre commun **`<LegalPage>`** pour les quatre pages éditoriales (les deux pages 9.6 y sont passées) ; `apiErrorCode()` factorise la lecture du code d'erreur API ; `UNIQUE_PIECE_HOLD_MINUTES` déplacé dans `shared` (les CGV l'affichent)

**Reste ouvert :**

- ⚠️ **À fournir par le client** (`legalIdentity.ts`) : raison sociale, forme, capital, RCS, SIRET, TVA, adresse, téléphone, e-mails (contact + données personnelles), directeur de la publication, **autorisation préfectorale de commerce d'armes**, **médiateur de la consommation** (adhésion obligatoire, art. L612-1)
- ⚠️ **Points des CGV à trancher** (surlignés sur la page) : zone de livraison, grille de frais de port (**le récapitulatif du tunnel n'en affiche aucun**), délai de paiement du virement, délai d'expédition, délai laissé pour fournir les pièces, remise contre signature, articles personnalisés vendus ou non, garantie d'occasion des armes de collection
- ⚠️ **Relecture par un juriste** : texte complet, **encadré réglementaire des garanties légales** (décret 2022-946), qualification du mandat de vente Gun Art
- La plateforme européenne de règlement en ligne des litiges (RLL) a fermé le 20 juillet 2025 : ne pas la réintroduire

**Story 12.2** — Import des catalogues fournisseurs (collecte → tri `.xlsx` → import admin) — 🚧 **MOTEUR LIVRÉ, COLLECTE COMPLÈTE EN ATTENTE DU CLIENT** _(créée le 2026-09-28, demande client)_

> Besoin : récupérer les catalogues de 7 fournisseurs, les agréger dans **un fichier de tri** où le client coche ce qu'il reprend, puis **tout importer en une fois**. C'est un **import ponctuel, pas une synchronisation**. Le moteur d'import, lui, est **pérenne** : il resservira à chaque nouveau fournisseur.
>
> Le client a un **compte pro** chez chaque fournisseur et un **tarif Excel** par fournisseur. Ce qui lui manque, ce sont les **fiches détaillées** (descriptions, caractéristiques, photos) : c'est la vraie valeur de la collecte.

**Décisions validées avec Franck :**

- [x] Rapprochement fiches ↔ tarifs **outillé** (pas de RECHERCHEV à la main) ; fiches depuis les **pages publiques**, prix depuis les **tarifs Excel** du client
- [x] Fichier de tri en **`.xlsx`** ; l'import accepte **`.xlsx` et `.csv`**
- [x] Dépendances : **exceljs 4.4.0** (sous-chemin `@armurier/shared/spreadsheet`, jamais dans le bundle web ; son `uuid` forcé en 11.1.1 pour GHSA-w5hq-g745-h8pq), **cheerio 1.2.0** (outil de collecte seulement), **aucune** pour le CSV (lecteur maison RFC 4180, qui sert aussi désormais au rapprochement bancaire)
- [x] Schéma (migration `0012`) : `products.brand` / `ean` / `source_url`, **unique (`supplier_id`, `supplier_sku`)**, nom de fournisseur unique **sans casse**, tables `catalog_imports` (journal : qui, quel fichier, empreinte, compteurs) et `catalog_import_images` (file des images)
- [x] Collecteurs dans `tools/catalog-collect` (paquet du monorepo, **jamais déployé**, données dans `work/` hors git et hors image Docker)

**Livré :**

- [x] **Moteur partagé** (`packages/shared/src/catalog-import.ts`) : format pivot `collectedProductSchema`, référence fournisseur **normalisée** (casse, espaces, tirets, points ignorés ; zéros de tête **conservés**), **EAN avec clé de contrôle** (un `4.00638E+12` d'Excel est refusé, pas reconstruit), lecture d'un tarif dont on ne connaît que les noms de colonnes (en-tête trouvé sous les lignes de titre), **rapprochement** réf. puis EAN — une référence en double dans le tarif est **ambiguë et jamais tranchée** —, prix de vente proposé = achat ÷ (1 − marge), **même définition de marge que la rentabilité 11.10**
- [x] **Colonnes du fichier de tri définies une seule fois** (`CATALOG_IMPORT_COLUMNS`) : le générateur les écrit, l'import les relit — ils ne peuvent pas diverger (test aller-retour)
- [x] **Import admin** `/api/admin/catalog-imports` : `POST /preview` (à blanc, rapport ligne par ligne : création / mise à jour / erreur + motifs / avertissements), `POST /` (confirmation **refusée si le fichier n'est pas celui prévisualisé** — SHA-256), historique, images en échec, relance
  - Chaque ligne passe les mêmes limites que le formulaire produit ; `longDescription` passée par `sanitizeRichTextHtml` ; `requiresLegalVerification` et nombre de colis **dérivés côté serveur**
  - **Une seule transaction** : tout le lot passe ou rien. Les lignes en erreur sont **laissées de côté** (montrées à l'aperçu) — les corriger puis réimporter est sans risque
  - **Idempotent** : ré-importer met à jour. Sans « écraser », seuls les champs **vides** sont remplis (les retouches humaines sont gardées) ; le **prix fournisseur suit toujours** le fichier ; une catégorie légale différente est **signalée**, jamais changée en silence
  - Fournisseur inconnu → **créé**, et **listé à l'aperçu** (une faute de frappe s'y voit) ; catégories reconnues par slug **ou** par nom ; Gun Art refusé (écran dédié) ; œuvres et armes de collection intouchables
  - Formule non évaluée dans une cellule (`=…`) refusée ; CSV Windows-1252 d'un Excel français lu correctement (’ et € compris — le décodeur de Node les rendait en caractères de contrôle)
- [x] **Images** : mises en file à la confirmation, téléchargées **après** la réponse par le même chemin que l'upload admin (`appendOwnerMedia`, factorisé depuis la route média), dans l'ordre de la cellule (la 1re devient l'image principale), 3 tentatives, échec définitif immédiat sur 4xx / adresse refusée / fichier non image ; `FOR UPDATE SKIP LOCKED` pour que deux vidanges ne traitent jamais la même image ; reprise `pnpm --filter @armurier/api catalog:images`
  - ⚠️ **Anti-SSRF** (`net/safe-fetch.ts`) : les URL viennent d'un fichier, pas de nous. L'adresse **réellement connectée** est vérifiée (hook `lookup`, donc aussi contre le DNS rebinding), à chaque redirection : privé, loopback, lien-local / métadonnées cloud (169.254.169.254), CGNAT, multicast, IPv4 mappée en IPv6, NAT64 refusés ; schémas autres que http(s) et identifiants dans l'URL refusés ; taille et durée plafonnées
- [x] **Écran `/admin/imports`** (lien « Import catalogues ») : dépôt, option « écraser », compteurs, filtres (erreurs / avertissements / créations / mises à jour), pagination côté client pour les gros lots, bouton qui dit exactement ce qu'il va faire, historique rafraîchi tant que des images se téléchargent, liste des images en échec + relance
- [x] **Outil de collecte** `tools/catalog-collect` (README dédié) : `pnpm collect <fournisseur> [--only <motif>] [--limit n]`, `pnpm triage`
  - Client HTTP **courtois** commun à tous : `robots.txt` et `Crawl-delay` respectés, 1,5 s mini entre deux requêtes d'un même hôte, recul sur 429/5xx (`Retry-After`), `User-Agent` identifié, **cache disque** (une page n'est jamais demandée deux fois), cookie de session si le site l'exige
  - Collecte **reprenable** (pages déjà collectées sautées), doublons d'une même référence sous plusieurs catégories écartés, pages en échec journalisées à part
  - Adaptateurs : **Agora-Tec + Cor Caroli** (même plateforme « Doing » : menu → filtre en session → listing AJAX ; réparation des apostrophes stockées en caractères de contrôle), **BGM Winfield** (JSON-LD ; **images originales** 1080 px plutôt que les agrandissements 1440), **Humbert** (familles → lots « Voir plus » → articles frères de chaque modèle ; **classement légal annoncé par Humbert** conservé à part), **Toro Distribution** (sitemap pour le catalogue complet, méga-menu + sous-catégories récursives pour un périmètre ; JSON `data-product` ; déclinaisons résumées en une caractéristique ; `wholesale_price` des packs **jamais lu** — test à l'appui), **ESP France** (sitemap de 2014 + 1re page de chaque catégorie : `robots.txt` interdit la pagination, **couverture partielle assumée** ; « Vente Libre / Arme Réglementée » conservé comme classement fournisseur)
  - Fichier de tri : onglets « À trier » (articles rapprochés en tête, **listes déroulantes** Importer / Catégorie / Catégorie légale, colonne **« Classement fournisseur »** à côté de la catégorie légale — affichée, **jamais recopiée**), « Prix sans fiche », « Lisez-moi », catégories chargées depuis l'API ; règles de proposition par fournisseur dans `work/config.json` (la catégorie légale n'est proposée **que** si un humain l'a écrite dans une règle). **Ajout 2026-10-03** : une règle peut viser le **classement fournisseur** (`"field": "supplierLegalClass"`, ex. `^B` → B pour les codes Humbert C1a/B2e…) — la correspondance reste écrite à la main une fois, l'outil ne déduit toujours rien ; et la première règle qui fixe **chaque** champ l'emporte (une règle de rayon et une règle de classement s'appliquent au même article). Essai réel sur 1 363 fiches Humbert : toutes les B*/C* classées, les 10 « NR » laissées vides
- [x] Tests : **shared** 220, **API** +43 (import : 11 d'intégration, anti-SSRF : 32), **web** +3, **outil de collecte** 79 (fixtures réduites des vraies pages, zéro accès réseau ; exclues de Biome, ce sont des pages fournisseurs telles quelles)
- [x] **Validé en réel** (2026-09-28) : essai limité à 2-3 articles par site sur les **6 fournisseurs collectables** → fichier de tri → aperçu → import contre l'API locale → **11/11 images téléchargées**, prix de vente conformes à la marge, produits hors ligne ; ré-import du même fichier = 3 mises à jour, 0 doublon ; données de test nettoyées ensuite

**Revue de code avant merge (2026-09-28) — 10 défauts corrigés :**

- [x] **File d'images** : le `FOR UPDATE SKIP LOCKED` ne réservait rien au-delà de l'instruction (deux vidanges pouvaient télécharger la même image → doublons dans la galerie) → **bail `locked_until`** (colonne ajoutée à la 0012, jamais déployée) ; une image dont le travailleur meurt à la dernière tentative restait `pending` à vie → **marquée `failed`** (« Interrupted during download ») ; 408/429 étaient traités comme définitifs → **réessayés** ; nouvelle tentative **différée** (30 s puis 2 min) au lieu du lot suivant ; ordre de la galerie non garanti après un échec passager → seule la **première image en attente de chaque produit** est réclamable ; une vidange qui se terminait pouvait ignorer un import arrivé à cet instant → **relance** ; la reprise CLI suit la même boucle
- [x] **Écrasement** : un Stock / une TVA vides devenaient 0 / 20 % et **effaçaient le stock réel** → vide = « non fourni » (défaut à la création seulement) ; le **nombre de colis** est recalculé quand la catégorie légale change
- [x] TVA 100 acceptée alors que la colonne plafonne à 99,99 → toute la transaction tombait → refusée à la ligne
- [x] Une panne de stockage pendant le rendu d'une image passait pour « image inutilisable » (échec définitif) → seules les erreurs de **décodage** le sont
- [x] Repli texte des très longues descriptions : l'échappement faisait dépasser les 20 000 caractères → ajusté jusqu'à tenir
- [x] En plus : `safeGet` a une **échéance globale** (un serveur qui distille un octet à la fois n'est plus jamais « inactif ») ; numéros de ligne CSV **exacts** malgré les lignes vides ; historique des imports en **une requête** (au lieu d'une par import)
- Tests après corrections : **shared 222, API 573, web 299, outil 79**

**Espaces pro des fournisseurs (2026-10-07)** : le client a des accès revendeur et souhaite qu'on s'en serve, **en lecture seule et sans risquer de bloquer ses comptes**.

- [x] Reconnaissance faite avec ses accès :
  - **BGM** : prix d'achat **HT** + coefficient de revente sur chaque fiche ;
  - **Cor Caroli** : « Votre prix » ;
  - aucun des deux n'expose d'EAN, de quantité en stock ni de tarif téléchargeable.
- [x] Connexion dans l'outil :
  - identifiants dans `tools/catalog-collect/.env`, ignoré par git et Docker ;
  - connexion **une seule fois**, **jamais rejouée** en cas de refus ;
  - redirection de connexion suivie à la main, pour garder le cookie de session ;
  - chaque page doit encore être servie connectée, sinon **`SessionLostError` arrête la collecte** sans rien mettre en cache ;
  - cache séparé `cache/<fournisseur>-pro/`.
- [x] `purchasePrice` ajouté au format pivot. Le tri l'utilise **comme un tarif** (même rapprochement) quand aucun tarif n'est configuré. Il n'est lu que sur une page connectée ; chez BGM, seulement s'il est libellé HT ; jamais depuis le JSON-LD public.
- [x] **Validé en réel** sur 2 articles BGM et 2 articles Cor Caroli : connexion acceptée, prix lus. Outil : **92 tests**.
- [x] **Cor Caroli** : la fiche n'indique pas si « Votre prix » est HT, mais leurs CGV le disent (« Nos prix s'entendent nets **hors taxes** départ stock », vérifié le 2026-10-07). La collecte complète peut être lancée.
- **ESP** : une fois les identifiants corrigés, la connexion marche et les fiches affichent « Prix Revendeur … HT ». **Mais son `robots.txt` interdit `/authentication.php`.** Franck a choisi de **rester strict** (2026-10-07) : pas de connexion, fiches publiques comme avant. **Le prix d'achat viendra du tarif Excel d'ESP**, à leur demander.
- **ClearMyVault** (nouveau fournisseur, fabricant d'agencement de coffres) : **pas de collecte possible**. La boutique est derrière une protection anti-robots (LWS / Anubis), qu'on ne contourne pas, et le `Crawl-delay` est de 60 s. Il faut leur demander leur catalogue pro (fichier + photos) et l'importer, ou saisir à la main.
- **Humbert** : on attend son tarif CSV.

**Reste ouvert :**

- ⚠️ **Attendu du client** : un **tarif Excel par fournisseur** (pour caler les colonnes dans `work/config.json`) et le **périmètre** (catalogue complet ou familles : Agora-Tec annonce 4 464 articles dont de la cuisine, BGM 6 079, Toro ~12 300, Humbert plusieurs milliers d'articles avec toutes les déclinaisons)
- **Droits sur photos et textes** des fournisseurs : à faire confirmer par le client pour chacun
- **Durée de collecte** : ~1,5 s par page → compter plusieurs heures pour un catalogue complet (lancer par familles, la reprise est automatique)
- **Armurerie de Paris** : hors collecte (`robots.txt` interdit tout, pas de catalogue en ligne) → saisie manuelle ou via l'import
- **Variantes** : une ligne = un produit (chaque déclinaison a sa propre référence chez ces fournisseurs) ; regroupement en `product_variants` non fait
- **EAN** : aucun des sites visités ne l'expose — il ne viendra que des tarifs qui le portent
- Non traité (mineur) : l'aperçu charge tous les produits des fournisseurs connus, la confirmation écrit ligne par ligne (acceptable pour quelques milliers d'articles) ; une cellule Excel contenant un lien rend l'adresse du lien plutôt que le texte affiché
- Lecture `.xlsx` sans garde contre une **bombe zip** au-delà du plafond de 15 Mo du fichier déposé (route réservée aux admins)
- ~~Pas d'**écran fournisseurs**~~ → réglé par la **story 12.5** (écran Fournisseurs, l'import n'accepte plus que les fournisseurs déclarés)

**Story 12.3** — Frais de port au tunnel d'achat — ✅ **CODÉE** _(créée le 2026-09-29, trouvé en 12.1 ; codée le 2026-10-03)_

> Constat : `orders.shipping_cost` vaut **toujours 0** et le récapitulatif du tunnel n'affiche **aucun frais de port** — chaque envoi serait à la charge de la boutique, et le client doit connaître le **prix total livraison comprise avant de commander** (C. conso. L221-5, L112-1). Bloquant pour la mise en ligne.

**Décisions tranchées avec Franck (2026-10-03) :**

- [x] **Modèle de calcul** : **forfait par classe d'envoi**, sans poids. Arme = forfait **par colis** (× `parcelCount`, donc 2 pour une arme de cat. B), envoi assuré contre signature compris ; munitions et accessoires = **un forfait par commande** (« petits colis ») ; tirage Gun Art = forfait **par tirage** (emballage dédié). Total = somme des classes présentes.
- [x] **Gratuité** : seuil réglable, **sur les petits colis seulement** (munitions + accessoires) ; armes et tirages restent payants. **La remise VIP ne s'applique pas au port.**
- [x] **Transporteur imposé** par la boutique (choisi à l'expédition, écran 11.9) : un seul tarif affiché au client, pas de point relais pour les armes.
- [x] **Zone** : **France métropolitaine, Corse comprise**, grille unique ; le tunnel refuse une adresse de livraison hors zone (pays ≠ FR, codes postaux 97/98). Le « À compléter » des CGV est rempli → `CURRENT_TERMS_VERSION` incrémentée.
- [x] **Grille en écran admin** (table + migration, modifications au journal d'audit), grille par défaut à remplacer par celle du client.
- [x] **TVA du port au prorata** des taux des articles du panier.

**Livré (2026-10-03) :**

- **Calcul partagé** `computeShippingCost` (`packages/shared/src/shipping-costs.ts`) : chaque classe produit des « tranches » de port portant le **taux de TVA et le canal de paiement** de l'article transporté — le port d'une arme payée par virement part dans le virement, et le forfait petits colis est réparti **au prorata du HT net** des articles qu'il transporte (méthode du plus fort reste : aucun centime perdu ni inventé). Montants saisis TTC, HT dérivé de façon que HT + TVA = TTC au centime près (`PaymentSplitItem.vatAmount`).
- **Grille en base** : table `shipping_rates` à ligne unique (migration **0015**, grille par défaut 25 € / colis arme, 8,90 € petits colis offerts dès 150 €, 15 € / tirage). Écran **`/admin/livraison`** + `GET/PUT /api/admin/shipping-rates` (remplacement entier, journal d'audit avant/après). Grille absente ⇒ grille par défaut, **jamais un port à zéro**.
- **Panier / tunnel** : composant `CartTotals` (factorise le récapitulatif recopié dans les deux pages) : ligne « Livraison HT » avec détail par classe (TTC), « Offerte », et « plus que X € » avant la gratuité. Zone contrôlée au tunnel **et** à l'API (`422 UndeliverableAddress`, `isDeliverableAddress`).
- **Commande** : `shipping_cost` (TTC) + nouvelle colonne `shipping_ht` figés ; la TVA du port est dans `vat_amount`, `total_ttc` l'inclut ; affichés au détail client et admin et dans l'**e-mail de confirmation**.
- **CGV** : zone (art. 2), mode de calcul des frais (art. 4), transporteur choisi par la boutique (art. 7) → `CURRENT_TERMS_VERSION` = **2026-10-03**.
- Tests : shared 266, API 593, web 322, outils 79 = **1 260**.

**Restent / à savoir :**

- ⚠️ **Grille par défaut = placeholder** : à remplacer par celle du client depuis `/admin/livraison`.
- Les **métriques de chiffre d'affaires** (`metrics/service.ts`) somment `total_ttc`, donc **port compris** désormais — à distinguer si le client veut un CA « marchandises ».
- Facture : la table `invoices` attend l'intégration Henrri ; le port y sera une ligne à part (HT + TVA déjà figés sur la commande).
- Le formulaire d'adresse ne propose pas de pays (FR par défaut) : un client hors zone est arrêté au code postal (97/98) ou par l'API.

**Story 12.4** — Catalogue en aller-retour Excel (export → modification → ré-import, activation, archivage) — ✅ **CODÉE** _(créée et codée le 2026-10-07, demande client)_

> Besoin : le client veut **extraire son catalogue** dans un fichier et le modifier dans Excel : ajouter et supprimer des lignes, remplir les prix, **activer certains produits et pas d'autres**. Cas typique : le même produit chez deux fournisseurs, une fiche active, l'autre non. Puis il ré-importe le fichier. La 12.2 a déjà fait le plus gros : le fichier de tri et l'import partagent les mêmes colonnes, l'import est idempotent, l'aperçu montre les changements avant validation.

**Décisions tranchées avec Franck (2026-10-07) :**

- [x] **Retirer une ligne = archiver**, jamais effacer. Archiver met hors ligne et masque le produit, réversible par un bouton « Réactiver ». Les commandes passées gardent leur référence.
- [x] **Même produit chez deux fournisseurs = deux fiches**, une active, l'autre non. Pas de fiche à plusieurs offres fournisseurs (pas de changement de schéma).
- [x] **Le stock reste hors du fichier** : un ré-import ne doit jamais fausser le stock.

**Conception (garde-fous retenus à l'exécution) :**

- **Export** `/admin/imports` → « Exporter le catalogue » (`.xlsx`, mêmes colonnes) : produits **avec fournisseur et référence**, non archivés, hors Gun Art et armes de collection. Les produits saisis à la main sans fournisseur n'ont pas de clé d'aller-retour et sont signalés.
- **Colonne « Actif »** (Oui / Non, vide = inchangé) → mise en ligne. À la création, vide = hors ligne, comme avant.
- **Colonne « Doublon possible »** (informative, jamais relue) : autres fiches de même EAN, ou de même marque et nom normalisé, chez un autre fournisseur. **Signalé, jamais tranché.**
- **Archivage des lignes absentes** : uniquement si l'admin coche « Archiver les produits absents du fichier », et **seulement pour les fournisseurs présents dans le fichier**. Un fichier BGM n'archive jamais un produit Cor Caroli, et un fichier de tri issu de la collecte n'archive rien sans la case. L'aperçu **liste** les produits concernés avant validation.
- **Version par ligne** (colonne « Version », date de dernière modification à l'export) : si la fiche a été modifiée dans le back-office depuis l'export et que « écraser » est coché, la ligne est **refusée** (ré-exporter) au lieu d'écraser la correction. Sans « écraser », simple avertissement.
- **Stock** : l'export le laisse vide, et un ré-import ne le modifie plus jamais, même avec « écraser ». Il ne sert qu'à la création.
- **Bug trouvé et corrigé** : la suppression d'un produit vérifiait `order_items`, une table que le tunnel n'écrit pas (les lignes vivent dans `orders.items_json`). **Un produit déjà commandé pouvait donc être supprimé définitivement.** La garde lit désormais `items_json`, et l'écran propose « Archiver ».

**Livré (2026-10-07) :**

- [x] **Migration `0017`** : `products.archived_at` (indexé), `catalog_imports.archived_count`.
- [x] **Format partagé** : colonnes « Actif », « Doublon possible », « Version » dans `CATALOG_IMPORT_COLUMNS`. Une seule fonction écrit l'onglet catalogue, avec ses listes déroulantes : `addCatalogSheet` / `writeCatalogWorkbook` dans `@armurier/shared/spreadsheet`. Le fichier de tri (outil) et l'export (API) l'utilisent tous les deux.
- [x] **API** :
  - `GET /api/admin/catalog-imports/export`, **catalogue complet ou un seul fournisseur** (`?supplierId=`, liste dans `GET …/suppliers`), pour garder un fichier par fournisseur comme pour le tri. Les doublons sont toujours cherchés chez **tous** les fournisseurs ;
  - option `archiveMissing` à l'aperçu et à la validation, avec la liste `toArchive` et les compteurs `publish` / `unpublish` / `archive` ;
  - une ligne visant un produit archivé est **refusée**, il faut le réactiver d'abord ;
  - `POST /api/admin/products/:id/archive` et `/restore`, avec journal d'audit ; on ne peut pas publier un produit archivé (409) ;
  - garde de suppression (produit **et** variante) sur `items_json`, fonction `orderedVariantIds`.
- [x] **Proxy BFF** transparent octet pour octet (`responseType: "arrayBuffer"`). Il transmet `content-type`, `content-disposition` et `cache-control`, mais jamais un cookie (`server/utils/proxy-headers.ts`, testé). Avant, un téléchargement binaire n'aurait pas survécu au proxy.
- [x] **Écrans** :
  - `/admin/imports` : bouton « Exporter le catalogue » avec choix du fournisseur, case « Archiver les produits absents du fichier », liste des produits à archiver dans l'aperçu, colonne « Archivés » dans l'historique ;
  - `/admin/produits` : boutons « Archiver » / « Réactiver », badge, filtre « Afficher les archivés » ; refus de suppression expliqué en français ;
  - fiche produit : bandeau « archivé » avec bouton « Réactiver », publication désactivée.
- [x] **Vérifié en réel** (API + site, via le proxy) :
  - import de 3 produits → export (doublon Alpha / Beta signalé) → modification dans Excel (une ligne supprimée, « Actif » inversé, un prix changé) → ré-import avec écrasement et archivage → **exactement** 1 mis en ligne, 1 retiré, 1 archivé, le prix appliqué ;
  - archiver → publier refusé (409) → réactiver → supprimer (204) ;
  - passe visuelle Playwright sur ordinateur et mobile : **0 débordement**. Au passage, corrigé un débordement de 440 px de la liste Produits sur mobile : l'en-tête `sr-only` n'était pas ancré à son conteneur.
- Tests : **shared 267, API 606, web 330, outil 81 = 1 284**.

**Reste / à savoir :**

- Les produits **saisis à la main sans fournisseur** ne sont pas dans l'export : ils n'ont pas de clé d'aller-retour. L'onglet « Lisez-moi » de l'export les compte.
- Le repérage des doublons est **indicatif** : même EAN (rarement fourni par les sites), ou mêmes mots dans marque + nom. Deux fiches au libellé différent ne seront pas repérées.
- L'aperçu liste au plus 500 produits à archiver. Le nombre affiché, lui, est toujours exact.

**Fichiers de tri à envoyer au client (2026-10-07) :**

- **Un fichier par fournisseur** (choix de Franck) : `pnpm triage --supplier <id>`. Ça reste sous les limites de l'import (20 000 lignes, 15 Mo), et le client peut trier un fournisseur à la fois.
- **Humbert prêt** : `work/tri-humbert-catalogues-2026-10-07.xlsx`, 6 479 lignes, sans prix (le client remplit achat et vente).
  - Règles dans `work/config.json`, ignoré par git, à recréer à l'identique sur l'autre machine.
  - **Catégorie légale par la lettre du classement Humbert** (`^A` → A, `^B` → B, `^C` → C, `^D` → D). Les **2 404 « NR » restent vides**, décision de Franck.
  - Catégories proposées à partir de la famille Humbert ; 546 lignes sans proposition.
  - ⚠️ **8 articles classés A** chez Humbert (A1.8, A1.9bis) : à signaler au client.
  - ⚠️ Rappel : 746 articles portent un **visuel générique de gamme**.
- **Cor Caroli prêt (2026-10-08)** : `work/tri-cor-caroli-catalogues-2026-10-08.xlsx`, 1 554 lignes, **prix d'achat pro HT** sur 1 525. Les 29 sans prix n'en affichent aucun, même connecté (guidons MC5x…).
  - Règles dans `work/config.json` (clé `cor-caroli`) : **marge 30 %** ; catégorie du site déduite de la collection Cor Caroli (1 553 sur 1 554) ; **catégorie légale par la lettre du classement Cor Caroli**, comme pour Humbert (décision de Franck).
  - L'adaptateur lit désormais ce classement (« Catégorie d'arme » : B1, C 1°-b…) dans `supplierLegalClass`. 192 articles en ont un ; **11 armes sur 185 n'en ont pas**, le client complète.
- **BGM prêt (2026-10-08)** : `work/tri-bgm-winfield-catalogues-2026-10-08.xlsx`, 6 089 lignes, **prix d'achat pro HT** sur 6 083 (les 6 autres affichent 0,00 €).
  - Règles dans `work/config.json` (clé `bgm-winfield`) : **marge 30 %** ; catégorie du site déduite de l'arborescence BGM.
  - **Catégorie légale vide partout** : BGM ne publie aucun classement. Le client la remplit, en priorité sur les 347 armes longues et 255 armes de poing.
  - **443 lignes sans catégorie, volontairement** : « Rechargement » (367 : poudres, amorces, projectiles, outils) à trancher avec le client, la poudre et les amorces relevant d'une réglementation propre ; « A implanter » (76), que BGM n'a pas encore classés.
  - 1 974 fiches **sans photo** et 2 185 sans description : **réellement absentes chez BGM** (image « pas de photo » par défaut), l'outil ne rate rien. Aucun EAN.
- **Restent à collecter** (décision de Franck : catalogues complets) :
  - **Toro**, **Agora-Tec** et **ESP**, en public. Pour ESP, les prix viendront de son tarif.

**Story 12.5** — Fournisseurs gérés dans le back-office — ✅ **CODÉE** _(créée et codée le 2026-10-08, demande de Franck)_

> Besoin : l'export par fournisseur propose une liste tirée de la base, mais rien ne permettait d'y **ajouter un fournisseur**. Le client ne pouvait donc pas commencer le fichier d'un nouveau fournisseur. L'import créait bien un fournisseur à partir de tout nom inconnu, mais une faute de frappe (« BGM Winfeld ») suffisait à créer un doublon.

**Décisions tranchées avec Franck (2026-10-08) :**

- [x] **Écran `/admin/fournisseurs`** (groupe Catalogue) : liste, création et modification. Suppression **seulement si aucun produit** ne s'y rattache, archivés compris.
- [x] **Liste fermée** : l'import **ne crée plus de fournisseur**. Une ligne d'un fournisseur inconnu est invalide, avec le message « Créez-le d'abord dans Catalogue → Fournisseurs ». La comparaison ignore les majuscules, comme l'index unique `uq_suppliers_name_ci`.
- [x] **Export** : la liste déroulante propose **tous** les fournisseurs. Un fournisseur sans produit donne un **fichier vierge** à remplir. La colonne Fournisseur du fichier devient une **liste déroulante** tirée de la base (onglet caché `Listes`, colonne B). Les listes couvrent aussi 500 lignes vides sous les données, pour les produits saisis à la main.

**Livré :**

- [x] **API** `GET/POST /api/admin/suppliers`, `PATCH/DELETE /api/admin/suppliers/:id`. Un nom déjà pris renvoie 409 ; c'est la base qui détecte le conflit, sans risque de course. Les messages sont en français, car l'écran les affiche tels quels.
- [x] **Champs** : nom, e-mail, téléphone. ⚠️ `default_margin_pct` existe en base, mais **rien ne le lit** : il n'est pas proposé, pour ne pas promettre un effet qui n'existe pas.
- [x] **DRY** : la détection de violation d'unicité Postgres, recopiée dans l'inscription et le blog, est mise en commun dans `apps/api/src/db/errors.ts`.
- [x] **Outil de tri** : il ne connaît pas la base, donc pas de liste déroulante Fournisseur. Le « Lisez-moi » prévient que le fournisseur doit exister avant l'import.
- [x] `catalog_imports.suppliers_created` est conservée pour l'historique ; les nouveaux imports y écrivent 0. `suppliersToCreate` (aperçu) et `suppliersCreated` (résultat) sont retirés de l'API.
- [x] **Vérifié en réel** : création, doublon refusé (autre casse), export « fichier vierge » (en-tête seul, liste Fournisseur), suppression, 0 débordement sur mobile.
- Tests : **shared 273, API 617, web 334, outil 93 = 1 317**.

- [x] **Seed de déploiement** (demande de Franck) : `seedSuppliers()` déclare les 6 fournisseurs collectés (Agora-Tec, BGM Winfield, Cor Caroli, ESP France, Humbert, Toro Distribution). Il peut être relancé sans risque : un fournisseur déjà présent, quelle que soit sa casse, n'est ni dupliqué ni renommé. Les noms viennent d'**une seule constante**, `CATALOG_SUPPLIERS` (`@armurier/shared`), que lisent aussi les adaptateurs de collecte : le nom écrit dans les fichiers de tri est donc toujours celui qui est semé.

- [x] **Seed séparé (2026-10-08, demande de Franck)** : `just seed` / `pnpm db:seed` ne pose plus que les **données de référence** (catégories légales et produits, tags, fournisseurs, admin). Le **catalogue de démo** (œuvres, produits, armes de collection, articles de blog) passe par `--demo` (`just seed-demo`, `pnpm db:seed:demo`), réservé au dev et aux démos. Avant, un déploiement aurait mis en ligne de faux produits. **En production, le seed refuse le mot de passe admin d'exemple** de `.env.example`. Testé de bout en bout sur une base vide (`seed-cli.test.ts`).

**À savoir :** un fournisseur **hors collecte** (Armurerie de Paris, ClearMyVault…) se crée à la main dans Catalogue → Fournisseurs avant son premier import.

**Story 12.6** — Facturation dans Henrri (logiciel de facturation du client) — 📝 **À CADRER** _(créée le 2026-10-08, demande du client)_

> Besoin : le client facture avec **Henrri** (logiciel gratuit du groupe Rivalis). Chaque commande payée sur le site doit y devenir une facture, sans ressaisie. Henrri a une API publique pensée pour ce cas (« une boutique en ligne peut générer automatiquement la facture d'une commande »).

**Ce qu'on sait de l'API (2026-10-08, pages publiques) :**

- Ressources : **factures et devis** (création, lecture), **clients** (synchronisation), **catalogue produits**.
- Authentification : `clientId` / `clientSecret` générés dans le compte Henrri (avatar → « API & Intégrations »), échangés contre un **jeton JWT valable 10 minutes**.
- **Coût en crédits** : lectures gratuites ; **8 crédits par facture finalisée**, 2 par devis validé.

| Pack | Prix / mois | Crédits / mois | Factures / mois | Débit |
|---|---|---|---|---|
| 1 | 0 € | 200 | 25 | 60 req/min |
| 2 | 10 € | 1 000 | 125 | 120 req/min |
| 3 | 20 € | 2 000 | 250 | 300 req/min |
| 4 | 30 € | 4 000 | 500 | 600 req/min |

- **Bac à sable gratuit et illimité** : tout le développement et les tests se font dessus.
- ⚠️ La **documentation technique** (adresses, schémas) n'est **pas publique** : elle est dans le compte Henrri. La page d'aide « Avez-vous une API ? » refuse les accès automatiques.
- Facturation électronique : Henrri annonce la **réception** des e-factures en septembre 2026 et l'**émission** en septembre 2027. Les ventes aux particuliers (B2C) ne sont pas des e-factures, elles relèvent de l'e-reporting : à confirmer avec le comptable.

**Décisions à trancher (avec le client et son comptable) — ne pas coder avant :**

- [ ] **Moment de la facture.** Proposé : quand la commande est **entièrement payée**. Une commande mixte se règle en deux parties (carte pour le libre, virement pour les armes réglementées) : une seule facture à la fin, ou une par paiement ?
- [ ] **Numérotation : Henrri**, jamais le site. Deux séries parallèles seraient une anomalie comptable. Le site garde sa référence de commande et le numéro Henrri de la facture.
- [ ] **Contenu.** Proposé : les **lignes de la commande** (désignation, référence, quantité, prix HT, taux de TVA), plus une ligne **frais de port**. Pas de synchronisation du catalogue : des milliers d'articles pour rien.
- [ ] **Clients.** Créer chaque acheteur dans Henrri (nom, adresse de facturation, e-mail) ? Si oui, Henrri devient **sous-traitant RGPD** : à ajouter à `/confidentialite` et au registre.
- [ ] **Remboursements → avoirs** dans Henrri (total ou partiel, à partir de la table `refunds`).
- [ ] **Gun Art** : les tirages sont vendus **pour le compte de l'artiste** (CGV art. 12). Faut-il une facture de mandataire avec mention spécifique, ou une commission ? **À valider par le comptable.**
- [ ] **Envoi au client** : par Henrri (son e-mail), ou par le site (PDF récupéré et joint à un e-mail SCS Firearms, ou disponible dans « Mes commandes ») ?
- [ ] **Pack** selon le volume de commandes attendu : 25 factures par mois en gratuit, 125 pour 10 €…
- [ ] **Commandes passées avant la mise en service** : rattrapage ou non.

**Conception proposée (à confirmer une fois la documentation lue) :**

- **File d'attente avec relances**, sur le modèle de l'e-mail de confirmation (`confirmation_sent_at`, `ORDER_CONFIRMATION_RETRY_MINUTES`). Une facture Henrri qui échoue (API indisponible, crédits épuisés) **ne bloque jamais une vente**. Elle repart plus tard, et un compteur dans le tableau de bord signale les factures en souffrance.
- **Idempotence** : l'identifiant et le numéro de la facture Henrri sont stockés sur la commande (migration). Une relance ne crée jamais de doublon : elle vérifie d'abord ce qui existe chez Henrri, ce qui ne coûte rien puisque les lectures sont gratuites.
- **Secrets** dans `.env` (`HENRRI_CLIENT_ID`, `HENRRI_CLIENT_SECRET`, `HENRRI_BASE_URL` pour basculer entre bac à sable et production). Jeton gardé en mémoire et renouvelé avant expiration. Jamais journalisé.
- **Admin** : sur la fiche commande, le numéro de facture Henrri avec un lien, son statut et un bouton « Relancer la facture ».
- **Tests** : client HTTP Henrri simulé dans la CI ; passe réelle sur le bac à sable avant la production.

**Attendu du client :**

- un accès au **bac à sable** Henrri (`clientId` / `clientSecret`) et le lien vers la documentation de l'API ;
- les réponses aux décisions ci-dessus, Gun Art et e-reporting avec son **comptable** ;
- plus tard, les identifiants de **production** et le choix du pack.

## PHASE 10 — Front client (boutique armurerie, auth & tunnel d'achat)

> Angle mort identifié 2026-06-10 : le **back** des deux univers (armurerie réglementée **et** Gun Art) est fait (Phases 1-4), mais le **front client** ne couvre que Gun Art (5.3). Ces stories = les écrans Nuxt manquants, au-dessus d'API déjà construites. Réutiliser l'identité « galerie » validée + baseline mobile-first/SSR/SEO de la 5.3 (cf. [[project_front_direction]] en mémoire).

**Story 10.1** — UI Auth (inscription, connexion, reset) ✅

- Pages Nuxt inscription / connexion / mot de passe oublié / reset (API Phase 1)
- Gestion de session côté client (stockage token + refresh), middleware de route protégée, état connecté dans le header
- Mobile-first, validations alignées sur `shared`, états erreur/lockout/anti-énumération respectés

**Story 10.2** — Catalogue armurerie (listing + filtres + recherche) ✅

- Page boutique : grille produits, filtres catégorie / catégorie légale / prix, recherche full-text (API 2.1, `{ data, pagination }`)
- Mobile-first, SSR + SEO, états vide/erreur ; recoupe la recherche globale 9.1 (à coordonner)

**Story 10.3** — Fiche produit armurerie ✅

- Page détail (API 2.2) : variants, prix TTC, **mentions légales** (catégorie, âge mini, docs requis), restrictions ; ajout au panier
- SEO `Product` JSON-LD ; gère un produit sans variant seedé (cf. note 2.2)

**Story 10.4** — Panier & tunnel d'achat (commun aux 2 univers) ✅

- Page panier (produits + tirages), récap totaux, **remise VIP affichée**, retrait de lignes (libération tirage)
- Choix/saisie adresses depuis le carnet (API 3.x), récap du **split paiement** virement/CB, création commande (API 3.2)
- Débouche sur le paiement (Phase 6) → ensemble = « achetable de bout en bout »

**Story 10.5** — Espace compte (commandes + documents légaux) ✅

- Profil (API 1.3), liste + détail commandes avec statut légal/paiement (API 3.3)
- **Upload & suivi des documents légaux** (API 4.1) + checklist légale par commande (API 4.3) : statut par doc, motif de rejet, réupload
- Cœur de l'expérience réglementée côté client

**Story 10.6** — Accueil unifié & navigation 2 univers ✅

- Page d'accueil présentant **armurerie + Gun Art** (aujourd'hui hero centré Gun Art), navigation header vers les deux univers
- Cohérence de marque entre la boutique réglementée et la galerie d'art
- **Refonte de la navbar (priorité — desktop + mobile)** : le header actuel empile les éléments à plat (liens + recherche + auth + panier + CTA), peu aéré. Objectifs :
  - **Deux univers lisibles** : Armurerie (`/boutique`) vs Gun Art (`/collection`) — point d'entrée clair (split ou méga-menu par univers).
  - **Desktop** : réorganiser/aérer, **icônes** (panier avec compteur, compte/admin selon connecté + `isAdmin`, accueil), envisager un mega-menu.
  - **Mobile** : **burger plein écran** (overlay pleine page) + **animation** d'ouverture/fermeture.
  - Le lien « Panier » + badge (ajouté en 10.4a) est temporaire en attendant cette refonte.

**Story 10.7** — Typographie & finitions visuelles ✅ _(audit du 2026-09-13, livrée le 2026-09-23)_

> Demande de Franck (2026-09-13) : améliorer le visuel du site, **notamment les typos**. Audit mesuré sur le **rendu réel** (Playwright, 7 pages publiques en desktop 1440 px + mobile 390 px, styles calculés) et sur l'inventaire du CSS — pas sur une impression.

**Constats de l'audit :**

- **Aucune échelle typographique** : `main.css` ne définit que 2 tokens (les familles). On compte **59 tailles de police distinctes**, dont des quasi-doublons (`0.62 / 0.66 / 0.68 / 0.72 / 0.74 / 0.76rem`, `1.05 / 1.08 / 1.15 / 1.2 / 1.25rem`) et une vingtaine de `clamp()` de titres tous différents ; **15** `letter-spacing` et **11** `line-height` différents. Chaque page réinvente sa typo.
- **Trop de texte sous 12 px** : **58 éléments sur `/boutique`**, 30 sur l'accueil, 28 sur `/collection` — badge « Catégorie B » à 10,9 px, sur-titres à 11,5 px, libellés « Variante » / « Édition » à 11,2 px.
- **Majuscules espacées partout** : 81 déclarations `uppercase` (40 fichiers). `.eyebrow` = 11,5 px + 3,7 px d'interlettrage ; boutons et navigation = 12,8 px + 1,8 px. Élégant à dose, fatigant en continu.
- ⚠️ **Serif fin en tout petit — le pire cas** : les titres de section « Les séries » / « Toutes les œuvres » (`/collection`) sont en **Cormorant Garamond 11,5 px, majuscules, gris** — quasi invisibles sur la capture ; « Filtrer par tag » en Cormorant 15 px majuscules. Cormorant (petite hauteur d'x, déliés très fins) n'est lisible qu'en grand.
- ⚠️ **Chiffres elzéviriens sur les montants et références** : Cormorant a des chiffres « bas de casse » de hauteurs variables. Ils servent au **prix de la fiche produit** (`.detail__price`, 32 px), aux **totaux** de l'espace compte (`.card__total`), à la **référence de virement du RIB** (`.rib__ref dd` — un code que le client recopie dans sa banque) et au n° de commande admin (`#b1fed38c` illisible sur la capture 11.9). Aucun `font-variant-numeric` côté public (`tabular-nums` n'existe qu'en admin).
- **Deux traitements du prix sur la même fiche œuvre** : Cormorant 25,6 px pour l'un, Inter 16 px pour l'autre.
- **Polices servies par Google Fonts** (CSS externe) : requête tierce bloquante au premier affichage **et** transfert de l'IP du visiteur à Google — sujet RGPD connu. À **auto-héberger** (sous-ensemble latin, `font-display: swap`, préchargement des 2 fichiers critiques).
- Ce qui va bien : les 6 graisses chargées sont exactement celles utilisées (pas de gras synthétique) ; `body` en 16 px / 1,6 ; hiérarchie des grands titres (h1 88 → 51 px) cohérente.
- Vu en passant (hors typo) : **visuels d'œuvres cassés** sur les captures dev (texte alternatif affiché à la place de l'image, `/collection` et fiche œuvre). Le dev est en `STORAGE_DRIVER=s3` (pas `memory`) : stockage local injoignable ou vrai bug — **à diagnostiquer**.

**Décisions tranchées avec Franck (2026-09-23) :**

- **Couple de polices** : **Fraunces remplace Cormorant Garamond**, Inter reste le corps. Même registre « galerie », mais une hauteur d'x qui tient jusqu'à 14 px — Cormorant servait les titres de section de `/collection` à 11,5 px, le pire cas de l'audit.
- **Échelle** : 9 paliers fluides en tokens (`--fs-xs` … `--fs-display`), plancher **12 px absolu** et **14 px pour tout texte courant**. `--fs-xs` (12 px) est réservé aux micro-libellés en capitales.
- **Majuscules espacées** : gardées pour les **sur-titres seulement**, interlettrage ramené de 0,32em à 0,12em. Boutons, navigation, fil d'Ariane et titres de section les perdent.
- **Chiffres** : tout en Inter, **alignés et tabulaires**. La règle est posée **une fois sur `body`** plutôt que recopiée sur chaque prix — c'est ce qui empêche la dette de revenir, et un composant neuf en hérite. Le texte suivi (articles, contenu riche) repasse en chasse proportionnelle.
- **Auto-hébergement** : `@nuxt/fonts` épinglé en **0.14.0** (publié le 2026-02-14, donc hors quarantaine 90 jours).
- **Périmètre** : site public **et** back-office, avec une exigence ajoutée par Franck — que la charte reste **simple à faire évoluer**.

**Livré :**

- [x] **`app/assets/css/tokens.css` : la charte en un seul fichier** (couleurs, échelle, graisses, rythme, mise en page). C'est la réponse à l'exigence « facile à faire évoluer » : changer l'identité = changer ce fichier. **455 tailles, 90 interlettrages, 50 interlignages et 62 graisses** répartis dans 66 fichiers ont été ramenés sur les tokens ; il ne reste aucune valeur typographique en dur ailleurs (2 `letter-spacing: normal` délibérés exceptés)
- [x] **Polices auto-hébergées** : une seule woff2 **variable** par famille (83 Ko au total) servie depuis notre domaine, `font-display: swap`, **préchargement des 2 fichiers critiques** (`defaults.preload`), et polices de repli métriquement compatibles générées par le module
- [x] ⚠️ **RGPD** : Google Fonts transmettait l'IP de chaque visiteur à un tiers et bloquait le premier affichage avec une feuille de style externe. Les deux origines sont **retirées du CSP** (`style-src`, `font-src`), et **un test les verrouille** — les réautoriser rouvrirait silencieusement l'exposition
- [x] **Chiffres corrigés là où ça comptait** : référence de virement du RIB (un code que le client recopie dans sa banque), totaux de l'espace compte, prix de fiche produit, numéros de tirage, valeurs des tableaux de bord admin. Le prix de la fiche œuvre n'a plus deux traitements
- [x] **Captures avant / après** desktop 1440 px + mobile 390 px sur 10 pages (accueil, boutique, fiche produit, collection, fiche œuvre, armes de collection, panier, compte, commandes, admin virements) — 40 images
- [x] **Mesuré sur le rendu réel, même lentille que l'audit** : **157 → 0** éléments sous 12 px ; **18/16/16/13 → 8/7/7/7** tailles distinctes par page ; **181 → 121** éléments en capitales (le reste : sur-titres, badges et libellés de tableau, conformes à la décision)
- [x] **Lighthouse sans régression** : accessibilité **100 → 100**, SEO 100 → 100, bonnes pratiques inchangées, performance +1 sur 3 pages. **CLS 0,042 → 0,000 sur `/collection`**
- [x] ⚠️ **Régression trouvée à la mesure, pas au code** : sans préchargement, le titre de l'accueil se re-répartissait au remplacement de la police (`size-adjust: 100 %` sur le repli générique) — **0,036 de CLS, reproductible**. Corrigé par `defaults.preload`, ramené à 0,000
- [x] ⚠️ **Deux défauts vus à la capture, pas au code** : « Armes de collection » passait sur deux lignes dans la barre latérale admin (navigation dense redescendue à 14 px) ; « Contrôle légal requis » faisait une troisième série de capitales dans la même carte produit (repassé en casse normale — c'est une phrase, pas un libellé)
- [x] **Vérifié** : `pnpm -r typecheck` clean, Biome clean, **API 508 / shared 153 / web 233 = 894** au vert (+1 : verrou CSP)
- [x] **Visuels d'œuvres cassés : diagnostiqué et corrigé** (demande de Franck, même session). Ce n'était pas un bug d'affichage mais **trois choses distinctes** :
  - **Cause réelle** : 5 œuvres sur 6 n'ont tout simplement aucune image (le placeholder est le comportement voulu). La 6ᵉ porte une URL en base dont l'objet est injoignable — le `.env` de dev pointe sur Scaleway avec des **identifiants factices** (`your-scw-access-key`), donc toute lecture répond **Forbidden**. Vérifié par sonde directe sur le driver
  - ⚠️ **Défaut API — une panne de stockage se déguisait en 404.** Les 5 routes qui servent des octets stockés faisaient `catch {}` → 404 « Image not found », sans journaliser. C'est faux deux fois : ça annonce aux caches et aux moteurs qu'une image a **définitivement** disparu alors que le stockage est seulement injoignable (une clé expirée aurait fait désindexer tous les visuels du site), et ça jette la cause — d'où un diagnostic qui a demandé une sonde. Ajout d'une erreur agnostique du fournisseur **`ObjectNotFoundError`** (les drivers ne la lèvent que pour une vraie absence ; un 403 ou une panne réseau se propagent tels quels) et d'un helper partagé : **404 pour une vraie absence, 502 + journal avec la clé et la cause** sinon
  - ⚠️ **Défaut front — une URL cassée ne retombait sur rien.** `artworkImage()` ne basculait sur le placeholder que si l'URL était **absente** ; présente mais en échec, le navigateur vidait le **texte alternatif en travers de la grille**, à côté de cartes sans image qui s'affichaient proprement. Le helper transporte désormais son placeholder, et une **directive unique `v-img-fallback`** couvre les 9 points d'appel — `<img>` nu comme `<ProtectedImage>`, puisqu'une directive retombe sur la racine d'un composant mono-racine. Elle rattrape aussi un échec survenu **avant l'hydratation** (le cas qui se produisait réellement en SSR)
  - ⚠️ **Trouvé au passage — 4 `og:image` servaient le placeholder `data:` aux robots** (accueil, boutique, fiche œuvre, collection) : une carte de partage qui **paraissait configurée** et ne rendait rien, Open Graph exigeant par ailleurs une URL absolue. Nouveau helper `ogImageUrl()` : l'URL réelle en absolu, ou **rien** — omettre la balise est l'état honnête
  - **Vérifié** : les 6 cartes de `/collection` rendent le placeholder (plus aucun texte alternatif en travers), l'API répond **502** au lieu de 404 sur le stockage injoignable et journalise `key` + cause exacte. Tests **API 511 / shared 153 / web 238 = 902** au vert (+8)
  - **Décision restante pour Franck** : le dev n'a **aucune image** tant que `apps/api/.env` garde les identifiants Scaleway factices. Soit de vrais identifiants de dev, soit `STORAGE_DRIVER=memory` (mais les envois d'une session disparaissent au redémarrage, ce qui recrée exactement l'incohérence ci-dessus — désormais sans dégât visible)
- [x] **Passe visuelle avec Franck (2026-09-23) — trois défauts de navigation trouvés à l'écran, aucun détectable par les tests unitaires** :
  - ⚠️ **Le menu compte était entièrement mort** (connexion, inscription, mon compte, mes commandes, administration, déconnexion). Le voile de fermeture au clic extérieur est `position: fixed; inset: 0` en `z-index: 55`, alors que `.hdr` est `sticky` en `z-index: 50` et **crée donc un contexte d'empilement** : le `z-index: 60` du menu ne le classe qu'à l'intérieur du header, qui reste globalement à 50. Le voile recouvrait le menu qu'il devait seulement border, et chaque clic le refermait. Voile ramené à **40**, sous le header. ⚠️ **Ne jamais remonter un voile de fermeture au-dessus du `z-index` du header.**
  - ⚠️ **Le méga-menu se refermait au clic** : `@pointerenter` ouvrait le panneau et `@click` le **basculait**, donc survoler puis cliquer — le geste naturel — le faisait disparaître. Décision Franck : le libellé d'univers devient un **lien** vers `/boutique` ou `/collection` ; survol **ou focus clavier** ouvre, sortie ou Échap ferme. `aria-haspopup` retiré avec le bouton
  - **Footer refait** : la grille déclarait **3 colonnes pour 4 blocs** et le formulaire portait `grid-column: 1 / -1`, d'où « La maison » éjectée seule sur une 3ᵉ ligne et un formulaire en bannière. 4 colonnes à partir de 1080 px, 3 + bande plafonnée entre 720 et 1080, 1 colonne en mobile. Le titre du formulaire s'aligne sur les autres en-têtes de colonne. Corrigés au passage : « Mon compte » pointait sur `/connexion` même connecté (désormais `/compte`, dont le middleware redirige), « À propos » était un `<a>` brut forçant un rechargement complet, et « Armes de collection » manquait
- [x] **Gun Art s'ouvre sur l'artiste** (demande de Franck) : la page artiste existait et n'était reliée de nulle part. `/collection` présente désormais **qui** avant de montrer **quoi** — carte principale (portrait, nom, accroche, biographie) puis les autres artistes en rangée, avant les séries et la grille. Entrées ajoutées au méga-menu Gun Art, à l'accordéon mobile et au footer, vers `/collection/artiste` (qui redirige déjà vers l'artiste unique, et liste dès qu'il y en a plusieurs). **La maison garde plusieurs artistes** (décision Franck), donc le bloc est bâti pour 1 comme pour N. ⚠️ **Piège CSS** : l'attribut `height` d'une `<img>` se traduit en **propriété CSS `height`** et bat `aspect-ratio` — le portrait s'affichait en 600 px de haut et laissait la carte à moitié vide (653 px pour 243 px de texte) ; `height: auto` rétablit le cadrage 4/5
  - **Reste à faire** : **Sylvain sera saisi via le back-office** (décision Franck) — aucune biographie inventée dans le seed, qui garde ses 3 artistes de démo

---

## PHASE 11 — Armes de collection, tags & Gun Art éditorial

> **Source : réunion client du 2026-09-06** (notes Franck). Ces stories traduisent les besoins exprimés, confrontés au code existant. Plusieurs s'appuient sur du schéma **déjà écrit mais jamais exposé** (`ancient_weapons`), d'autres imposent de nouvelles tables.
>
> **Direction artistique transverse** : registre « classe / luxe » (référence donnée en réunion : l'armurerie de John Wick). À intégrer à la refonte navbar (10.6) et aux nouvelles pages ci-dessous, dans la continuité de l'identité galerie validée (cf. [[project_front_direction]]).
>
> **Points tranchés en réunion, à ne pas re-questionner** :
> - Une arme historique est une **pièce unique** (1 exemplaire), comme une arme d'occasion mais avec le prestige — pas de matrice de variantes, un prix unique.
> - **Catégorie C : aucun document alternatif** — le seed actuel (`["cni", "permis_chasse", "sia"]`) est correct.
> - Prix Gun Art **décroissant** quand le numéro de tirage monte (le n°1 est le plus cher) = comportement voulu, la formule actuelle est conforme.
> - **Râtelier numérique** (quota 6 puis 15 armes) : **hors périmètre** — obligation légale du détenteur, pas du site.
> - **Blog** : déjà livré (9.4 / 9.4b). L'extension aux 2 univers est tracée en 9.6, rien à créer.

**Story 11.1** — Tags transverses & catalogue global ✅

> Besoin : **un catalogue global unique** (hors Gun Art) où tout apparaît, filtré ensuite selon l'endroit du site où l'on se trouve. Constat de départ : `productCategoryEnum` était **mono-valué** et mélangeait nature et état (`arme_ancienne`, `occasion`, `arme_longue`…), alors qu'une arme historique est **nécessairement d'occasion**.

- [x] **Baseline de migration Drizzle** (prérequis, faite dans la même PR — retire la dette « quelle base est à jour ? ») : `drizzle/0000` généré depuis `schema.ts` (capture les colonnes générées `tsvector` + index GIN, les CHECK, l'unicité `payment_reference`, le `family_id` de la RTR — qui n'existaient jusque-là que sous forme d'ALTER psql joués à la main) ; `armurier_dev` **reconstruite uniquement depuis les migrations** (24 tables) ; tests et CI passent par `drizzle-kit migrate` (le global-setup ne clone plus la base dev via `pg_dump -s`) ; compose prod `push --force` → `migrate`. ⚠️ **`apps/api/drizzle/` était gitignoré** depuis le scaffold — sans ce correctif les migrations n'atteignaient ni la CI ni la prod. Docs : README (flux de schéma), DEPLOY, ADR 0001, `.env.example`
- [x] **Modèle** (décision Franck) : table `tags` (slug unique, name, facet, description, displayOrder) + pivot **`product_tags`** à PK composite et FK cascadées. Enum `tag_facet` (`etat`/`epoque`/`caracteristique`) : les **facettes** sont structurelles (elles pilotent la requête), les **tags** éditoriaux (renommables en backoffice sans migration)
- [x] **Sémantique de filtrage** (décision Franck) : **OU dans une facette, ET entre facettes** — cocher un second état élargit, ajouter une époque restreint. Une sous-requête `EXISTS` par facette, servie par la PK composite et `idx_product_tags_tag`
- [x] **Reprise des 2 intruses** : `arme_ancienne` et `occasion` **sortis de l'enum** et devenus des tags. Aucun produit ne les utilisait (0/0), donc bascule sans migration de données ; la migration `0001` porte une **étape de données ajoutée à la main** (`DELETE` des 2 lignes avant la recréation de l'enum, sans quoi le cast échoue sur toute base existante — la FK `products.category_id` sert de garde-fou). Les URLs `?category=` et `productFiltersSchema` sont intactes
- [x] **API** : `?tags=` sur `GET /api/products` (liste séparée par virgules **ou** paramètres répétés), cumulable avec catégorie/légale/prix/recherche ; les tags de chaque produit sont renvoyés dans le payload (agrégat JSON corrélé, pas de N+1) ; nouveau **`GET /api/tags`** = facettes + tags + **compteurs** calculés avec exactement la même lentille que le listing (publié, hors Gun Art). Slugs inconnus **ignorés** (un tag renommé dans une URL indexée ne doit ni 400 ni vider le catalogue) ; plafond de 20 tags par requête
- [x] **Front** : composable `useTags` (SSR-cachée) + composant `ProductTagFilters` (pastilles à cocher groupées par facette, compteurs, « tout effacer », cases réellement présentes dans l'arbre d'accessibilité) ; branché sur `/boutique` avec l'URL comme source de vérité (`?tags=` partageable, retour arrière fonctionnel)
- [x] ⚠️ **Effet de bord rattrapé — règle VIP.** `isNewFirearmQualifying` s'appuyait sur la **catégorie** `occasion`/`arme-ancienne` : la bascule en tags aurait silencieusement rendu une arme d'occasion **éligible au VIP**. La règle lit désormais les tags, et les commandes conservent leurs tags dans l'instantané `items_json`. L'ancienne clé catégorie est **conservée** pour les commandes antérieures à 11.1, dont l'instantané ne porte aucun tag
- [x] **Vérifié** : `pnpm -r typecheck` clean, Biome clean, **API 316 / shared 68 / web 117 = 501** au vert ; smoke réel sur serveur live (`/api/tags` avec compteurs, `?tags=occasion` → 2 articles, slug inconnu ignoré, slug malformé 400) et **SSR `/boutique`** (panneau rendu, pastille active, décompte correct)
- Reste ouvert, hors périmètre de cette story : **pages de tag indexables** + canonicals sur les vues filtrées (à traiter avec la 9.6), badges de tag sur les cartes produit (la 11.3 touche déjà les cartes), et l'**écran d'administration des tags** (pose/dépose sur un produit) — à cadrer avec la 7.5

**Story 11.2** — Univers « Armes de collection & historiques » ✅

> La table **`ancient_weapons` existait déjà et n'était utilisée nulle part** (aucune API, aucune page, aucun seed). Cette story l'expose enfin, en réutilisant intégralement le tunnel d'achat des phases 3, 4 et 6.

- [x] **Réservation au panier des pièces uniques** (décision Franck) : colonnes `reserved_by`/`reserved_until` sur `product_variants` (migration `0002`, FK `on delete set null` pour qu'un compte supprimé ne garde pas une pièce en otage). Compare-and-set, comme la réservation des tirages Gun Art (5.2). **Aucune tâche planifiée** : une réservation expirée n'est jamais balayée, elle est ignorée à la lecture (`reserved_until < now()`) — pas de cron à maintenir et aucune fenêtre où une pièce libérée paraîtrait encore prise
- [x] **Cycle complet** : blocage à l'ajout au panier (409 pour un second client), libération au retrait de ligne et au vidage du panier, ré-ajout par le détenteur sans qu'il se bloque lui-même. La validation de commande **honore aussi la réservation** (clause ajoutée au garde-fou de stock atomique) — sans quoi le blocage n'aurait rien valu au seul moment qui compte
- [x] **Pièce unique = 1 variante implicite** : le panier est clé sur `variantId`, donc un produit sans variante est inachetable. Le CRUD admin crée automatiquement une variante « Pièce unique » (stock 1) → parcours d'achat **identique aux armes neuves**, zéro modification du tunnel
- [x] **API publique** : `GET /api/ancient-weapons` (listing avec époque/fabricant/état/authenticité, filtres tag + catégorie légale + disponibilité, pagination). Les **pièces vendues restent listées** et marquées `available: false` — elles gardent leur valeur éditoriale et SEO (prépare la 11.3). Fiche produit enrichie d'un bloc `ancientWeapon` (null sur un produit ordinaire) et d'un `heldByOther` par variante
- [x] **CRUD admin** (`/api/admin/ancient-weapons`) : création transactionnelle produit + fiche historique + variante + tags (tout ou rien), édition partielle, suppression **refusée** si la pièce est vendue ou retenue par un client (on dépublie au lieu d'effacer une piste d'achat)
- [x] **Texte riche assaini** (décision Franck : garder la mise en forme plutôt que du texte brut) : le module de sanitisation du blog remonte en `apps/api/src/sanitize.ts` et sert désormais les deux usages (DRY). `longDescription` est assainie **à l'écriture** et rendue en `v-html` — invariant documenté dans le module : un champ rendu en `v-html` DOIT être passé par là
- [x] **Front** : page `/armes-de-collection` (identité éditoriale, filtre par époque, bascule « afficher les pièces vendues », badge « Vendue » en niveaux de gris, `ItemList` JSON-LD) ; **fiche unique** `/boutique/:slug` enrichie du dossier historique (époque, fabricant, provenance, état, restauration, expertise, faits marquants) — une seule URL canonique par arme, conforme au catalogue global. Bouton d'achat désactivé et message explicite quand la pièce est momentanément retenue. Entrées de nav ajoutées au méga-menu Armurerie et à l'accordéon mobile
- [x] **Seed** : 3 armes (Lefaucheux 1854, Luger P08 1917, Gras 1874) + 1 **accessoire historique** (étui de P08 daté 1941), avec récits, provenance et tags
- [x] **Vérifié** : `pnpm -r typecheck` clean, Biome clean, **API 337 / shared 68 / web 117 = 522** au vert ; smoke réel (listing, dossier historique, tags, variante unique, **assainissement d'une charge XSS réelle** — `<script>`, `onerror` et `javascript:` supprimés) et SSR des deux pages
- ⚠️ **Bug trouvé par le smoke, pas par les tests** : la pose des tags utilisait `= any()`, que le driver sérialise en tuple et non en tableau → toute création admin avec tags renvoyait 500. Corrigé (`inArray`) **et couvert par un test** de création admin, qui manquait
- Reste ouvert : écran d'administration Nuxt des armes de collection (l'API est là, l'UI viendra avec la refonte produit de la 7.5) ; les slugs de tags `arme-ancienne`/`arme-historique` sont formulés pour des armes et lisent mal sur un accessoire — à renommer si le vocabulaire gêne le client

**Story 11.3** — Marquage « vendu » persistant ✅

- [x] **Distinction « vendu » / « rupture »** (le vrai sujet) : une pièce unique partie ne revient jamais, un produit ordinaire à zéro sera réapprovisionné. Afficher « Rupture » sur une arme historique vendue promettrait un retour impossible **et** dirait la mauvaise chose aux moteurs. `utils/availability.ts` calcule l'état à partir du stock et de `isUnique`, et porte les libellés **et** la valeur schema.org : `SoldOut` pour une pièce unique, `OutOfStock` sinon
- [x] **API** : `isUnique` exposé dans le listing `/api/products` (jointure sur `ancient_weapons`) — sans lui le front ne peut pas faire la différence. La fiche portait déjà `ancientWeapon.isUnique`
- [x] **Reste en ligne** : une pièce vendue **n'est ni dépubliée ni masquée** — elle sort dans le listing, sa fiche répond 200 (pas de 404), elle garde sa valeur éditoriale et SEO et montre l'activité de la maison. Couvert par des tests, pas seulement par l'intention
- [x] **Retirée de l'achat** : bouton désactivé portant le motif exact (« Vendu — indisponible » vs « Rupture de stock »), et `availability` du JSON-LD `Offer` piloté par le même état
- [x] **Composant partagé `AvailabilityBadge`** (la story demandait de généraliser, pas de dupliquer) : utilisé par la carte produit, la fiche, le listing collection **et les deux écrans Gun Art**, qui lui passent leur propre libellé d'édition (« 16 / 25 disponibles »). La couleur, la forme et la sémantique vivent en un seul endroit
- [x] ⚠️ **Lisibilité (remarque d'un associé du client)** : le badge est **opaque et fortement contrasté**, pas une surimpression discrète — #f5f2ea sur #0e0e10, environ **17:1**, très au-dessus des 4,5:1 exigés. Aucune astuce d'opacité, aucun texte atténué ; il tient sur une photo claire, en niveaux de gris et pour un daltonien, car **le mot porte le sens, jamais la couleur seule**
- [x] ⚠️ **Défaut vu à la capture d'écran, pas au code** : la fiche affichait **deux libellés contradictoires** — la puce héritée « Rupture de stock » juste à côté du nouveau badge « Vendu ». Unifié : une seule mention de disponibilité, plus une phrase d'explication
- [x] **Vérifié** : `pnpm -r typecheck` clean, Biome clean, **API 340 / shared 68 / web 127 = 535** au vert (10 nouveaux : état, libellés, schema.org, carte produit, listing catalogue, fiche d'une pièce vendue) ; **captures Playwright** du badge sur carte et sur fiche pour juger la lisibilité plutôt que la supposer
- Reporté à la 11.4 : le **CTA « se tenir informé des arrivées »**. Il n'existe aujourd'hui aucun endroit où envoyer l'adresse — l'expédier maintenant reviendrait à livrer un bouton mort. Il arrivera avec l'inscription Brevo

**Story 11.4** — Newsletter & alertes d'arrivée ✅

> Constat de départ : la 11.3 avait laissé le CTA « se tenir informé des arrivées » de côté faute d'endroit où envoyer l'adresse. Cette story crée cet endroit — et le crée **agnostique du fournisseur**.

- [x] **Segmentation par univers** (décision Franck) : `armurerie` / `collection` / `gun_art`. ⚠️ Rappel inscrit dans le code (`packages/shared/src/newsletter.ts`) : la segmentation porte sur **l'abonnement, pas sur le contenu** — une lettre « collection » a parfaitement le droit de parler de Gun Art. Le segment décide **qui reçoit**, jamais ce qu'on a le droit d'écrire
- [x] **Modèle** (décision Franck) : **un contact unique porteur de N abonnements**, pas un contact par liste. `newsletter_contacts` (email nullable + `email_hash` unique) × `newsletter_subscriptions` (PK composite contact/segment, statut, **consentement horodaté par segment** avec page d'origine, IP et user-agent) × `newsletter_tokens` (jetons de lien **hachés**, comme ceux de réinitialisation de mot de passe). Migration `0003`
- [x] **Double opt-in tenu par nous, pas par le fournisseur** (décision Franck) : jeton en base, mail de confirmation via le nodemailer existant, TTL 72 h, lien à usage unique. Tant qu'il n'est pas suivi, l'abonnement reste `pending` : **rien n'est envoyé et l'adresse n'atteint jamais Brevo**. La preuve de consentement vit donc chez nous et survivrait à un changement de prestataire
- [x] **`NewsletterService`** sur le modèle de `StorageService` : `apps/api/src/newsletter/` (interface + driver `brevo` + driver `memory`). **Aucune spécificité Brevo hors de ce dossier**, tout passe par l'env (clé + un id de liste par segment). Driver mémoire par défaut hors production → tests, CI et poste local n'ont besoin d'aucun compte
- [x] **Brevo en `fetch` direct sur l'API v3** (décision Franck) : quatre appels HTTP ne justifient pas une dépendance à mettre en quarantaine et à suivre indéfiniment. Le driver échoue **au démarrage** si une clé ou un id de liste manque, jamais au premier visiteur qui s'inscrit
- [x] **Notre base est la source de vérité** : une panne Brevo ne fait pas échouer une confirmation, elle laisse simplement `provider_synced_at` à null (marqueur pour un rejeu)
- [x] **RGPD** : consentement explicite (`z.literal(true)`, une case décochée ne peut pas être coercée en oui), horodaté et traçable (`audit_logs` : demande, confirmation, retrait) ; désabonnement **par segment ET global** ; au retrait total l'**adresse est effacée** et la ligne survit anonymisée (hash + horodatages) — on peut prouver qu'un consentement a existé sans conserver de donnée personnelle (décision Franck). Les jetons sont supprimés avec elle, donc les liens des envois déjà partis cessent de résoudre. En-têtes `List-Unsubscribe` (RFC 8058) sur le mail de confirmation
- [x] **Front** : composant `NewsletterSignup` réutilisable (cases à cocher par univers, **pré-cochage du seul univers d'où vient le visiteur, jamais l'ensemble**, mention de consentement explicite), branché sur le **footer**, sur le **listing collection** et sur la **fiche d'un article indisponible** — le CTA « se tenir informé des arrivées » reporté par la 11.3. Pages `/newsletter/confirmation` et `/newsletter/desabonnement` (gestion par segment ou retrait total), toutes deux en `noindex`
- [x] **Vérifié** : `pnpm -r typecheck` clean, Biome clean, **API 352 / shared 75 / web 140 = 567** au vert (+32) ; **smoke réel sur serveur live** du cycle complet (capture → confirmation → rejeu du lien refusé → désabonnement d'un seul segment → désabonnement total avec purge de l'adresse → lien mort ensuite), passage par le **BFF** vérifié (POST anonyme accepté, requête cross-origin rejetée en 403), SSR des trois pages et **captures Playwright** du formulaire (footer et fiche produit)
- ⚠️ **Défaut vu à la capture, pas au code** : deux instances du formulaire coexistent sur une fiche produit (CTA + footer) — l'`id` du titre était dupliqué (`aria-labelledby` cassé) et le champ email s'étirait sur toute la largeur du footer. Corrigé (`useId()`, largeur plafonnée)
- Reste ouvert, hors périmètre : **page « politique de confidentialité »** (elle n'existe pas encore — la mention de consentement la cite en texte mais ne peut pas encore y lier) ; **écran d'administration** des abonnés et des envois ; purge planifiée des `pending` jamais confirmés (aujourd'hui ils restent inertes, jamais envoyés)

**Story 11.5** — Protection des visuels Gun Art ✅

> ⚠️ **Cadrage honnête, à répéter au client** : tout ce qui s'affiche est dans le cache du navigateur et une capture d'écran contourne n'importe quelle astuce JS/CSS. **Une seule mesure y survit** : le filigrane incrusté dans les pixels. Le reste est dissuasif, rien de plus — et c'est écrit dans le code, pas seulement ici.

- [x] **Filigrane incrusté côté serveur** (`apps/api/src/artworks/watermark.ts`) : texte SVG composé par `sharp`, **position, opacité, échelle et libellé paramétrables** (`ARTWORK_WATERMARK_*`). Trois positions : `bottom-right` (signature discrète), `center`, et `tiled` — grille en diagonale sur toute l'œuvre, **insensible au recadrage**. Le rendu s'adapte : la taille de police se déduit de la largeur voulue, donc un libellé plus long rétrécit le texte au lieu de déborder ; le mark est tracé deux fois (copie sombre décalée sous la copie claire) pour rester lisible **sur fond clair comme sur fond noir**
- [x] **Décision reportée à Sylvain, sans bloquer la livraison** (choix Franck) : l'esthétique est de la **configuration**, pas du code. Deux rendus d'exemple ont été produits pour trancher sur pièces plutôt que sur mots (`/tmp/scs-pw/wm-*.png`). Défaut livré : `bottom-right`, opacité 0,35
- [x] **Résolution d'affichage plafonnée** : `POST /api/admin/artworks/:slug/image` range l'**original intact en privé** (`gun-art/originals/<uuid>`) et ne publie qu'un dérivé plafonné à 1400 px et filigrané (`gun-art/public/<uuid>.webp`). **Aucune route publique ne sert l'original.** Les deux objets partagent un identifiant : rien de plus à stocker, et **le modèle média du catalogue reste à trancher en 7.5** (décision Franck : pas de table `artwork_images` prématurée)
- [x] **Accès à l'original réservé au traitement de commande** : `GET /api/admin/artworks/:slug/image/original`, admin uniquement, `no-store`, en pièce jointe, tracé dans `audit_logs` (comme le remplacement d'un visuel). Le format est **reniflé dans les octets** plutôt que mémorisé dans une colonne qui ne pourrait que diverger
- [x] **Remplacement propre** : poser un nouveau visuel supprime la paire précédente (public + original) — pas d'orphelins dans le bucket. L'original est écrit **avant** le dérivé : en cas d'échec on garde le fichier irremplaçable, pas le jetable
- [x] **Dissuasion côté client** : composant `ProtectedImage` (blocage `contextmenu` et `dragstart`, `draggable=false`, `-webkit-touch-callout` pour l'appui long iOS, `user-select`), branché sur les cartes Gun Art, la fiche œuvre et la visionneuse — **en opt-in**, la visionneuse servant aussi la boutique. ⚠️ **Volontairement écarté : la surcouche transparente qui avale les clics** — elle casserait le lien de la carte et le bouton de zoom sans rien apporter de plus que le blocage du menu contextuel. Le composant garde `alt`, `width` et `height` : la dissuasion ne se paie pas en accessibilité ni en layout shift
- [x] **Ne s'applique pas** aux visuels produit de l'armurerie (aucun enjeu de reproduction), conformément au périmètre
- [x] ⚠️ **Piège d'exécution attrapé et neutralisé** : le filigrane est du **texte SVG**, donc il exige une police — or `node:22-slim` n'en embarque aucune. Sans correctif, la production aurait publié des visuels au filigrane **vide, en silence**. L'image API installe désormais `fonts-dejavu-core`, un test vérifie que de l'encre est réellement déposée, et l'avertissement est écrit dans README et DEPLOY
- [x] ⚠️ **Effet de bord du plafond d'upload** : un original « qualité tirage » dépasse la limite multipart globale (10 Mo, dimensionnée pour les documents légaux). Le plafond applicatif passe à 30 Mo **et chaque route porte désormais sa propre limite explicite** (documents légaux 10 Mo, images de blog 10 Mo) — la limite par requête de `@fastify/multipart` s'est révélée inopérante (elle faisait échouer tous les uploads en 500), donc le contrôle est fait dans le handler. Les tests existants sur la taille des documents légaux verrouillent la non-régression
- [x] **Vérifié** : `pnpm -r typecheck` clean, Biome clean, **API 370 / shared 75 / web 144 = 589** au vert (+22) ; **smoke réel** (upload admin → dérivé public 1400 px filigrané, original 401 sans jeton et 200 en admin, `featuredImageUrl` mis à jour, fiche Gun Art servie avec `draggable=false` et menu contextuel bloqué) et **rendus visuels comparés** pour les trois positions
- ⚠️ **Défaut vu au rendu, pas au code** : la largeur du texte était sous-estimée (la lettre finale sortait du cadre en position coin) — l'estimation ignorait l'interlettrage. Corrigé et re-rendu
- Reste ouvert : **écran d'administration** pour poser un visuel (l'API est là, l'UI viendra avec la 7.5) ; variantes responsives / AVIF (tracées en 9.6) ; le filigrane ne protège pas les visuels **déjà publiés** avant cette story — il faudra les re-téléverser

**Story 11.6** — Gun Art éditorial : séries, thèmes & page artiste ✅

> Constat de départ : la collection ne se lisait que **pièce par pièce**, et l'identité de l'artiste (`artistName` / `artistBio` / `artistImageUrl`) vivait **dupliquée sur chaque œuvre** — une page artiste n'avait donc aucune source de vérité à lire. Trois notions deviennent des tables : `artists`, `artwork_themes`, `artwork_series`.

- [x] **Décisions de structure validées avec Franck avant de coder** : thème = table dédiée (et non colonne texte ni facette de `tags`) pour un libellé unique et une page indexable ; artiste = table + FK avec **suppression** des colonnes dupliquées (pas de seconde source de vérité) ; lien du livre **en base** et non en `.env`, pour qu'il se change depuis le backoffice ; URLs sous `/collection`
- [x] **Schéma** : `artists` (bio, parcours, portrait, livre, SEO), `artwork_themes` (slug, libellé, ordre), `artwork_series` (titre, **texte de présentation**, film/univers de référence, thème, artiste, ordre). `artworks` gagne `artist_id`, `series_id` et **`series_order`** — une série se lit dans l'ordre voulu par son auteur. FK en `set null` : une œuvre survit à la suppression de sa série, elle perd son rattachement éditorial, pas sa vente
- [x] **Migrations Drizzle 0004 + 0005**, découpées volontairement : `drizzle-kit generate` réclamait une confirmation interactive (il soupçonnait un renommage colonne→colonne). 0004 **ajoute et backfille** (chaque nom d'artiste distinct devient une ligne d'`artists`, bio et portrait repris, œuvres repointées), 0005 **supprime** les colonnes héritées
- [x] ⚠️ **Piège attrapé : la colonne générée.** `search_vector` indexait `artist_name` ; une colonne générée ne peut lire que **sa propre ligne**, donc sortir l'artiste de la table le sortait de l'index. La recherche globale le rattrape désormais **par la jointure** (`or to_tsvector(artists.name) @@ tsquery`, rang au `greatest`) — un test verrouille ce point, parce que la panne aurait été un **résultat vide silencieux**
- [x] ⚠️ **Second piège : l'index GIN emporté.** Supprimer puis recréer la colonne générée détruit `idx_artworks_search`, et le snapshot Drizzle croit toujours l'index présent — il n'aurait **jamais** été recréé. La migration 0005 le recrée à la main ; sans cela la recherche serait passée en scan séquentiel, sans la moindre erreur pour prévenir
- [x] ⚠️ **Troisième piège : l'idempotence du seed.** Le backfill crée des artistes **sans bio ni livre** ; un `DO NOTHING` les aurait laissés vides pour toujours. Le seed **comble les trous** (`coalesce`) sans jamais écraser un texte saisi, et rattache les œuvres antérieures à leur série sans défaire un rangement fait en admin
- [x] **API** : `GET /api/artworks/series`, `/series/:slug` (présentation + œuvres dans l'ordre), `/themes`, `/themes/:slug`, et `GET /api/artists`, `/api/artists/:slug` (bio, parcours, livre, séries, œuvres). Une **série non publiée** n'expose rien mais **ne masque pas** ses œuvres : elles restent visibles, simplement sans étiquette. Le lien du livre est **groupé** (titre + URL ou rien) : une URL sans titre se lit comme un lien nu, donc suspect
- [x] ⚠️ **Slugs d'œuvre réservés** : `series` et `themes` rejoignent `images` (11.5) — un segment statique l'emporte sur `/api/artworks/:slug`. Documenté dans le README. L'artiste est monté sur **son propre préfixe** `/api/artists` justement pour ne pas en réserver un de plus
- [x] **Front** : galeries par série (`/collection/serie/:slug`), navigation par thème (`/collection/theme/:slug`), **page artiste** (`/collection/artiste/:slug`) avec bio, parcours, portrait en noir et blanc et **lien Amazon** en `target="_blank" rel="sponsored noopener"`. `/collection/artiste` redirige vers l'artiste unique tant qu'il n'y en a qu'un, en `noindex`. La page collection s'ouvre désormais sur **les séries**, puis toutes les œuvres — une série vide ou un thème sans série ne sont **jamais** annoncés
- [x] **SEO** : JSON-LD `Person` (artiste), `CreativeWorkSeries` (série), `isPartOf` sur l'œuvre, `CollectionPage` sur le thème ; séries, thèmes et artistes ajoutés au `sitemap.xml`, au `llms.txt` et au `llms-full.txt`
- [x] **Vérifié** : Biome clean, `pnpm -r typecheck` clean, **API 393 / shared 91 / web 166 = 650** au vert (+32) ; **smoke réel** (les 6 routes API, les 4 pages front en 200 et les 404 sur slug inconnu, JSON-LD `Person` / `CreativeWorkSeries` / `isPartOf` présents, lien Amazon correctement attribué, sitemap et llms-full enrichis, recherche « Camille » retrouvant ses œuvres). Captures : `/tmp/scs-pw/edito-*.png`
- ⚠️ **Défaut vu au rendu, pas au code** : la colonne de 320 px du portrait restait réservée même sans portrait, comprimant la bio sur la moitié gauche. Corrigé par une classe conditionnelle et re-rendu
- Reste ouvert : **écrans d'administration** pour créer séries, thèmes et artistes (l'API publique est là, le CRUD admin arrive avec la 7.5) ; les **photos noir et blanc** et les visuels de série se posent par upload (le `cover_image_url` de série n'a pas encore de route d'upload dédiée — la 7.5 encore) ; pages de thème à coordonner avec la 9.6 pour les canonicals

**Story 11.7** — Cohérence des prix Gun Art entre formats ✅

> Constat de départ : `calculateArtworkPrice` applique `base × facteurFormat + increment × (editionLimit − numéro)`. Avec les valeurs plausibles du client (base 50 €, increment 2 €, 25 tirages, facteurs 1 / 1,5 / 2), le **petit format n°1 (98 €) dépassait le moyen format n°25 (75 €)** — exactement ce que le client refuse. La formule n'est **pas** corrigée : la décroissance avec le numéro est voulue. C'est la **grille de formats** qui est désormais validée.

- [x] **Règle partagée** (`packages/shared/src/artwork.ts`) : `buildArtworkPriceBands`, `validateArtworkPriceGrid`, `buildArtworkPriceGrid`. Le garde-fou refuse une grille où le prix **maximum** d'un format dépasse le prix **minimum** du format supérieur, soit `base × (facteur[n+1] − facteur[n]) ≥ increment × (editionLimit − 1)`. Seules les **paires consécutives** sont testées : les bornes étant ordonnées par facteur, une chaîne de voisins disjoints ne peut pas se croiser plus loin
- [x] **Diagnostic actionnable, pas seulement un refus** : chaque chevauchement renvoie les deux bornes fautives *et* les deux façons de le lever — `maxIncrementHt` (incrément maximal admissible) et `minUpperPriceFactor` (facteur minimal du format supérieur). Un test vérifie qu'appliquer l'une **ou** l'autre suffit
- [x] **Route admin** `POST /api/admin/artworks/price-grid` (`apps/api/src/artworks/pricing.ts`) : **sans état**, elle simule une grille sans lire ni écrire la moindre œuvre. Admin quand même — prix de base et incrément sont des paramètres commerciaux. Entrées bornées par zod (`editionLimit` 1–250, 1–10 formats, ids uniques) : les deux dimensions **dimensionnent la réponse**, pas seulement l'entrée
- [x] **Simulateur visuel** `/admin/gun-art/simulateur-prix` : paramètres de l'œuvre, formats ajoutables/supprimables, **grille complète 25 tirages × formats** avec les cellules fautives surlignées et les bornes par format. Il **ouvre sur la grille cassée du client**, pas sur un exemple bien rangé. Le verdict vient de l'API, donc ce que voit Sylvain est exactement ce que répondra le garde-fou serveur quand la 7.5 enregistrera une œuvre
- [x] ⚠️ **Bornes théoriques, jamais l'état des ventes** : les numéros étant partagés entre formats, « la dernière d'un format » dépend de l'ordre des achats et n'est pas prévisible. La règle porte donc sur ce que chaque format *peut* coûter — c'est écrit dans le code, dans l'API et dans l'écran
- [x] **25 exemplaires tous formats confondus** — verrouillé par un test explicite : l'index unique `uniq_print_per_artwork` sur `(artwork_id, print_number)` fait qu'un numéro déjà pris dans un format ne peut pas être réutilisé dans un autre
- [x] **Vérifié** : Biome clean, `pnpm -r typecheck` clean, **API 376 / shared 91 / web 151 = 618** au vert (+29) ; **smoke réel** en admin (grille client → verdict incohérent + les deux remèdes chiffrés, 24 cellules surlignées sur 75 ; facteurs portés à 1 / 2 / 3 → verdict cohérent, 0 cellule). Captures : `/tmp/scs-pw/price-{broken,fixed,grid}.png`
- ⚠️ **Défaut vu au rendu, pas au code** : la page était écrite en palette claire alors que le back-office est sombre — titres de panneaux invisibles. Repris sur les tokens du thème (`--ink-soft`, `--paper-faint`, `--brass`, `--danger`) et re-rendu
- Reste ouvert : **brancher le garde-fou sur le formulaire d'œuvre** (il n'existe pas encore — 7.5) ; la valeur du garde-fou est là, son point d'application arrivera avec le CRUD

**Story 11.8** — Cross-sell « Fréquemment achetés ensemble » ✅ _(livrée le 2026-09-18, branche `feat/story-11.8-cross-sell`)_

> Bloc de suggestions d'accessoires sur la **fiche détail** d'une arme, **éteint par défaut** : le client a dit « activé à la demande, pas forcément au début ».

**✅ Décisions validées avec Franck le 2026-09-18, avant d'écrire une ligne :**

- **Associations saisies à la main** (et non calculées sur les co-achats) : au lancement il n'y a aucun historique de commandes, et surtout les restrictions d'accessoires ne sont qu'une **note en texte libre** qu'aucune règle ne sait lire — seul un humain peut garantir qu'on ne suggère pas un accessoire interdit
- **Drapeau en variable d'environnement** (`CROSS_SELL_ENABLED`, faux par défaut) plutôt qu'un réglage en base : pas de migration, cohérent avec le reste de la configuration, activer = redémarrer l'API
- **Association dirigée, arme → accessoire** : la fiche d'un accessoire ne renvoie jamais vers une arme

- [x] **Règles pures et partagées** (`packages/shared/src/cross-sell.ts`) : catégories source/cible, plafond de 6 suggestions, motif de refus nommé, filtre d'affichage. ⚠️ **La seule règle qui touche au droit est étroite et à sens unique** : un accessoire ne peut pas exiger **plus de formalités** que l'arme sur laquelle il apparaît (une munition B sur une arme D enverrait le client vers un achat qu'il ne peut pas conclure ; l'inverse ne pose aucun problème). Tout le reste — la compatibilité réelle — reste une décision humaine
- [x] ⚠️ **Ce que le code ne prétend PAS faire** : vérifier `accessoryRestrictionNotes`. C'est du texte libre. L'écran d'administration l'**affiche en évidence** au moment de choisir, avec la phrase « aucune règle ne peut les vérifier à votre place » — c'est la seule protection honnête
- [x] **Schéma** : migration `0011`, table de liaison `product_cross_sells` (PK composite, `position` pour l'ordre voulu, CHECK `product_id <> accessory_id`, cascade des deux côtés)
- [x] **API** : `GET/PUT /api/admin/products/:id/cross-sells` (remplacement de la liste entière, dans l'ordre reçu, **journal d'audit** `cross_sell.updated` avec l'ancienne liste) et `GET .../cross-sell-options` (déjà filtré : un accessoire refusé n'est pas proposé puis rejeté). Refus en 409 pour une source qui n'est pas une arme, une arme suggérée, un accessoire trop exigeant
- [x] ⚠️ **Les règles sont réappliquées à l'affichage**, pas seulement à la saisie : une arme **reclassée après coup** cesse de proposer ce qui est devenu trop exigeant pour elle, sans qu'on ait à repasser sur les associations. Un accessoire **dépublié ou épuisé** disparaît du bloc — une suggestion qu'on ne peut pas acheter est une déception
- [x] **Écrans** : panneau `AdminCrossSellPanel` sur la fiche produit (ajout, réordonnancement, suppression, état du drapeau annoncé) et bloc public `ProductCrossSell` (cartes liées vers la fiche de l'accessoire, **jamais un ajout direct au panier** : un accessoire peut avoir des déclinaisons)
- [x] ⚠️ **Bug préexistant attrapé en écrivant les tests, hors périmètre mais destructeur** : zod applique les valeurs par défaut **même sur un champ rendu facultatif par `.partial()`**. Un PATCH ne portant qu'un champ se voyait compléter par tous les défauts du schéma de création — `published: false` **dépubliait** l'article, `variants: []` effaçait ses déclinaisons, `tagSlugs: []` ses tags, `stockQty: 0` son stock. Corrigé à la racine par `toPatchSchema()` dans `packages/shared`, appliqué aux **8 schémas de mise à jour** (produit, œuvre, arme ancienne, artiste, thème, série, tag, bénéficiaire). Effet de bord voulu : le garde-fou « au moins un champ » se met enfin à refuser un corps vide
- [x] **Vérifié** : Biome clean, `pnpm -r typecheck` clean, **API 508 / shared 153 / web 232 = 893** au vert (+36) ; **smoke réel** sur la base de dev — options proposées au Glock (cat. B) incluant les munitions 9×19, les mêmes options **sans** ces munitions pour le spray (cat. D), trois suggestions posées dans l'ordre, refus 409 des deux cas interdits, fiche publique les affichant **rendues côté serveur** (donc indexables), puis **liste vide après redémarrage sans le drapeau** — les associations restent en base, rien n'est exposé
- Reste ouvert : **aucune vérification visuelle automatisée** (Playwright n'est pas installé sur cette machine) — le rendu des deux écrans est à regarder à l'œil ; pas de calcul sur les **co-achats réels** (à rouvrir quand il y aura un historique de commandes) ; le bloc ne s'affiche que sur une **arme**, jamais sur un accessoire ni sur un tirage Gun Art ; la **base de dev** porte désormais trois associations posées pendant le smoke

**Story 11.9** — Expédition multi-colis ✅ _(livrée le 2026-09-13, branche `feat/story-11.9-shipments`)_

> Une arme de **catégorie B se livre en 2 colis** (arme et éléments séparés). C'est le manque fonctionnel le plus concret qui reste : il bloque une vente réelle.

**État des lieux vérifié le 2026-09-10** (à ne pas re-fouiller demain) :

- `orders` ne porte que `shipping_method` (`'std' | 'express' | 'retrait'`), `shipping_cost` et l'adresse — **ni transporteur, ni numéro de suivi, ni date d'expédition**.
- **Aucun statut d'expédition n'existe nulle part.** `ORDER_LEGAL_STATUSES` concerne les documents légaux, `paymentStatus` l'argent : rien ne dit si une commande est partie.
- Les deux écrans à étendre existent déjà : **admin** `/admin/orders/[id]` et **client** `/compte/commandes/[id]`.
- ⚠️ **Les lignes de commande vivent dans `orders.items_json`**, pas dans `order_items` (table présente mais inutilisée au tunnel — constat de la 11.10). Rattacher un colis à « ces lignes-là » se fera donc par `variant_id` / `print_id`, comme les reversements.

**✅ Décisions validées avec Franck le 2026-09-13 :**

- **Contenu d'un colis** : **table de liaison** `shipment_items` (colis ↔ lignes par `variant_id` / `print_id` + quantité, contrainte « exactement l'un des deux »), note libre facultative en plus. Une ligne ×2 peut se répartir sur deux colis.
- **Statut** : **par colis** (`preparing` → `shipped` → `delivered`) **et agrégé** sur la commande (`orders.shipping_status` : non expédiée / partiellement / expédiée / livrée). Stocké pour filtrer la liste admin, mais **écrit par une seule fonction de recalcul** appelée à chaque changement de colis — même discipline que `settlePayoutsForOrder`.
- **Transporteurs** : **liste fermée dans `packages/shared`** avec gabarit d'URL de suivi ; `varchar` en base (ajouter un transporteur ≠ migration), code inconnu refusé par l'API. « Autre » autorise un lien collé.
- **Notification client** : **un e-mail par colis** au passage à `shipped` (« colis 1/2 » + suivi), rendu idempotent par `notified_at`.
- **Découpage** : **suggéré, modifiable**, jamais créé tout seul. Règle portée par **`products.parcel_count`** (défaut 1, **pré-rempli à 2 pour la catégorie B** à la création, backfill des B existants par la migration).
- **Garde-fou** : un colis peut être **préparé** à tout moment, mais **pas expédié** tant que la commande n'est pas **payée** et, si elle contient une arme réglementée, tant que le **dossier légal n'est pas validé**.

- [x] **Règles pures et partagées** (`packages/shared/src/shipping.ts`) : transporteurs + URL de suivi, statut agrégé, contrôle de répartition, suggestion de découpage, garde-fou `canShipOrder`. ⚠️ **Une ligne scindée ne compte expédiée que quand TOUTES ses parties sont parties** : `shipment_items.part/parts` (« partie 1/2 ») figés à la création du colis
- [x] **Schéma** : migrations `0008` (tables `shipments` / `shipment_items`, `orders.shipping_status`, `products.parcel_count`, contraintes CHECK) et `0009` (rattrapage des armes B existantes)
- [x] ⚠️ **Piège attrapé au smoke réel** : la règle « catégorie B → 2 colis » avait passé la **boîte de munitions 9×19** (classée B) en 2 colis. Corrigé : `defaultParcelCount` ne vise que les **armes** B (`arme-poing`, `arme-longue`, `arme-defense`) ; migration, API, formulaire et seeds partagent la même fonction
- [x] **API** `/api/admin/shipments` (POST / PATCH / DELETE) : verrou de ligne sur la commande à l'emballage, préparation toujours possible, **départ refusé (409)** tant que la commande n'est pas payée ou que le dossier légal n'est pas validé, n° de suivi exigé pour un transporteur de la liste, suppression limitée aux colis en préparation, **journal d'audit** sur chaque action. Le détail admin porte `shipGate`, `shipments`, `suggestedParcels` ; la liste admin filtre par `shippingStatus` ; le client voit ses colis **sans les notes internes**
- [x] **E-mail « colis N/M en route »** : réservé par `notified_at` avant l'envoi (un aller-retour de statut ne renvoie rien), réservation **libérée si le fournisseur échoue** — l'expédition n'est jamais bloquée par une panne d'e-mail
- [x] **Écrans** : panneau `AdminShipmentsPanel` (emballage depuis la suggestion, suivi, statuts), colonne + filtre « Expédition » dans la liste, champ « Colis par unité » sur la fiche produit, bloc « Suivi de livraison » côté client (lien `noopener noreferrer nofollow`)
- [x] **Vérifié** : Biome clean, `pnpm -r typecheck` clean, **API 466 / shared 134 / web 218** au vert ; **smoke réel** : commande Glock 17 (cat. B) + lunette passée par l'API publique → 2 colis proposés (arme 1/2 seule, 2/2 avec la lunette) → départ bloqué tant que non payée → colis 1 parti (« Expédiée en partie », client voit « En route » + lien Colissimo) → colis 2 parti → `shipped`, **exactement 2 e-mails** (captés par un SMTP local : l'`.env` de dev pointe sur le vrai relais OVH)
- Reste ouvert : **retrait en armurerie** (`shipping_method = 'retrait'`) non distingué — une telle commande reste « non expédiée » ; pas de suivi transporteur automatique (statut « livré » saisi à la main) ; le paiement et le dossier légal du smoke ont été forcés en base (leurs parcours ont leurs propres stories) → repris en **11.9b**

**Story 11.9b** — Expédition : les points restés ouverts ✅

> Suite directe de la 11.9 (mergée, #79). Les quatre points ouverts étaient d'abord **quatre décisions**, tranchées avec Franck le 2026-09-16 avant d'écrire une ligne.

- [x] **Retrait en armurerie : pas proposé** — ⚠️ **décision produit de Franck**, prise après vérification : **aucun code n'écrit `shipping_method`**, le choix n'existe nulle part dans le tunnel. Plutôt que de construire un parcours dont personne n'a besoin, on pose un **garde-fou** : `canShipOrder` refuse une commande en retrait (`shipGate.reason = "pickup"`), l'API refuse d'emballer un colis (409), et le panneau admin le **dit** au lieu d'afficher « aucun article à expédier ». ⚠️ **Le retrait passe avant le paiement et le dossier légal** dans les raisons affichées : payer ou valider des papiers ne rendrait pas la commande expédiable, nommer l'argent enverrait l'admin chercher un problème qui n'existe pas. Les deux orthographes que le schéma a portées (`retrait`, `retirait`) sont couvertes
- [x] **Suivi transporteur automatique** — ⚠️ **décision de Franck : La Poste/Colissimo *et* Mondial Relay**. Deux contrats très différents, constatés avant de coder :
  - **La Poste « Suivi v2 »** (`api.laposte.fr`, en-tête `X-Okapi-Key`) : REST, codes de statut normalisés, et **une seule clé couvre Colissimo ET Chronopost** — le service harmonise les deux
  - ⚠️ **Mondial Relay n'a pas d'API REST de suivi publique** : c'est du **SOAP** (`WSI2_TracingColisDetaille`), signé par un **MD5** de la clé privée, qui renvoie des **libellés français en texte libre** — aucun code de statut. « Livré » s'y **lit** au lieu de se **consulter**, donc la règle est isolée dans une fonction pure et testée, et **penche toujours vers « voyage encore »** sur ce qu'elle ne reconnaît pas. Le transporteur n'était pas dans la liste : ajouté
  - [x] ⚠️ **Piège attrapé par un test** : `\b` en JavaScript est **ASCII** — il ne voit aucune frontière de mot après le « é » de « livré », donc `/livr[ée]\b/` ne matche **jamais**. Remplacé par un lookahead négatif. Et « livraison » ne doit jamais se lire « livré » : « en cours de livraison » reste en transit
  - [x] **Le mouvement est à sens unique** (`shipped` → `delivered`) : un transporteur qui nous dit « en transit » ne **défait pas** un « livré » coché par un humain. Relecture sous verrou de ligne avant d'écrire
  - [x] ⚠️ **Une question sans réponse n'est pas une réponse** : un transporteur injoignable laisse le colis **exactement** en l'état — rien n'est daté, rien n'est marqué, la passe suivante redemande
  - [x] **Journal d'audit en `system`**, jamais en admin : personne n'a cliqué, la trace doit dire **quoi** a fermé le colis (`source: "carrier_api"`)
  - [x] **Les deux fournisseurs sont optionnels** : sans identifiants, rien n'est interrogé et « livré » reste un clic admin, exactement comme avant. Un déploiement partiel (La Poste branché, Mondial Relay non) est un état **normal**, pas une panne
  - [x] **Scheduler in-process** toutes les `TRACKING_POLL_INTERVAL_MINUTES` (180 par défaut) **+ CLI** `tracking:sync` pour un cron externe — même patron que le SLA légal (7.x). Bouton **« Rafraîchir le suivi »** côté admin pour ne pas attendre la passe suivante ; quand aucun transporteur n'est interrogeable, le bouton **explique pourquoi** au lieu de ne rien faire
  - [x] Colonnes `tracking_checked_at` / `tracking_label` (migration `0010`) : les mots du transporteur, montrés à l'admin **et au client** — c'est la même chose que montre le lien de suivi. Les notes internes restent internes
- [x] **Avertissements d'hydratation sur tout l'admin** — `routeRules { ssr: false }` sur `/admin` **et** `/admin/**` (⚠️ `/admin/**` ne couvre pas `/admin` lui-même). Le back-office est privé et authentifié : ni SSR ni SEO à y gagner, et la cause disparaît à la racine plutôt que page par page. **Vérifié au smoke** : `/admin` et `/admin/produits` renvoient **0 caractère** de contenu rendu côté serveur, `/boutique` en renvoie 35 783 — le SEO public est intact
- [x] **E-mails en dev : Mailpit** dans `docker-compose.dev.yml` (SMTP 1025, interface 8025), et `.env.example` **pointe dessus par défaut**. ⚠️ Atteindre le vrai relais OVH devient une **modification explicite** du `.env`, plus le comportement par défaut. **Vérifié au smoke** : un mot de passe oublié et un « votre colis est en route » ont atterri **dans Mailpit**
- [x] **Vérifié** : Biome clean, `pnpm -r typecheck` clean, **API 495 / shared 139 / web 223 = 857** au vert (+39) ; **smoke réel** — refus d'emballer une commande en retrait (409), `shipGate` à `pickup` et aucune suggestion, refus honnête du suivi à la demande sans clé transporteur (409), colis Mondial Relay expédié avec son lien de suivi, e-mail capté par Mailpit, et SSR admin confirmé à zéro
- Reste ouvert : **les clés transporteur ne sont pas fournies** — le code est en place et testé contre des fournisseurs substitués, mais **rien n'a été interrogé pour de vrai**. Il faut une clé Okapi (developer.laposte.fr, produit « Suivi ») et un couple enseigne/clé privée Mondial Relay pour un premier appel réel ; ⚠️ la lecture des libellés Mondial Relay **doit être reconfrontée** à de vraies réponses. Pas d'**e-mail « votre colis est arrivé »** (la 11.9 ne prévient que du départ) ; pas de statut pour un **incident** de livraison (nos colis ne connaissent que préparé/expédié/livré) — le libellé du transporteur le porte, mais rien ne le signale

**Story 11.10** — Rentabilité par article : marge, charges & reversements ✅

> Existant au départ : `products.costPrice` et `products.marginPct` étaient **déjà en base** mais **aucune interface ne les exposait**, et il n'y avait ni notion de charges ni de rémunération de tiers. Seule la commission de Franck existait (`COMMISSION_RATE_PCT`, globale, 7.3).

- [x] **Qui est payé, tiré au clair avec le client** — après **deux lectures erronées de ma part, corrigées** : ce n'est ni du dépôt-vente pour les armes, ni un achat-revente par Florian. **Fred et Steph** exploitent le site ; **Florian les conseille** et touche une **commission sur la vente** ; **Sylvain** confie ses tirages, le site vend **pour son compte** et il touche une part. Les deux ont donc **la même forme** — un bénéficiaire, une part sur une vente — d'où une entité dédiée et non deux champs sur mesure
- [x] **Décisions validées avec Franck avant de coder** : table `beneficiaries` dédiée (la fiche `artists` de la 11.6 reste **éditoriale** et pointe vers l'identité **financière**) ; taux **par défaut sur le bénéficiaire, renégociable article par article** ; assiette **HT et nette de remboursement** ; **une ligne de reversement par vente, avec statut**
- [x] **Calcul partagé et testé à part** (`packages/shared/src/profitability.ts`) : `marge = prix − achat − charges − reversement`. Les charges acceptent un **pourcentage OU un montant** (le montant l'emporte), avec un **défaut global** en configuration (`DEFAULT_CHARGES_PCT`). ⚠️ **`0` est une réponse, pas une absence** : un article explicitement à 0 % ne retombe **pas** sur le défaut
- [x] ⚠️ **La marge intègre le reversement, délibérément.** L'ignorer aurait affiché un chiffre qui se lit comme du bénéfice et n'en est pas — c'est exactement ce que la note d'origine de cette story annonçait
- [x] **Le taux est figé à la vente**, comme `orders.items_json` fige déjà le prix : renégocier demain ne réécrit **jamais** ce qui était dû hier. Un test le prouve dans les deux sens — l'ancienne vente garde son taux, la vente suivante prend le nouveau
- [x] ⚠️ **Les lignes de commande ne vivent pas dans `order_items`** (table présente mais inutilisée au tunnel) : elles sont dans `orders.items_json`. Un reversement désigne donc la sienne par `variant_id` ou `print_id`, et en conserve le libellé
- [x] **Cycle de vie** : `pending` à la commande (rien n'est dû tant que l'argent n'est pas là) → `due` à l'encaissement → `paid` quand l'admin le marque → `cancelled` si la vente est annulée ou intégralement remboursée. Un remboursement **partiel** réduit la part au prorata (les remboursements sont enregistrés **par commande**, pas par ligne). ⚠️ **Un reversement déjà versé n'est plus jamais retouché** : de l'argent sorti est un fait, pas une projection
- [x] ⚠️ **Bug attrapé par un test** : une commande **remboursée** retombait en `pending`, c'est-à-dire dans la file des ventes qui attendent un encaissement qui ne viendra jamais. Une vente remboursée a été payée puis défaite — elle est `cancelled`
- [x] **API** `/api/admin/finance/{beneficiaries,payouts,beneficiary-options}` : totaux à venir / dû / versé par bénéficiaire, filtres par bénéficiaire et statut. Seule la **décision humaine** est modifiable sur un reversement — taux, base et montant sont figés. Supprimer un bénéficiaire qui figure sur une vente est **refusé** (« désactivez-le ») : une trace de reversement est de la comptabilité
- [x] **Écrans** : `/admin/beneficiaires` et `/admin/reversements`, plus un **panneau de rentabilité** sur les formulaires produit et œuvre — prix, achat, charges, reversement nommé, marge en € et en %. ⚠️ **Sans prix d'achat, la marge est annoncée comme un plafond**, pas un résultat. Pour une œuvre, elle est calculée sur le **tirage le plus cher** et l'écran le dit
- [x] ⚠️ **Pas d'IBAN en base — décision confirmée par Franck le 2026-09-10**, et pour une raison plus forte que la mienne : **Henrri sera branché ensuite** et détiendra déjà les coordonnées de versement. Les stocker ici dupliquerait une donnée bancaire sensible dans un second système, sans que personne ne l'exige. Une note libre porte les modalités. *(Le schéma anticipe déjà Henrri : `henrri_invoice_id`, `henrri_sync_status` sur les factures.)*
- [x] **Jamais exposé publiquement** : prix d'achat, charges, marge et part d'un tiers sont strictement admin
- [x] **Vérifié** : Biome clean, `pnpm -r typecheck` clean, **API 451 / shared 108 / web 209 = 768** au vert (+42) ; **smoke réel** (bénéficiaires créés, produit rattaché, marge recalculée à la renégociation) et **parcours navigateur** sur les deux écrans et le panneau
- Reste ouvert : **pas d'export comptable** des reversements (CSV / récapitulatif par période) — ⚠️ **à cadrer avec l'intégration Henrri** plutôt qu'à réinventer, puisque c'est lui qui portera la facturation et les versements (cf. clarifications § F) ; la rentabilité d'une œuvre est donnée pour un seul tirage, pas pour l'édition entière ; aucun **journal d'audit** sur le passage à « versé », alors que c'est une action qui touche de l'argent

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
