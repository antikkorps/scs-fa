// apps/api/src/db/seeds.ts
// Données de base à insérer au démarrage

import { calculateArtworkPrice } from "@armurier/shared"
import { eq } from "drizzle-orm"
import { db } from "./client.js"
import { artworkPrints, artworks, legalCategories, productCategories, products } from "./schema.js"

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

  await seedGunArt()

  console.log("🌱 Seeding complete!")
}

// ==========================================================================
// GUN ART — œuvres en tirage limité (≤25) pour la page collection
// ==========================================================================

// Image placeholders: Lorem Picsum (real photos, deterministic per slug) so the
// collection is visual out of the box. Replace `featuredImageUrl` from the admin
// backend with the real artwork photography when available.
const picsum = (seed: string) => `https://picsum.photos/seed/${seed}/1200/1500`

// A4 print format (priceFactor 1.0) used to price every seeded numbered print;
// rarity drives the increment (print 1 dearest, print N = base).
const A4_FORMAT = { id: "A4", name: "A4 (21 × 29,7 cm)", widthCm: 21, heightCm: 29.7, priceFactor: 1.0 }
const A3_FORMAT = { id: "A3", name: "A3 (29,7 × 42 cm)", widthCm: 29.7, heightCm: 42, priceFactor: 1.5 }
const A2_FORMAT = { id: "A2", name: "A2 (42 × 59,4 cm)", widthCm: 42, heightCm: 59.4, priceFactor: 2.0 }
const FORMATS = [A4_FORMAT, A3_FORMAT, A2_FORMAT]

const GUN_ART_PIECES = [
  {
    slug: "eclat-de-bronze",
    title: "Éclat de Bronze",
    artistName: "Camille Vasseur",
    description: "Un Luger P08 saisi dans une lumière dorée, hommage à l'âge d'or de l'armurerie de précision.",
    longDescription:
      "Tirage pigmentaire sur papier coton 310 g, signé et numéroté à la main. Chaque exemplaire est accompagné de son certificat d'authenticité.",
    editionLimit: 25,
    basePriceHt: 180,
    priceIncrementHt: 12,
    editionYear: 2025,
    featured: true,
    soldCount: 4,
  },
  {
    slug: "acier-nocturne",
    title: "Acier Nocturne",
    artistName: "Jonas Lindqvist",
    description: "Étude monochrome d'un revolver de collection, entre ombre et reflet métallique.",
    longDescription:
      "Impression fine art sur papier baryté, encadrement caisse américaine en option. Tirage strictement limité à 25 pièces.",
    editionLimit: 25,
    basePriceHt: 240,
    priceIncrementHt: 16,
    editionYear: 2025,
    featured: true,
    soldCount: 9,
  },
  {
    slug: "memoire-de-poudre",
    title: "Mémoire de Poudre",
    artistName: "Camille Vasseur",
    description: "Nature morte contemporaine : douilles, cuir et laiton patiné sur fond charbon.",
    longDescription: "Tirage pigmentaire signé, numéroté, livré avec certificat. Papier coton mat 310 g.",
    editionLimit: 20,
    basePriceHt: 160,
    priceIncrementHt: 10,
    editionYear: 2024,
    featured: false,
    soldCount: 6,
  },
  {
    slug: "ligne-de-mire",
    title: "Ligne de Mire",
    artistName: "Théo Marchand",
    description: "Macro graphique d'une optique de tir, géométrie pure et profondeur de champ travaillée.",
    longDescription: "Impression giclée haute densité, signée et numérotée. Édition limitée à 25 exemplaires.",
    editionLimit: 25,
    basePriceHt: 200,
    priceIncrementHt: 14,
    editionYear: 2025,
    featured: false,
    soldCount: 2,
  },
  {
    slug: "patine-historique",
    title: "Patine Historique",
    artistName: "Jonas Lindqvist",
    description: "Portrait d'une arme ancienne, bois noble et gravures, dans une lumière de musée.",
    longDescription: "Tirage fine art sur baryté, certificat d'authenticité inclus. Pièce de collection.",
    editionLimit: 15,
    basePriceHt: 320,
    priceIncrementHt: 20,
    editionYear: 2024,
    featured: true,
    soldCount: 11,
  },
  {
    slug: "silence-calibre",
    title: "Silence Calibre .45",
    artistName: "Théo Marchand",
    description: "Composition minimaliste, un pistolet posé comme un objet de design intemporel.",
    longDescription: "Impression pigmentaire signée et numérotée, papier coton 310 g. Édition de 25 pièces.",
    editionLimit: 25,
    basePriceHt: 190,
    priceIncrementHt: 12,
    editionYear: 2025,
    featured: false,
    soldCount: 0,
  },
] as const

async function seedGunArt() {
  const [gunArtCat] = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(eq(productCategories.slug, "gun-art"))
    .limit(1)
  const [legalNone] = await db
    .select({ id: legalCategories.id })
    .from(legalCategories)
    .where(eq(legalCategories.category, "none"))
    .limit(1)
  if (!gunArtCat || !legalNone) {
    console.warn("⚠️  Gun Art seed skipped: missing gun-art category or 'none' legal category")
    return
  }

  for (const piece of GUN_ART_PIECES) {
    // Idempotent: skip if this artwork already exists
    const [existing] = await db.select({ id: artworks.id }).from(artworks).where(eq(artworks.slug, piece.slug)).limit(1)
    if (existing) continue

    const [product] = await db
      .insert(products)
      .values({
        sku: `ART-${piece.slug}`,
        slug: `art-${piece.slug}`,
        name: piece.title,
        categoryId: gunArtCat.id,
        legalCategoryId: legalNone.id,
        priceHt: piece.basePriceHt.toFixed(2),
        requiresLegalVerification: false,
        published: true,
      })
      .returning({ id: products.id })

    const [artwork] = await db
      .insert(artworks)
      .values({
        productId: product.id,
        slug: piece.slug,
        sku: `ART-${piece.slug}`,
        title: piece.title,
        description: piece.description,
        longDescription: piece.longDescription,
        artistName: piece.artistName,
        editionLimit: piece.editionLimit,
        editionYear: piece.editionYear,
        availableFormats: FORMATS,
        basePriceHt: piece.basePriceHt.toFixed(2),
        priceIncrementHt: piece.priceIncrementHt.toFixed(2),
        vatPct: "20",
        featuredImageUrl: picsum(piece.slug),
        featured: piece.featured,
        published: true,
      })
      .returning({ id: artworks.id })

    // Numbered prints; the first `soldCount` are sold to look like a live edition.
    const printValues = Array.from({ length: piece.editionLimit }, (_, i) => {
      const printNumber = i + 1
      const priceHt = calculateArtworkPrice(
        piece.basePriceHt,
        piece.priceIncrementHt,
        piece.editionLimit,
        printNumber,
        A4_FORMAT,
      )
      return {
        artworkId: artwork.id,
        printNumber,
        totalPrints: piece.editionLimit,
        printDesignation: `${printNumber}/${piece.editionLimit}`,
        formatId: A4_FORMAT.id,
        priceHtUnit: priceHt.toFixed(2),
        status: (printNumber <= piece.soldCount ? "sold" : "available") as "sold" | "available",
      }
    })
    await db.insert(artworkPrints).values(printValues)
  }

  console.log(`✅ Gun Art seeded (${GUN_ART_PIECES.length} artworks)`)
}
