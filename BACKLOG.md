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

## PHASE 9 — Front, SEO & Découvrabilité (transverse)

> Remarques Franck (2026-06-10, après démo front 5.3). Palette laiton + charbon **validée** — à conserver.

**Story 9.1** — Recherche globale (armes + Gun Art)

- Barre de recherche unifiée header + page résultats, couvrant les produits **et** les œuvres
- API : produits ont déjà `searchVector` + `websearch_to_tsquery('french', …)` (cf. `products/list.ts`) ; ajouter la recherche côté `artworks` (titre/artiste/description) et un endpoint agrégé ou deux sources fusionnées côté front
- Mobile-first, états vide/erreur, debounced

**Story 9.2** — Page 404 soignée

- `app/error.vue` Nuxt cohérent avec l'identité galerie (visuel, message, CTA retour collection / accueil), bon status HTTP, SEO `noindex`

**Story 9.3** — Œuvres en orientation portrait ET paysage

- Aujourd'hui carte + détail figés en `aspect-ratio: 4/5` (portrait). **Le gros du catalogue sera paysage** → prévoir le cas dès maintenant
- Data : dériver l'orientation/ratio (champ `orientation` ou dimensions image, ou `availableFormats`) ; media responsive qui s'adapte (object-fit, aspect-ratio dynamique) sans casser la grille
- Cartes : grille robuste quel que soit le ratio (hauteur homogène ou masonry léger)

**Story 9.4** — Blog (SEO-first)

- Section éditoriale, **d'abord pour le référencement** (peut ne pas être exploitée fonctionnellement au début)
- Modèle de contenu (articles : slug, titre, extrait, corps, meta, image), index + article, JSON-LD `Article`/`BlogPosting`, sitemap, fil RSS éventuel
- Back : CRUD admin (rejoint Phase 7) ; front : SSR + SEO complet

**Story 9.5** — Agent-ready / découvrabilité IA

- Être visible dans les recherches d'**agents LLM** : `llms.txt` (+ `llms-full.txt`), `sitemap.xml`, structured data complète et valide (Product/VisualArtwork/Offer/Breadcrumb/Organization déjà amorcés), contenu sémantique propre, métadonnées riches
- Étudier un format/endpoints pensés pour agents (réponses structurées, éventuellement exposition MCP en lecture)

## PHASE 10 — Front client (boutique armurerie, auth & tunnel d'achat)

> Angle mort identifié 2026-06-10 : le **back** des deux univers (armurerie réglementée **et** Gun Art) est fait (Phases 1-4), mais le **front client** ne couvre que Gun Art (5.3). Ces stories = les écrans Nuxt manquants, au-dessus d'API déjà construites. Réutiliser l'identité « galerie » validée + baseline mobile-first/SSR/SEO de la 5.3 (cf. [[project_front_direction]] en mémoire).

**Story 10.1** — UI Auth (inscription, connexion, reset)

- Pages Nuxt inscription / connexion / mot de passe oublié / reset (API Phase 1)
- Gestion de session côté client (stockage token + refresh), middleware de route protégée, état connecté dans le header
- Mobile-first, validations alignées sur `shared`, états erreur/lockout/anti-énumération respectés

**Story 10.2** — Catalogue armurerie (listing + filtres + recherche)

- Page boutique : grille produits, filtres catégorie / catégorie légale / prix, recherche full-text (API 2.1, `{ data, pagination }`)
- Mobile-first, SSR + SEO, états vide/erreur ; recoupe la recherche globale 9.1 (à coordonner)

**Story 10.3** — Fiche produit armurerie

- Page détail (API 2.2) : variants, prix TTC, **mentions légales** (catégorie, âge mini, docs requis), restrictions ; ajout au panier
- SEO `Product` JSON-LD ; gère un produit sans variant seedé (cf. note 2.2)

**Story 10.4** — Panier & tunnel d'achat (commun aux 2 univers)

- Page panier (produits + tirages), récap totaux, **remise VIP affichée**, retrait de lignes (libération tirage)
- Choix/saisie adresses depuis le carnet (API 3.x), récap du **split paiement** virement/CB, création commande (API 3.2)
- Débouche sur le paiement (Phase 6) → ensemble = « achetable de bout en bout »

**Story 10.5** — Espace compte (commandes + documents légaux)

- Profil (API 1.3), liste + détail commandes avec statut légal/paiement (API 3.3)
- **Upload & suivi des documents légaux** (API 4.1) + checklist légale par commande (API 4.3) : statut par doc, motif de rejet, réupload
- Cœur de l'expérience réglementée côté client

**Story 10.6** — Accueil unifié & navigation 2 univers

- Page d'accueil présentant **armurerie + Gun Art** (aujourd'hui hero centré Gun Art), navigation header vers les deux univers
- Cohérence de marque entre la boutique réglementée et la galerie d'art

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
