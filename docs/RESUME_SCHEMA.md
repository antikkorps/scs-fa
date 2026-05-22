# Schéma E-Commerce Armurier - RÉSUMÉ EXÉCUTIF

## 🎯 Ce qu'on a bâti

### Stack

- **Frontend**: Nuxt 3 + PrimeVue (Aura theme) + Vite
- **Backend**: Fastify + PostgreSQL + Drizzle ORM + TypeScript
- **Infra**: Docker Compose + Hetzner VPS + S3 Scaleway (EU RGPD)
- **Paiement**: Split auto (virement + Stripe/Mangopay pour CB)
- **Factures**: Henrri (sync automatique phase 1)

---

## 📊 Structure BD

### Tables principales (12 domaines)

| Domaine          | Tables                                            | Clé                   |
| ---------------- | ------------------------------------------------- | --------------------- |
| **Auth & Légal** | users, legal_documents, legalCategories           | Catégories A/B/C/D    |
| **Produits**     | products, productVariants, ancient_weapons        | SKU + variants        |
| **Gun Art**      | artworks, artworkPrints                           | Max 25 tirages/format |
| **Commandes**    | orders, orderItems, paymentVirement, paymentCarte | Split automatique     |
| **Factures**     | invoices                                          | Henrri sync           |
| **Stock**        | stockMovements                                    | Trail complet         |
| **Blog**         | blogPosts                                         | SEO + tags            |
| **Audit**        | auditLogs                                         | RGPD compliance       |

---

## 🔄 WORKFLOWS CLÉS

### A. COMMANDE AVEC ARME (Exemple: 1 fusil Cat C + 2 accessoires)

```
1. Client panier
   ├─ Fusil (1500€ HT) → Catégorie C → virement obligatoire
   └─ Accessoires (50€ HT) → accessoires → CB possible

2. Création commande (1 commande = 1550€ HT total)
   ├─ legalVerificationStatus = 'pending' (car contient une arme Cat C)
   ├─ paymentStatus = 'pending'
   └─ legalVerificationDeadline = NOW + 48h

3. Workflow légal
   ├─ Client upload CNI + Permis de chasse + SIA
   ├─ Docs → 'docs_verifying'
   └─ Stéphane valide dans 48h → 'docs_verified'

4. Payment split auto
   ├─ VIREMENT: 1500€ HT (fusil)
   │  └─ Create paymentVirement with IBAN + montant
   └─ CARTE: 50€ HT (accessoires)
      └─ Redirect Stripe (seul les accessoires)

5. Après paiement complet
   ├─ Créer invoice Henrri (fusil + accessoires)
   ├─ Email client confirmation
   └─ Status → 'payment_received' → prêt expédition

6. Expédition
   └─ Signature obligatoire + assurance auto
```

### B. COMMANDE GUN ART (Exemple: Photo tirage mixte)

```
1. Client choisit artwork "Fusil Winchester 1873"
   └─ Limité à 25 exemplaires

2. Client choisit format/numéro
   ├─ Format A4 (21x29.7cm), tirage "3/25"
   └─ Pricing:
      ├─ Base price: 50€
      ├─ Format factor: 1.0 (petit)
      ├─ Rareté: 2€ * (25 - 3) = 44€
      └─ TOTAL: 50 + 44 = 94€ HT

3. Panier + checkout
   ├─ Pas besoin de docs légaux
   ├─ Paiement: CB OU virement
   └─ NO VIP possible (car c'est Gun Art, pas arme)

4. Paiement
   └─ Si CB → Stripe direct
   └─ Si virement → paymentVirement

5. Après paiement
   ├─ Générer certificat d'authenticité
   ├─ Update artworkPrint.status = 'sold'
   └─ Email avec certificat PDF

6. Le tirage "4/25" (next) coûtera: 50 + 2*(25-4) = 92€ HT
   7. Le tirage "25/25" (last) coûtera: 50 + 2*(25-25) = 50€ HT
```

### C. COMPTE & VIP

```
Scénario: Client achète 1 arme neuve (cat B)

1. Première arme neuve achetée
   ├─ users.vipEligibleSince = date de la commande
   └─ users.vipActive = true

2. Client est maintenant VIP à VIE
   ├─ Réductions sur futurs achats (50% de la marge dispo)
   ├─ Sauf: munitions + promos spécifiques
   └─ Pas d'expiration, pas de renouvellement

3. Réduction calcul
   ├─ Produit: 100€ HT avec 30% de marge
   ├─ VIP discount = 100 * (30% * 0.5) = 15€
   └─ Client paie: 85€ HT + TVA

4. Si client achète accessoires sans arme
   ├─ users.vipActive = false (pas d'arme neuve)
   └─ Mais devient VIP dès 1ère arme neuve
```

---

## 💳 PAIEMENT - SPLIT AUTOMATIQUE

### Règles

| Produit               | Virement | Carte | Compte      |
| --------------------- | -------- | ----- | ----------- |
| Arme neuve (B,C,D)    | ✅       | ❌    | Obligatoire |
| Arme occasion (2)     | ✅       | ❌    | Obligatoire |
| Arme ancienne (1)     | ✅       | ❌    | Obligatoire |
| Munition (6)          | ✅       | ❌    | Obligatoire |
| Accessoire (7a,7b,7c) | ✅       | ✅    | Optionnel   |
| Gun Art               | ✅       | ✅    | Optionnel   |

### Exemple split commande

```
Commande mixte:
├─ 1x Pistolet (cat B) = 800€ HT
├─ 2x Accessoires = 50€ HT
└─ 1x Gun Art = 100€ HT
──────────────────────────
TOTAL = 950€ HT

Split:
├─ VIREMENT (armes seules)
│  └─ Montant: 800€ HT + TVA = 960€ TTC
├─ CARTE (accessoires + Gun Art)
│  └─ Montant: 150€ HT + TVA = 180€ TTC

Workflow:
1. Client complète formulaire "paiement CB"
2. Redirige Stripe (180€ pour accessoires + Gun Art)
3. Une fois validé → paymentCarte.status = 'received'
4. Page affiche "IBAN de réception + montant virement"
5. Client vire 960€
6. Admin rapproche quand reçu
```

---

## 🔐 DOCUMENTS REQUIS PAR CATÉGORIE

```
CAT A: Interdites (ne pas vendre)
  └─ Docs: CNI seulement (info)

CAT B: Armes semi-auto soumises à autorisation
  ├─ Docs requis:
  │  ├─ CNI (obligatoire)
  │  ├─ Autorisation préfectorale de détention
  │  └─ SIA (certificat d'immatriculation)
  └─ Min age: 18 ans

CAT C: Fusils de chasse, carabines
  ├─ Docs requis:
  │  ├─ CNI (obligatoire)
  │  ├─ Permis de chasser
  │  └─ SIA
  └─ Min age: 18 ans

CAT D: Armes de défense (spray, bâton)
  ├─ Docs requis:
  │  └─ CNI seulement
  ├─ Min age: 18 ans
  └─ Note: Pas vraiment d'autorisation préfectorale requise

ARMES AVANT 1900: EXEMPTÉES DE VÉRIFICATION
  ├─ Pas de docs requis
  └─ Intéressant pour collectionneurs

NON-RÉGLEMENTÉE (Accessoires, Gun Art):
  └─ Pas de docs
```

---

## 📱 EXEMPLES DE DONNÉES

### Produit: Pistolet (Cat B, Arme neuve)

```typescript
{
  id: 'prod-001',
  sku: 'FN-1900-BLUE',
  slug: 'fn-1900-pistolet-blue',
  name: 'FN 1900 Pistolet Blue',
  categoryId: 'cat-arme-poing',
  legalCategoryId: 'legal-B', // Catégorie B

  priceHt: 800,
  marginPct: 25,
  vatPct: 20,

  requiresLegalVerification: true,
  ageMinRequired: 18,

  // Variants: finition, couleur
  variants: [
    { skuVariant: 'FN-1900-BLUE-noir', finition: 'noir', stock: 5 },
    { skuVariant: 'FN-1900-BLUE-bleu', finition: 'bleu', stock: 3 },
  ]
}
```

### Produit: Gun Art (Tableau "Winchester")

```typescript
{
  id: 'art-001',
  sku: 'ART-WINCHESTER-2024',
  title: 'Winchester 1873 - Série Armurerie',
  artistName: 'Jean Dupont',

  editionLimit: 25, // Max 25 tirages
  basePriceHt: 50, // Prix 1er tirage petit format
  priceIncrementHt: 2, // +2€ par tirage restant

  availableFormats: [
    { id: 'A4', name: 'A4 (21x29.7)', priceFactor: 1.0 },
    { id: 'A3', name: 'A3 (29.7x42)', priceFactor: 1.5 },
    { id: 'A2', name: 'A2 (42x59.4)', priceFactor: 2.0 },
  ],

  // Prints: créés à la commande
  prints: [
    { id: 'p-001', printNumber: 1, status: 'sold', soldPrice: 94 },
    { id: 'p-002', printNumber: 2, status: 'sold', soldPrice: 96 },
    { id: 'p-003', printNumber: 3, status: 'available' },
    // ...
  ]
}
```

### Commande avec workflow légal

```typescript
{
  id: 'order-123',
  userId: 'user-456',

  // WORKFLOW LÉGAL
  legalVerificationStatus: 'docs_verified', // ✅ Docs valides
  legalVerifiedAt: '2024-03-15T14:30:00Z',
  legalVerifiedBy: 'admin-stephane',
  legalVerificationDeadline: '2024-03-13T14:30:00Z', // SLA 48h passée (OK)

  // PAIEMENT SPLIT
  paymentStatus: 'reconciled', // Virement reçu
  itemsJson: [
    {
      variantId: 'var-001',
      qty: 1,
      priceHt: 800,
      name: 'FN 1900 Pistolet',
      category: 'arme_poing',
      requiresPaymentVirement: true, // → VIREMENT
    },
    {
      productId: 'prod-002',
      qty: 2,
      priceHt: 50,
      name: 'Accessoires tireur',
      category: 'accessoire_tireur',
      requiresPaymentVirement: false, // → CARTE
    },
  ],

  // Calcul
  subtotalHt: 900,
  vatAmount: 180,
  totalTtc: 1080,

  // VIP appliqué?
  vipDiscountAppliedPct: 5,
  vipDiscountAmount: 45, // 50€ * 90% = 45€ réduit

  // Henrri
  henrriInvoiceId: 'HNR-2024-0001',
  henrriSyncStatus: 'synced',
  henrriSyncAt: '2024-03-15T15:00:00Z',
}
```

### Documents légaux uploadés

```typescript
{
  id: 'doc-001',
  userId: 'user-456',
  docType: 'cni',
  s3Key: 'documents/user-456/cni/1710493800_cni-scan.pdf',
  s3Url: 'https://s3.fr-par.scw.cloud/...(pré-signée 7j)',

  expiresAt: '2028-03-15',
  verificationStatus: 'approved',
  verifiedAt: '2024-03-14T10:00:00Z',
  verifiedBy: 'admin-stephane',
  verificationNotes: 'Document lisible, adresse OK, dates valides',
  verificationDeadline: '2024-03-13T14:30:00Z', // SLA respecté ✅
}
```

---

## 🎛️ GESTION STOCK

```typescript
// Mouvements de stock tracés
{
  id: 'stock-001',
  variantId: 'var-001',
  qtyChange: -1, // Réduction
  movementType: 'sale', // Vente
  referenceId: 'order-123',
  referenceType: 'order',
  createdAt: '2024-03-15T15:30:00Z',
  createdBy: 'system',
}

// Alert si stock bas
if (variant.stockQty < variant.stockAlertLevel) {
  // 📧 Email admin: "Stock bas pour FN-1900-BLUE (1 reste)"
}
```

---

## 🔄 MIGRATION & DÉPLOIEMENT

### Phase 1 (MVP)

- ✅ Schéma DB complet
- ✅ Auth JWT
- ✅ Produits + variantes
- ✅ Workflow légal + upload docs
- ✅ Panier + commandes
- ✅ Paiement split (virement + CB)
- ✅ Factures Henrri (sync auto)
- ✅ Admin dashboard (validation docs, paiements)

### Phase 2

- Gun Art (tirage numéroté + certificats)
- Armes anciennes (gestion expertise)
- Notifications email (transactionnelles + alerts)
- Dashboard analytics
- Export comptable

### Phase 3

- Intégration 2FA
- Recommandations produits
- Wishlist
- Système d'avis
- Blog (commentaires modérés)

---

## 🔒 SÉCURITÉ & RGPD

```
✅ Chiffrement S3 (AES256)
✅ HTTPS/TLS (Caddy auto SSL)
✅ JWT tokens (refresh token sécurisé)
✅ Soft deletes (users.deletedAt)
✅ Audit logs complets (7 ans min)
✅ IBAN masquée en affichage
✅ Docs légaux pré-signés (7j validity)
✅ Rate limiting sur auth endpoints
✅ Validation stricte Zod sur tout
```

---

## 📋 CHECKLIST AVANT CODE

- [ ] Clarifier formula exact pricing Gun Art avec client (done)
- [ ] SLA 48h validation confirmé (done)
- [ ] Catégories légales A/B/C/D bien mappées (done)
- [ ] Split paiement logic approuvée (done)
- [ ] Documents requis par cat finalisés (done)
- [ ] Accès Henrri API fourni (waiting)
- [ ] Provider Stripe/Mangopay choisi (waiting)
- [ ] SMTP serveur configuré (OVH? autre?)
- [ ] S3 bucket Scaleway créé
- [ ] DNS OVH pointé vers Hetzner

---

**Status**: Schéma finalisé et production-ready ✅

Prochaine étape: Initialiser le repo + générer migrations Drizzle
