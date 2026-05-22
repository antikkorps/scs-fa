// apps/api/src/db/seeds.ts
// Données de base à insérer au démarrage

import { db } from "./client.js"
import { legalCategories, productCategories } from "./schema.js"

export async function seedDatabase() {
  console.log("🌱 Seeding database...")

  // ========================================================================
  // CATÉGORIES LÉGALES FRANÇAISES (Classification préfectorale)
  // ========================================================================

  const legalCatsData = [
    {
      category: "A" as const,
      name: "Catégorie A (Interdites)",
      description: "Armes interdites à la possession civile (mitrailleuses, etc.)",
      requiresVerification: true,
      minAge: 18,
      requiredDocTypes: ["cni"], // Juste pour info, pas réellement vendable
    },
    {
      category: "B" as const,
      name: "Catégorie B (Soumises à autorisation)",
      description: "Armes soumises à autorisation préfectorale individuelle",
      requiresVerification: true,
      minAge: 18,
      requiredDocTypes: ["cni", "autorisation_det", "sia"], // CNI + Auth préfectorale + SIA
    },
    {
      category: "C" as const,
      name: "Catégorie C (Soumises à déclaration)",
      description: "Armes soumises à déclaration (fusils de chasse, carabines)",
      requiresVerification: true,
      minAge: 18,
      requiredDocTypes: ["cni", "permis_chasse", "sia"], // CNI + Permis de chasser + SIA
    },
    {
      category: "D" as const,
      name: "Catégorie D (Libres sans autorisation)",
      description:
        "Armes libres de port/détention (sprays défense, bâtons télescopiques, etc.)",
      requiresVerification: true,
      minAge: 18,
      requiredDocTypes: ["cni"], // Juste CNI pour vérifier 18+
    },
    {
      category: "none" as const,
      name: "Non réglementée",
      description: "Accessoires, munitions sans restriction légale, Gun Art, etc.",
      requiresVerification: false,
      minAge: 0,
      requiredDocTypes: [],
    },
  ]

  for (const cat of legalCatsData) {
    await db
      .insert(legalCategories)
      .values({
        category: cat.category,
        name: cat.name,
        description: cat.description,
        requiresVerification: cat.requiresVerification,
        minAge: cat.minAge,
        requiredDocTypes: cat.requiredDocTypes,
      })
      .onConflictDoNothing()
  }

  console.log("✅ Legal categories seeded")

  // ========================================================================
  // CATÉGORIES PRODUITS
  // ========================================================================

  const productCatsData = [
    // Armurerie
    {
      slug: "arme-ancienne",
      name: "Armes anciennes & historiques",
      category: "arme_ancienne" as const,
      displayOrder: 1,
      description: "Collection et armes historiques (avant 1900)",
    },
    {
      slug: "occasion",
      name: "Armes d'occasion",
      category: "occasion" as const,
      displayOrder: 2,
      description: "Armes d'occasion testées et certifiées",
    },
    {
      slug: "arme-longue",
      name: "Armes longues",
      category: "arme_longue" as const,
      displayOrder: 3,
      description: "Fusils, carabines, fusils de chasse",
    },
    {
      slug: "arme-poing",
      name: "Armes de poing",
      category: "arme_poing" as const,
      displayOrder: 4,
      description: "Pistolets et revolvers",
    },
    {
      slug: "arme-defense",
      name: "Armes de défense",
      category: "arme_defense" as const,
      displayOrder: 5,
      description: "Sprays, bâtons télescopiques, etc.",
    },
    {
      slug: "munition",
      name: "Munitions",
      category: "munition" as const,
      displayOrder: 6,
      description: "Munitions pour armes de poing et de chasse",
    },
    {
      slug: "accessoire-tireur",
      name: "Accessoires du tireur",
      category: "accessoire_tireur" as const,
      displayOrder: 7,
      description: "Gants, tapis, produits de nettoyage, drapeaux, valises",
    },
    {
      slug: "aide-visee",
      name: "Aides à la visée",
      category: "aide_visee" as const,
      displayOrder: 8,
      description: "Lunettes de chasse, lunettes de tir, points rouges, etc.",
    },
    {
      slug: "accessoire-autre",
      name: "Autres accessoires",
      category: "accessoire_autre" as const,
      displayOrder: 9,
      description: "Accessoires divers et inclassables",
    },
    // Gun Art
    {
      slug: "gun-art",
      name: "Gun Art",
      category: "gun_art" as const,
      displayOrder: 10,
      description: "Tableaux, photos et tirages d'art",
    },
  ]

  for (const cat of productCatsData) {
    await db
      .insert(productCategories)
      .values({
        slug: cat.slug,
        name: cat.name,
        category: cat.category,
        displayOrder: cat.displayOrder,
        description: cat.description,
      })
      .onConflictDoNothing()
  }

  console.log("✅ Product categories seeded")
  console.log("🌱 Seeding complete!")
}

// ========================================================================
// WORKFLOWS & FORMULES
// ========================================================================

/**
 * WORKFLOW COMMANDE - PAIEMENT SPLITTÉ
 *
 * 1. Client ajoute au panier:
 *    - Arme neuve (cat B, C) → virement obligatoire
 *    - Accessoire (cat D) → CB possible
 *    - Gun Art → CB possible
 *
 * 2. À la création de la commande:
 *    - Vérifier si commande contient DES ARMES (cat A, B, C, D avec verification=true)
 *    - Si OUI → legalVerificationStatus = 'pending' (attente upload docs)
 *    - Si NON (accessoires + gun art) → passer directement à paiement
 *
 * 3. Workflow légal (si requis):
 *    a) pending → client upload docs (CNI, Permis, SIA, Auth préf selon cat)
 *    b) docs_verifying → admin Stéphane valide (SLA 48h)
 *    c) docs_verified → client peut payer
 *    d) docs_rejected → client peut réuploader immédiatement
 *
 * 4. Paiement (split automatique):
 *    Si commande mixte:
 *    a) Calculer montant virement (armes) vs montant CB (accessoires + gun art)
 *    b) Si montant CB > 0:
 *       - Créer paymentCarte entry
 *       - Rediriger vers Stripe
 *       - Une fois confirmé → paymentStatus = 'received'
 *    c) Si montant virement > 0:
 *       - Créer paymentVirement entry
 *       - Afficher IBAN + montant attendu
 *       - Client vire et signale
 *       - Admin rapproche et confirme
 *       - Une fois confirmé → paymentStatus = 'reconciled'
 *
 * 5. Après paiement complet:
 *    - Créer facture Henrri (invoice)
 *    - Envoyer confirmation client avec tracking
 *    - Passer à expédition
 */

export enum OrderPaymentSplit {
  VIREMENT_ONLY = "virement_only", // Seulement armes, pas CB
  CARTE_ONLY = "carte_only", // Accessoires + Gun Art, pas armes
  MIXED = "mixed", // Armes + accessoires/Gun Art
}

export function calculateOrderPaymentSplit(
  items: Array<{
    category: string
    requiresPaymentVirement: boolean
    priceHt: number
    vatPct: number
  }>,
) {
  let virementAmountHt = 0
  let carteAmountHt = 0
  let virementVat = 0
  let carteVat = 0

  for (const item of items) {
    const itemVat = item.priceHt * (item.vatPct / 100)

    if (item.requiresPaymentVirement) {
      virementAmountHt += item.priceHt
      virementVat += itemVat
    } else {
      carteAmountHt += item.priceHt
      carteVat += itemVat
    }
  }

  let splitType: OrderPaymentSplit
  if (virementAmountHt > 0 && carteAmountHt === 0) {
    splitType = OrderPaymentSplit.VIREMENT_ONLY
  } else if (virementAmountHt === 0 && carteAmountHt > 0) {
    splitType = OrderPaymentSplit.CARTE_ONLY
  } else {
    splitType = OrderPaymentSplit.MIXED
  }

  return {
    splitType,
    virement: {
      amountHt: virementAmountHt,
      vat: virementVat,
      amountTtc: virementAmountHt + virementVat,
    },
    carte: {
      amountHt: carteAmountHt,
      vat: carteVat,
      amountTtc: carteAmountHt + carteVat,
    },
  }
}

// ========================================================================
// PRICING GUN ART
// ========================================================================

/**
 * Formule de pricing dynamique pour Gun Art:
 *
 * basePriceHt = 50€ (prix du 1er tirage petit format)
 * priceIncrementHt = 2€ (augmentation par tirage)
 * formatPriceFactor = 1.0 (petit), 1.5 (moyen), 2.0 (grand)
 * editionLimit = 25 (tirage limité)
 *
 * Pour un tirage N (ex: 5/25) en format moyen:
 * price = basePriceHt * formatPriceFactor + (priceIncrementHt * (editionLimit - N))
 * price = 50 * 1.5 + (2 * (25 - 5))
 * price = 75 + 40
 * price = 115€ HT
 *
 * Le DERNIER tirage (25/25) en grand format:
 * price = 50 * 2.0 + (2 * (25 - 25))
 * price = 100 + 0
 * price = 100€ HT
 *
 * Le PREMIER tirage (1/25) en grand format:
 * price = 50 * 2.0 + (2 * (25 - 1))
 * price = 100 + 48
 * price = 148€ HT
 */

export interface ArtworkFormat {
  id: string
  name: string
  widthCm: number
  heightCm: number
  priceFactor: number // 1.0, 1.5, 2.0, etc.
}

export function calculateArtworkPrice(
  basePriceHt: number,
  priceIncrementHt: number,
  editionLimit: number,
  printNumber: number,
  format: ArtworkFormat,
): number {
  const formatAdjusted = basePriceHt * format.priceFactor
  const rarityBonus = priceIncrementHt * (editionLimit - printNumber)
  return formatAdjusted + rarityBonus
}

// ========================================================================
// RÉDUCTIONS VIP
// ========================================================================

/**
 * Règles de réduction VIP:
 *
 * - Client doit avoir acheté AU MOINS 1 arme neuve (cat B, C, D)
 * - Une fois activé → VIP ILLIMITÉ (pas d'expiration)
 * - Réduction appliquée sur:
 *   ✅ Armes (toutes catégories)
 *   ✅ Accessoires
 *   ✅ Gun Art
 *   ❌ Munitions (EXCLUS de réduction)
 *   ❌ Promotions spécifiques (non cumulable)
 *
 * Montant réduction = Marge disponible * 50%
 * (C-à-d: si produit a 30% de marge, client VIP remise max 15%)
 */

export function calculateVipDiscount(
  productPriceHt: number,
  productMarginPct: number,
  vipStatus: string | null,
): { discountAmount: number; discountPct: number } {
  if (!vipStatus || productMarginPct <= 0) {
    return { discountAmount: 0, discountPct: 0 }
  }

  // Réduction = 50% de la marge disponible
  const maxDiscountPct = (productMarginPct * 0.5) / 100
  const discountAmount = productPriceHt * maxDiscountPct

  return {
    discountAmount,
    discountPct: maxDiscountPct * 100,
  }
}

// ========================================================================
// DOCUMENTS REQUIS PAR CATÉGORIE LÉGALE
// ========================================================================

export const LEGAL_CATEGORY_REQUIREMENTS: Record<
  string,
  {
    name: string
    requiredDocs: string[]
    minAge: number
    description: string
    paymentMethods: string[] // ['virement', 'carte']
  }
> = {
  A: {
    name: "Catégorie A",
    requiredDocs: ["cni"], // Interdite, juste pour info
    minAge: 21,
    description: "Armes interdites (non vendables)",
    paymentMethods: [],
  },
  B: {
    name: "Catégorie B",
    requiredDocs: ["cni", "autorisation_det", "sia"],
    minAge: 18,
    description: "Autorisation préfectorale obligatoire",
    paymentMethods: ["virement"],
  },
  C: {
    name: "Catégorie C",
    requiredDocs: ["cni", "permis_chasse", "sia"],
    minAge: 18,
    description: "Permis de chasser obligatoire",
    paymentMethods: ["virement"],
  },
  D: {
    name: "Catégorie D",
    requiredDocs: ["cni"],
    minAge: 18,
    description: "Armes de défense (spray, bâton, etc.)",
    paymentMethods: ["virement", "carte"],
  },
  none: {
    name: "Non réglementée",
    requiredDocs: [],
    minAge: 0,
    description: "Accessoires, Gun Art, etc.",
    paymentMethods: ["virement", "carte"],
  },
}

// ========================================================================
// SLA VALIDATION DOCUMENTS
// ========================================================================

/**
 * SLA: 48 heures pour première réponse (Stéphane Chonez)
 *
 * À la création d'une commande avec arme:
 * - verification_deadline = NOW() + 48h
 *
 * Admin workflow:
 * 1. Notification "Docs en attente" apparaît
 * 2. Admin examine CNI, Permis, SIA, Auth préf
 * 3. Approval → status = 'docs_verified'
 * 4. Rejection → status = 'docs_rejected' + raison
 *    → Client reçoit email avec motif
 *    → Peut réuploader immédiatement
 * 5. Si deadline passée → alerte rouge "SLA dépassé"
 */

export function getVerificationDeadline(): Date {
  const deadline = new Date()
  deadline.setHours(deadline.getHours() + 48)
  return deadline
}

// ========================================================================
// REJET MOTIFS (standardisés)
// ========================================================================

export const REJECTION_REASONS = [
  "Document expiré",
  "Document non lisible/illisible",
  "Âge insuffisant",
  "Adresse non conforme",
  "Document refusé (faux)",
  "Permis suspendu/révoqué",
  "Autre (voir notes)",
] as const
