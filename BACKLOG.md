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
- Différé (documenté) : baseline de migration (vs `push --force`), rotation des secrets, clé S3 dédiée least-privilege pour les backups, nonce CSP (drop `unsafe-inline`), 3 moderates `pnpm audit` dev/build-time uniquement, durcissement conteneur avancé (cap_drop/read_only) à valider en staging

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
- **Refonte de la navbar (priorité — desktop + mobile)** : le header actuel empile les éléments à plat (liens + recherche + auth + panier + CTA), peu aéré. Objectifs :
  - **Deux univers lisibles** : Armurerie (`/boutique`) vs Gun Art (`/collection`) — point d'entrée clair (split ou méga-menu par univers).
  - **Desktop** : réorganiser/aérer, **icônes** (panier avec compteur, compte/admin selon connecté + `isAdmin`, accueil), envisager un mega-menu.
  - **Mobile** : **burger plein écran** (overlay pleine page) + **animation** d'ouverture/fermeture.
  - Le lien « Panier » + badge (ajouté en 10.4a) est temporaire en attendant cette refonte.

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
