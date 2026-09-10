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
- [x] Webhook Stripe étendu : `charge.refunded` / `refund.updated` / `refund.created` → `settleStripeRefund` (match par `stripe_refund_id`, idempotent, déclenche la cascade quand le refund passe `succeeded`)
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
**Story 8.5** — Monitoring uptime + alertes — ⏸️ **DIFFÉRÉE** (2026-06-18)

- Approche à trancher (Uptime Kuma auto-hébergé vs service externe vs stack Prometheus/Grafana/Loki) ; reprise ultérieure. L'alerting applicatif sur 5xx existe déjà (Story 7.2).

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

**Story 8.9** — Isolation des suites de tests : supprimer la dépendance à l'ordre des fichiers — 🔜 **À FAIRE**

> Relevé le 2026-09-10 en cherchant l'échec CI de la 7.5b (qui, lui, avait une tout autre cause : le boot Nuxt dépassait le `hookTimeout`). La suite API **passe ou échoue selon l'ordre des fichiers**. Aujourd'hui l'ordre est déterministe et tombe du bon côté, donc la CI est verte — mais elle l'est **par chance**, pas par construction. Ajouter, renommer ou scinder un fichier de test peut faire basculer l'ordre et rendre rouge une suite que personne n'a touchée.

- **Mesure** : en ne mélangeant que l'**ordre des fichiers** (`--sequence.shuffle.files=true --sequence.shuffle.tests=false`), 2 passes sur 3 sont propres et la 3ᵉ casse **4 tests**. ⚠️ Ne pas mesurer avec `--sequence.shuffle` tout court : celui-ci mélange aussi les tests **à l'intérieur** d'un fichier, ce qui casse par construction toute suite d'intégration écrite comme un récit (créer → modifier → supprimer) et gonfle le chiffre à ~25 échecs sans rien révéler d'utile.
- **Cause identifiée, précise** :
  - `legal-documents/sla.test.ts:43` fait `delete(users).where(eq(users.role, "admin"))` — il supprime **tous** les admins, **y compris celui du seed**. C'est délibéré : son test « aucun admin à notifier » exige qu'il n'en reste aucun.
  - `ancient-weapons/ancient-weapons.test.ts:380` **emprunte** l'admin qui se trouve là (`where(eq(users.role, "admin")).limit(1)`) au lieu d'en créer un, comme le font toutes les autres suites. Si la SLA passe avant, il échoue sur `No admin seeded (run db:seed)`.
- **Correctif proposé** (petit) : faire créer à `ancient-weapons.test.ts` **son propre** admin dans son `beforeAll`, avec un préfixe d'e-mail qui lui est propre, et le supprimer dans son `afterAll` — la convention que suivent déjà les 20 autres suites.
- **À vérifier au passage** : `sla.test.ts` porte deux assertions qui dépendent de l'**état global** (« exactement 2 destinataires », « aucun admin »). Elles tiennent tant que les suites nettoient derrière elles, mais elles casseraient dès qu'une suite fuirait un admin — par exemple si elle échoue avant son `afterAll`. Envisager d'assouplir la première (`toContain` plutôt que `toHaveLength`).
- **Done** : les trois passes en ordre de fichiers mélangé sont vertes, et la mesure est documentée dans le README pour qu'on la refasse au lieu de la redécouvrir.

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

**Story 9.6** — SEO avancé « aux petits oignons » — 🔜 **À FAIRE (après)**

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

**Story 11.8** — Cross-sell « Fréquemment achetés ensemble » — 🔜 **À FAIRE (activable à la demande)**

- Bloc de suggestions d'accessoires sur la **fiche détail** d'une arme.
- **Désactivé par défaut** (feature flag) : le client a explicitement dit « activé à la demande, pas forcément au début ».
- **⚠️ Décision** : associations **saisies manuellement** en admin **vs** calculées sur les co-achats réels. Reco : **manuel d'abord** — au lancement il n'y a aucun historique de commandes à exploiter.
- Respecter les **restrictions d'accessoires** déjà modélisées (`hasAccessoryRestrictions`, `accessoryRestrictionNotes`) : ne jamais suggérer un accessoire interdit pour la catégorie légale de l'arme.

**Story 11.9** — Expédition multi-colis — 🔜 **À FAIRE**

> Une arme de **catégorie B se livre en 2 colis** (arme et éléments séparés). Constat : **aucun modèle d'expédition n'existe** — `orders` ne porte qu'un `shippingMethod`, un `shippingCost` et une adresse (`db/schema.ts:961`).

- Nouvelle table `shipments` (plusieurs par commande) : transporteur, **numéro de suivi**, contenu (lignes de commande rattachées), statut, date d'expédition.
- Admin : création et suivi des colis depuis le détail commande.
- Client : suivi **par colis** dans l'espace compte, pas un statut global unique.
- À prévoir de façon générique (tout produit peut être multi-colis), la catégorie B n'étant que le cas déclencheur.

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
- [x] ⚠️ **Pas d'IBAN en base** : ce serait une donnée bancaire de plus à protéger pour un besoin que rien n'exige — les versements se font hors du site. Une note libre suffit
- [x] **Jamais exposé publiquement** : prix d'achat, charges, marge et part d'un tiers sont strictement admin
- [x] **Vérifié** : Biome clean, `pnpm -r typecheck` clean, **API 451 / shared 108 / web 209 = 768** au vert (+42) ; **smoke réel** (bénéficiaires créés, produit rattaché, marge recalculée à la renégociation) et **parcours navigateur** sur les deux écrans et le panneau
- Reste ouvert : **pas d'export comptable** des reversements (CSV / récapitulatif par période) ; la rentabilité d'une œuvre est donnée pour un seul tirage, pas pour l'édition entière ; aucun **journal d'audit** sur le passage à « versé »

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
