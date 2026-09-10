// apps/api/src/db/seeds.ts
// Données de base à insérer au démarrage

import { calculateArtworkPrice, CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq, sql } from "drizzle-orm"
import { db } from "./client.js"
import {
  ancientWeapons,
  artists,
  artworkPrints,
  artworks,
  artworkSeries,
  artworkThemes,
  blogPosts,
  legalCategories,
  productCategories,
  products,
  productTags,
  productVariants,
  tags,
  users,
} from "./schema.js"

export async function seedDatabase() {
  console.log("🌱 Seeding database...")

  await seedAdminUser()

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
    // « Arme ancienne » et « occasion » ne sont plus des catégories : ce sont
    // des états, qui se cumulent avec la nature de l'arme (une arme historique
    // est nécessairement d'occasion). Ils vivent désormais dans les tags —
    // voir seedTags() plus bas (story 11.1).
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

  await seedTags()
  await seedGunArt()
  await seedArmurerie()
  await seedBlog()

  console.log("🌱 Seeding complete!")
}

// ==========================================================================
// TAGS TRANSVERSES (story 11.1)
// ==========================================================================
// Données de référence : les tags qui portent l'état et l'époque d'une arme,
// que la catégorie (sa nature) ne peut pas exprimer puisqu'elle est unique.
// Idempotent sur le slug — un renommage fait en backoffice n'est pas écrasé.

async function seedTags() {
  const tagsData = [
    {
      slug: "occasion",
      name: "Occasion",
      facet: "etat" as const,
      displayOrder: 1,
      description: "Arme d'occasion, testée et certifiée par l'armurier",
    },
    {
      slug: "arme-ancienne",
      name: "Arme ancienne (avant 1900)",
      facet: "epoque" as const,
      displayOrder: 1,
      description: "Pièce de collection antérieure à 1900",
    },
    {
      slug: "arme-historique",
      name: "Arme historique de guerre",
      facet: "epoque" as const,
      displayOrder: 2,
      description: "Arme de guerre à valeur historique, pièce unique",
    },
  ]

  for (const tag of tagsData) {
    await db.insert(tags).values(tag).onConflictDoNothing()
  }

  console.log(`✅ Tags seeded (${tagsData.length})`)
}

// ==========================================================================
// GUN ART — œuvres en tirage limité (≤25) pour la page collection
// ==========================================================================

// Seeded artworks ship without a demo photo (`featuredImageUrl: null`): the
// storefront renders its own deterministic on-brand placeholder, and real
// photography is uploaded later from the admin backend.

// A4 print format (priceFactor 1.0) used to price every seeded numbered print;
// rarity drives the increment (print 1 dearest, print N = base).
const A4_FORMAT = { id: "A4", name: "A4 (21 × 29,7 cm)", widthCm: 21, heightCm: 29.7, priceFactor: 1.0 }
const A3_FORMAT = { id: "A3", name: "A3 (29,7 × 42 cm)", widthCm: 29.7, heightCm: 42, priceFactor: 1.5 }
const A2_FORMAT = { id: "A2", name: "A2 (42 × 59,4 cm)", widthCm: 42, heightCm: 59.4, priceFactor: 2.0 }
const FORMATS = [A4_FORMAT, A3_FORMAT, A2_FORMAT]

// --- Éditorial Gun Art (story 11.6) -----------------------------------------
// L'artiste, le thème et la série sont désormais des entités à part entière :
// la collection se lit par séries, pas seulement pièce par pièce.

const ARTISTS = [
  {
    slug: "camille-vasseur",
    name: "Camille Vasseur",
    headline: "Photographe de l'objet, lumière d'atelier",
    bio: "Camille Vasseur photographie les armes comme on photographie une sculpture : à la lumière rasante, sur fond sourd, pour que la matière parle avant l'objet.",
    journey: "Formée à la photographie de nature morte publicitaire, elle bascule vers l'objet de collection en 2016 et travaille depuis à la chambre, en séries fermées.",
    bookTitle: "Matières armées",
    bookUrl: "https://www.amazon.fr/dp/2010000001",
    published: true,
  },
  {
    slug: "jonas-lindqvist",
    name: "Jonas Lindqvist",
    headline: "Monochrome, patine et silence",
    bio: "Jonas Lindqvist travaille exclusivement en noir et blanc. Ses tirages barytés cherchent la trace du temps sur le métal plutôt que son éclat.",
    journey: "Venu du reportage, il abandonne la couleur en 2012 et consacre son travail aux pièces historiques conservées en collections privées.",
    published: true,
  },
  {
    slug: "theo-marchand",
    name: "Théo Marchand",
    headline: "Géométrie, macro, design",
    bio: "Théo Marchand isole la ligne. Optiques, culasses, arêtes : ses cadrages serrés font de l'arme un objet de design avant tout.",
    journey: "Designer produit de formation, il photographie depuis 2019 les mécanismes qu'il dessinait auparavant.",
    published: true,
  },
] as const

const ARTWORK_THEMES = [
  {
    slug: "cinema",
    name: "Cinéma",
    description: "Les armes telles que le cinéma les a fixées dans la mémoire collective.",
    displayOrder: 1,
  },
  {
    slug: "histoire",
    name: "Histoire",
    description: "Pièces datées, patines réelles : la dimension historique assumée, en noir et blanc.",
    displayOrder: 2,
  },
  {
    slug: "design",
    name: "Design",
    description: "L'arme regardée comme un objet dessiné : ligne, matière, géométrie.",
    displayOrder: 3,
  },
] as const

const ARTWORK_SERIES = [
  {
    slug: "age-d-or",
    title: "Âge d'or",
    intro:
      "Une série sur l'armurerie de précision européenne d'avant-guerre, éclairée comme un plateau de tournage. Chaque pièce y est traitée en lumière chaude, à rebours du noir et blanc documentaire.",
    reference: "Le cinéma d'espionnage des années 1960",
    themeSlug: "cinema",
    artistSlug: "camille-vasseur",
    displayOrder: 1,
  },
  {
    slug: "patines",
    title: "Patines",
    intro:
      "Série complète en noir et blanc, consacrée aux pièces qui ont vécu. Le sujet n'est pas l'arme mais le temps déposé dessus — usure du bois, gravure émoussée, métal terni.",
    reference: "Les collections d'armes anciennes conservées en mains privées",
    themeSlug: "histoire",
    artistSlug: "jonas-lindqvist",
    displayOrder: 2,
  },
  {
    slug: "lignes",
    title: "Lignes",
    intro:
      "Macro et géométrie. La série cherche le point où le mécanisme devient forme pure et où l'on cesse de reconnaître l'objet.",
    reference: "Le design industriel du XXᵉ siècle",
    themeSlug: "design",
    artistSlug: "theo-marchand",
    displayOrder: 3,
  },
] as const

const GUN_ART_PIECES = [
  {
    slug: "eclat-de-bronze",
    title: "Éclat de Bronze",
    artistSlug: "camille-vasseur",
    seriesSlug: "age-d-or",
    seriesOrder: 1,
    description: "Un Luger P08 saisi dans une lumière dorée, hommage à l'âge d'or de l'armurerie de précision.",
    longDescription:
      "Tirage pigmentaire sur papier coton 310 g, signé et numéroté à la main. Chaque exemplaire est accompagné de son certificat d'authenticité.",
    editionLimit: 25,
    basePriceHt: 180,
    priceIncrementHt: 12,
    editionYear: 2025,
    featured: true,
    orientation: "landscape",
    soldCount: 4,
  },
  {
    slug: "acier-nocturne",
    title: "Acier Nocturne",
    artistSlug: "jonas-lindqvist",
    seriesSlug: "patines",
    seriesOrder: 1,
    description: "Étude monochrome d'un revolver de collection, entre ombre et reflet métallique.",
    longDescription:
      "Impression fine art sur papier baryté, encadrement caisse américaine en option. Tirage strictement limité à 25 pièces.",
    editionLimit: 25,
    basePriceHt: 240,
    priceIncrementHt: 16,
    editionYear: 2025,
    featured: true,
    orientation: "portrait",
    soldCount: 9,
  },
  {
    slug: "memoire-de-poudre",
    title: "Mémoire de Poudre",
    artistSlug: "camille-vasseur",
    seriesSlug: "age-d-or",
    seriesOrder: 2,
    description: "Nature morte contemporaine : douilles, cuir et laiton patiné sur fond charbon.",
    longDescription: "Tirage pigmentaire signé, numéroté, livré avec certificat. Papier coton mat 310 g.",
    editionLimit: 20,
    basePriceHt: 160,
    priceIncrementHt: 10,
    editionYear: 2024,
    featured: false,
    orientation: "landscape",
    soldCount: 6,
  },
  {
    slug: "ligne-de-mire",
    title: "Ligne de Mire",
    artistSlug: "theo-marchand",
    seriesSlug: "lignes",
    seriesOrder: 1,
    description: "Macro graphique d'une optique de tir, géométrie pure et profondeur de champ travaillée.",
    longDescription: "Impression giclée haute densité, signée et numérotée. Édition limitée à 25 exemplaires.",
    editionLimit: 25,
    basePriceHt: 200,
    priceIncrementHt: 14,
    editionYear: 2025,
    featured: false,
    orientation: "square",
    soldCount: 2,
  },
  {
    slug: "patine-historique",
    title: "Patine Historique",
    artistSlug: "jonas-lindqvist",
    seriesSlug: "patines",
    seriesOrder: 2,
    description: "Portrait d'une arme ancienne, bois noble et gravures, dans une lumière de musée.",
    longDescription: "Tirage fine art sur baryté, certificat d'authenticité inclus. Pièce de collection.",
    editionLimit: 15,
    basePriceHt: 320,
    priceIncrementHt: 20,
    editionYear: 2024,
    featured: true,
    orientation: "portrait",
    soldCount: 11,
  },
  {
    slug: "silence-calibre",
    title: "Silence Calibre .45",
    artistSlug: "theo-marchand",
    seriesSlug: "lignes",
    seriesOrder: 2,
    description: "Composition minimaliste, un pistolet posé comme un objet de design intemporel.",
    longDescription: "Impression pigmentaire signée et numérotée, papier coton 310 g. Édition de 25 pièces.",
    editionLimit: 25,
    basePriceHt: 190,
    priceIncrementHt: 12,
    editionYear: 2025,
    featured: false,
    orientation: "landscape",
    soldCount: 0,
  },
] as const

// Idempotent admin account so the backoffice is usable right after a seed.
// Credentials come from env (ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD) with dev
// defaults — override them in any shared/staging environment.
async function seedAdminUser() {
  const email = process.env.ADMIN_SEED_EMAIL ?? "admin@scs-firearm.local"
  const password = process.env.ADMIN_SEED_PASSWORD ?? "AdminSCS-ChangeMe-2026!"

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (existing) {
    console.log(`✅ Admin user already present (${email})`)
    return
  }

  const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
  await db.insert(users).values({
    email,
    passwordHash,
    role: "admin",
    firstname: "Admin",
    lastname: "SCS",
    rgpdConsentAt: new Date(),
    rgpdConsentVersion: CURRENT_RGPD_CONSENT_VERSION,
  })
  console.log(`✅ Admin user seeded (${email})`)
}

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

  // Artistes, thèmes puis séries — dans cet ordre, une série référençant les deux.
  // Tout est idempotent : un seed rejoué ne duplique rien.
  //
  // ⚠️ L'artiste ne peut pas se contenter d'un `DO NOTHING` : la migration 0004
  // a promu les noms trouvés sur les œuvres en lignes d'`artists`, donc les
  // bases existantes portent déjà des artistes **sans bio, sans parcours et sans
  // livre**. Le seed comble donc les trous (`coalesce`) sans jamais écraser un
  // texte saisi depuis le backoffice.
  const artistIds = new Map<string, string>()
  for (const artist of ARTISTS) {
    const [row] = await db
      .insert(artists)
      .values(artist)
      .onConflictDoUpdate({
        target: artists.slug,
        set: {
          headline: sql`coalesce(${artists.headline}, excluded.headline)`,
          bio: sql`coalesce(${artists.bio}, excluded.bio)`,
          journey: sql`coalesce(${artists.journey}, excluded.journey)`,
          portraitUrl: sql`coalesce(${artists.portraitUrl}, excluded.portrait_url)`,
          bookTitle: sql`coalesce(${artists.bookTitle}, excluded.book_title)`,
          bookUrl: sql`coalesce(${artists.bookUrl}, excluded.book_url)`,
        },
      })
      .returning({ id: artists.id })
    const id = row?.id ?? (await db.select({ id: artists.id }).from(artists).where(eq(artists.slug, artist.slug)))[0]?.id
    if (id) artistIds.set(artist.slug, id)
  }

  const themeIds = new Map<string, string>()
  for (const theme of ARTWORK_THEMES) {
    const [row] = await db
      .insert(artworkThemes)
      .values(theme)
      .onConflictDoNothing({ target: artworkThemes.slug })
      .returning({ id: artworkThemes.id })
    const id =
      row?.id ??
      (await db.select({ id: artworkThemes.id }).from(artworkThemes).where(eq(artworkThemes.slug, theme.slug)))[0]?.id
    if (id) themeIds.set(theme.slug, id)
  }

  const seriesIds = new Map<string, string>()
  for (const series of ARTWORK_SERIES) {
    const [row] = await db
      .insert(artworkSeries)
      .values({
        slug: series.slug,
        title: series.title,
        intro: series.intro,
        reference: series.reference,
        themeId: themeIds.get(series.themeSlug) ?? null,
        artistId: artistIds.get(series.artistSlug) ?? null,
        displayOrder: series.displayOrder,
        published: true,
      })
      .onConflictDoNothing({ target: artworkSeries.slug })
      .returning({ id: artworkSeries.id })
    const id =
      row?.id ??
      (await db.select({ id: artworkSeries.id }).from(artworkSeries).where(eq(artworkSeries.slug, series.slug)))[0]?.id
    if (id) seriesIds.set(series.slug, id)
  }

  for (const piece of GUN_ART_PIECES) {
    const [existing] = await db.select({ id: artworks.id }).from(artworks).where(eq(artworks.slug, piece.slug)).limit(1)
    if (existing) {
      // The artwork predates story 11.6, so it carries no series. Attach it
      // where the attachment is still missing — without touching an artwork an
      // admin has since moved to another series.
      await db
        .update(artworks)
        .set({
          artistId: sql`coalesce(${artworks.artistId}, ${artistIds.get(piece.artistSlug) ?? null})`,
          seriesId: sql`coalesce(${artworks.seriesId}, ${seriesIds.get(piece.seriesSlug) ?? null})`,
          seriesOrder: sql`coalesce(nullif(${artworks.seriesOrder}, 0), ${piece.seriesOrder})`,
        })
        .where(eq(artworks.id, existing.id))
      continue
    }

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
        artistId: artistIds.get(piece.artistSlug) ?? null,
        seriesId: seriesIds.get(piece.seriesSlug) ?? null,
        seriesOrder: piece.seriesOrder,
        editionLimit: piece.editionLimit,
        editionYear: piece.editionYear,
        availableFormats: FORMATS,
        basePriceHt: piece.basePriceHt.toFixed(2),
        priceIncrementHt: piece.priceIncrementHt.toFixed(2),
        vatPct: "20",
        // No demo photo: the storefront renders its own on-brand placeholder
        // (see web artworkImage/fallbackImage). Real photography is uploaded
        // from the admin backend.
        featuredImageUrl: null,
        orientation: piece.orientation,
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

// ==========================================================================
// ARMURERIE — produits de démo pour le catalogue (Story 10.2)
// ==========================================================================

// Demo armurerie catalogue: a handful of products per category, spanning the
// legal categories B/C/D/none and varied stock (incl. a rupture) so the
// storefront filters, legal badges and stock states all have something to show.
// `featuredImageUrl: null` → the storefront renders its own SVG placeholder.
type SeedProduct = {
  sku: string
  slug: string
  name: string
  description: string
  categorySlug: string
  legal: "A" | "B" | "C" | "D" | "none"
  priceHt: number
  stockQty: number
  requiresLegalVerification: boolean
  ageMinRequired: number | null
  featured?: boolean
}

const ARMURERIE_PRODUCTS: SeedProduct[] = [
  {
    sku: "ARM-GLOCK17",
    slug: "pistolet-glock-17-gen5",
    name: "Pistolet GLOCK 17 Gen5 — 9mm",
    description: "Pistolet semi-automatique 9x19, chargeur 17 coups, détente Gen5. Référence du tir sportif.",
    categorySlug: "arme-poing",
    legal: "B",
    priceHt: 600,
    stockQty: 6,
    requiresLegalVerification: true,
    ageMinRequired: 18,
    featured: true,
  },
  {
    sku: "ARM-SW686",
    slug: "revolver-smith-wesson-686",
    name: "Revolver Smith & Wesson 686 — .357 Mag",
    description: "Revolver 6 coups canon 4 pouces, acier inoxydable. Polyvalent cible et défense.",
    categorySlug: "arme-poing",
    legal: "B",
    priceHt: 820,
    stockQty: 0,
    requiresLegalVerification: true,
    ageMinRequired: 18,
  },
  {
    sku: "ARM-VC-IMPACT",
    slug: "carabine-verney-carron-impact",
    name: "Carabine Verney-Carron Impact — .30-06",
    description: "Carabine à canon basculant, fabrication française, idéale battue et approche.",
    categorySlug: "arme-longue",
    legal: "C",
    priceHt: 1090,
    stockQty: 4,
    requiresLegalVerification: true,
    ageMinRequired: 18,
    featured: true,
  },
  {
    sku: "ARM-BERETTA686",
    slug: "fusil-beretta-686-silver-pigeon",
    name: "Fusil superposé Beretta 686 Silver Pigeon — cal. 12",
    description: "Superposé de chasse et ball-trap, bascule gravée, éjecteurs automatiques.",
    categorySlug: "arme-longue",
    legal: "C",
    priceHt: 1980,
    stockQty: 2,
    requiresLegalVerification: true,
    ageMinRequired: 18,
  },
  {
    sku: "ARM-RUGER1022",
    slug: "carabine-ruger-10-22",
    name: "Carabine Ruger 10/22 — .22 LR",
    description: "Carabine semi-automatique .22 Long Rifle, légère et fiable pour l'entraînement.",
    categorySlug: "arme-longue",
    legal: "C",
    priceHt: 360,
    stockQty: 9,
    requiresLegalVerification: true,
    ageMinRequired: 18,
  },
  {
    sku: "ARM-9MM-50",
    slug: "munitions-9mm-luger-x50",
    name: "Munitions 9x19 Luger FMJ — boîte de 50",
    description: "Cartouches 9mm Parabellum blindées 124 gr pour le tir sur cible.",
    categorySlug: "munition",
    legal: "B",
    priceHt: 21,
    stockQty: 140,
    requiresLegalVerification: true,
    ageMinRequired: 18,
  },
  {
    sku: "ARM-CAL12-25",
    slug: "cartouches-calibre-12-x25",
    name: "Cartouches calibre 12 — boîte de 25",
    description: "Cartouches de chasse plombs n°6, bourre grasse, pour fusil calibre 12.",
    categorySlug: "munition",
    legal: "C",
    priceHt: 10.5,
    stockQty: 200,
    requiresLegalVerification: true,
    ageMinRequired: 18,
  },
  {
    sku: "ARM-VORTEX-416",
    slug: "lunette-vortex-diamondback-4-16x44",
    name: "Lunette de tir Vortex Diamondback 4-16x44",
    description: "Optique grossissement variable, réticule éclairé, tubes étanches purgés azote.",
    categorySlug: "aide-visee",
    legal: "none",
    priceHt: 325,
    stockQty: 7,
    requiresLegalVerification: false,
    ageMinRequired: null,
  },
  {
    sku: "ARM-AIMPOINT-ACRO",
    slug: "point-rouge-aimpoint-acro-p2",
    name: "Point rouge Aimpoint Acro P-2",
    description: "Viseur point rouge fermé, autonomie 5 ans, conçu pour armes de poing et longues.",
    categorySlug: "aide-visee",
    legal: "none",
    priceHt: 540,
    stockQty: 3,
    requiresLegalVerification: false,
    ageMinRequired: null,
  },
  {
    sku: "ARM-CASQUE-ELEC",
    slug: "casque-anti-bruit-electronique",
    name: "Casque anti-bruit électronique",
    description: "Protection auditive active : amplifie les sons faibles, coupe les détonations.",
    categorySlug: "accessoire-tireur",
    legal: "none",
    priceHt: 75,
    stockQty: 25,
    requiresLegalVerification: false,
    ageMinRequired: null,
    featured: true,
  },
  {
    sku: "ARM-MALLETTE",
    slug: "mallette-de-transport-rigide",
    name: "Mallette de transport rigide",
    description: "Valise de transport mousse alvéolée, fermeture à clé, conforme au transport réglementé.",
    categorySlug: "accessoire-tireur",
    legal: "none",
    priceHt: 120,
    stockQty: 15,
    requiresLegalVerification: false,
    ageMinRequired: null,
  },
  {
    sku: "ARM-SPRAY-GAZ",
    slug: "spray-de-defense-gel-poivre",
    name: "Spray de défense gel poivre 50 ml",
    description: "Aérosol de défense au gel OC, portée 4 m, catégorie D soumise à conditions.",
    categorySlug: "arme-defense",
    legal: "D",
    priceHt: 16.5,
    stockQty: 40,
    requiresLegalVerification: true,
    ageMinRequired: 18,
  },
]

// Variants per product SKU. Products absent from this map get a single
// "Standard" finition variant (chk_variant_attrs requires at least one of
// finition/munition/couleur). Multi-variant products drive the detail selector.
type SeedVariant = {
  skuVariant: string
  finition?: string
  munition?: string
  couleur?: string
  stockQty: number
  priceDeltaHt: number
}

const VARIANTS_BY_SKU: Record<string, SeedVariant[]> = {
  "ARM-GLOCK17": [
    { skuVariant: "ARM-GLOCK17-NOIR", finition: "Noir", stockQty: 6, priceDeltaHt: 0 },
    { skuVariant: "ARM-GLOCK17-FDE", finition: "FDE (tan)", stockQty: 3, priceDeltaHt: 40 },
  ],
  "ARM-VC-IMPACT": [
    { skuVariant: "ARM-VC-IMPACT-3006", munition: ".30-06 Sprg", stockQty: 4, priceDeltaHt: 0 },
    { skuVariant: "ARM-VC-IMPACT-300WM", munition: ".300 Win Mag", stockQty: 2, priceDeltaHt: 120 },
  ],
  "ARM-CASQUE-ELEC": [
    { skuVariant: "ARM-CASQUE-NOIR", couleur: "Noir", stockQty: 15, priceDeltaHt: 0 },
    { skuVariant: "ARM-CASQUE-OD", couleur: "Vert OD", stockQty: 10, priceDeltaHt: 0 },
  ],
}

function variantsFor(p: SeedProduct): SeedVariant[] {
  return VARIANTS_BY_SKU[p.sku] ?? [{ skuVariant: `${p.sku}-STD`, finition: "Standard", stockQty: p.stockQty, priceDeltaHt: 0 }]
}

async function seedArmurerie() {
  const cats = await db.select({ id: productCategories.id, slug: productCategories.slug }).from(productCategories)
  const catBySlug = new Map(cats.map((c) => [c.slug, c.id]))

  const legals = await db.select({ id: legalCategories.id, category: legalCategories.category }).from(legalCategories)
  const legalByCode = new Map(legals.map((l) => [l.category, l.id]))

  let newProducts = 0
  let newVariants = 0
  for (const p of ARMURERIE_PRODUCTS) {
    const categoryId = catBySlug.get(p.categorySlug)
    const legalCategoryId = legalByCode.get(p.legal)
    if (!categoryId || !legalCategoryId) {
      console.warn(`⚠️  Armurerie seed: skipping ${p.sku} (missing category ${p.categorySlug} or legal ${p.legal})`)
      continue
    }

    const variants = variantsFor(p)
    const totalStock = variants.reduce((sum, v) => sum + v.stockQty, 0)

    // Get-or-create the product (idempotent on SKU).
    let product = (await db.select({ id: products.id }).from(products).where(eq(products.sku, p.sku)).limit(1))[0]
    if (!product) {
      product = (
        await db
          .insert(products)
          .values({
            sku: p.sku,
            slug: p.slug,
            name: p.name,
            description: p.description,
            categoryId,
            legalCategoryId,
            priceHt: p.priceHt.toFixed(2),
            stockQty: totalStock,
            requiresLegalVerification: p.requiresLegalVerification,
            ageMinRequired: p.ageMinRequired,
            featured: p.featured ?? false,
            // No demo photo: the storefront renders its own placeholder.
            featuredImageUrl: null,
            published: true,
          })
          .returning({ id: products.id })
      )[0]
      newProducts++
    } else {
      // Existing product (seeded in 10.2 without variants): sync its stock to the variant total.
      await db.update(products).set({ stockQty: totalStock }).where(eq(products.id, product.id))
    }
    if (!product) continue

    // Ensure each variant exists (idempotent on skuVariant).
    for (const v of variants) {
      const [existingV] = await db
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(eq(productVariants.skuVariant, v.skuVariant))
        .limit(1)
      if (existingV) continue
      await db.insert(productVariants).values({
        productId: product.id,
        skuVariant: v.skuVariant,
        finition: v.finition ?? null,
        munition: v.munition ?? null,
        couleur: v.couleur ?? null,
        stockQty: v.stockQty,
        priceDeltaHt: v.priceDeltaHt.toFixed(2),
      })
      newVariants++
    }
  }

  console.log(`✅ Armurerie seeded (${newProducts} new products, ${newVariants} new variants)`)

  await seedProductTags()
  await seedAncientWeapons()
}

// Pose quelques tags de démonstration pour que le filtre à facettes ait de quoi
// travailler. Idempotent : la PK composite du pivot rend le rejeu sans effet.
async function seedProductTags() {
  const assignments = [
    { productSlug: "revolver-smith-wesson-686", tagSlugs: ["occasion"] },
    { productSlug: "carabine-verney-carron-impact", tagSlugs: ["occasion"] },
  ]

  let linked = 0
  for (const { productSlug, tagSlugs } of assignments) {
    const [product] = await db.select({ id: products.id }).from(products).where(eq(products.slug, productSlug)).limit(1)
    if (!product) continue

    for (const tagSlug of tagSlugs) {
      const [tag] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, tagSlug)).limit(1)
      if (!tag) continue
      await db.insert(productTags).values({ productId: product.id, tagId: tag.id }).onConflictDoNothing()
      linked++
    }
  }

  console.log(`✅ Product tags seeded (${linked} links)`)
}

// ==========================================================================
// ARMES DE COLLECTION & HISTORIQUES (Story 11.2)
// ==========================================================================
// Chaque pièce est un exemplaire unique : un produit (stock 1), sa fiche
// historique dans `ancient_weapons`, une variante « Pièce unique » (le panier
// est clé sur variantId, donc sans variante la pièce serait inachetable) et ses
// tags d'état/époque. Idempotent sur le SKU.

const ANCIENT_WEAPONS = [
  {
    sku: "COL-LEFAUCHEUX-1854",
    slug: "revolver-lefaucheux-modele-1854",
    name: "Revolver Lefaucheux modèle 1854",
    categorySlug: "arme-poing",
    legalCategory: "D" as const,
    priceHt: 2400,
    tagSlugs: ["occasion", "arme-ancienne"],
    description: "Revolver à broche de Casimir Lefaucheux, poinçons de Liège, crosse en noyer d'origine.",
    longDescription:
      "<p>Le modèle 1854 de Casimir Lefaucheux est le premier revolver à cartouche métallique adopté par une marine militaire — celle de la France. Il marque le basculement de l'ère de la poudre noire chargée par la bouche vers celle de la munition autonome.</p>" +
      "<p>Cet exemplaire porte les poinçons liégeois d'épreuve et une numérotation cohérente sur la carcasse, le barillet et le canon, ce qui exclut un assemblage tardif de pièces dépareillées — le défaut le plus courant sur ce modèle.</p>" +
      "<p>La crosse en noyer a conservé son quadrillage d'origine, simplement adouci par l'usage. Le bronzage subsiste à environ soixante pour cent, avec la patine grise régulière que l'on attend d'une arme conservée sans être astiquée.</p>" +
      "<p>La mécanique est saine : l'armé est franc, l'indexation du barillet nette, sans jeu latéral perceptible en position de tir. Aucune pièce n'a été remplacée.</p>",
    period: "Second Empire",
    periodStartYear: 1854,
    periodEndYear: 1870,
    provenance: "Collection privée bourguignonne, acquise en vente publique à Dijon en 1987",
    makerName: "Casimir Lefaucheux",
    makerLocation: "Paris / Liège",
    condition: "bon",
    conditionDescription: "Bronzage à environ 60 %, patine homogène, mécanique saine, numérotation cohérente.",
    isAuthentic: true,
    expertName: "Cabinet Vernier — expert près la Cour d'appel",
    historicalInfo: {
      events: ["Adoption par la Marine française", "Guerre de 1870"],
      notes: "Modèle emblématique du passage à la cartouche métallique.",
    },
  },
  {
    sku: "COL-LUGER-P08-1917",
    slug: "luger-p08-daté-1917",
    name: "Luger P08 daté 1917",
    categorySlug: "arme-poing",
    legalCategory: "B" as const,
    priceHt: 3800,
    tagSlugs: ["occasion", "arme-historique"],
    description: "Pistolet Luger P08 de fabrication DWM, daté 1917, numérotation d'origine complète.",
    longDescription:
      "<p>Produit par la Deutsche Waffen- und Munitionsfabriken en 1917, ce P08 appartient à la période de production de guerre, la plus recherchée par les collectionneurs pour la qualité d'ajustage encore intacte à cette date.</p>" +
      "<p>La numérotation est complète et concordante : carcasse, culasse, canon, levier de démontage et plaquettes portent le même suffixe. C'est le critère qui sépare une pièce de collection d'un assemblage d'après-guerre, et il est ici pleinement satisfait.</p>" +
      "<p>Le système à genouillère fonctionne avec la douceur caractéristique des productions DWM. La hausse et le guidon sont d'origine, sans trace de remplacement ni de repositionnement.</p>" +
      "<p>L'arme est vendue avec son étui daté et le chargeur numéroté correspondant. En catégorie B, sa détention est soumise à autorisation préfectorale et à l'enregistrement au SIA.</p>",
    period: "Première Guerre mondiale",
    periodStartYear: 1917,
    periodEndYear: 1918,
    provenance: "Succession d'un officier français, rapportée du front en 1918",
    makerName: "Deutsche Waffen- und Munitionsfabriken (DWM)",
    makerLocation: "Berlin",
    condition: "excellent",
    conditionDescription: "Numérotation entièrement concordante, bronzage à plus de 90 %, mécanique irréprochable.",
    isAuthentic: true,
    expertName: "Cabinet Vernier — expert près la Cour d'appel",
    historicalInfo: {
      battles: ["Front de l'Ouest"],
      notes: "Étui et chargeur numérotés d'origine fournis avec la pièce.",
    },
  },
  {
    sku: "COL-GRAS-1874",
    slug: "fusil-gras-modele-1874",
    name: "Fusil Gras modèle 1874",
    categorySlug: "arme-longue",
    legalCategory: "C" as const,
    priceHt: 1150,
    tagSlugs: ["occasion", "arme-ancienne"],
    description: "Fusil Gras de la manufacture de Saint-Étienne, millésime lisible, bois sain.",
    longDescription:
      "<p>Le fusil Gras modèle 1874 est la première arme réglementaire française à cartouche métallique. Il équipe l'armée au lendemain de la défaite de 1870 et reste en service, sous diverses transformations, jusqu'à la Première Guerre mondiale.</p>" +
      "<p>Cet exemplaire sort de la Manufacture d'armes de Saint-Étienne. Le marquage de tonnerre est parfaitement lisible, millésime compris, ce qui est loin d'être acquis sur des armes ayant beaucoup servi.</p>" +
      "<p>Le bois est sain, sans fente ni réparation, et porte ses cachets d'inspection. La mécanique fonctionne normalement et l'âme du canon conserve des rayures franches.</p>",
    period: "Troisième République",
    periodStartYear: 1874,
    periodEndYear: 1890,
    provenance: "Collection régionale stéphanoise",
    makerName: "Manufacture d'armes de Saint-Étienne",
    makerLocation: "Saint-Étienne",
    condition: "bon",
    conditionDescription: "Marquages lisibles, bois sain sans réparation, rayures franches.",
    isAuthentic: true,
    historicalInfo: { notes: "Première arme réglementaire française à cartouche métallique." },
  },
  {
    // Accessoire historique : même modèle, même traitement (story 11.2).
    sku: "COL-ETUI-P08-1941",
    slug: "etui-de-luger-p08-date-1941",
    name: "Étui de Luger P08 daté 1941",
    categorySlug: "accessoire-autre",
    legalCategory: "none" as const,
    priceHt: 320,
    tagSlugs: ["occasion", "arme-historique"],
    description: "Étui en cuir noir pour Luger P08, marquages et date lisibles, cuir souple.",
    longDescription:
      "<p>Étui réglementaire en cuir noir pour pistolet P08, daté 1941 et portant ses marquages de fabricant au revers du rabat.</p>" +
      "<p>Le cuir est resté souple, les coutures sont saines et le compartiment à chargeur de rechange est intact. Une pièce d'accompagnement recherchée pour compléter un P08 de la même période.</p>",
    period: "Seconde Guerre mondiale",
    periodStartYear: 1941,
    periodEndYear: 1941,
    makerName: "Fabricant militaire allemand (marquage au revers)",
    condition: "bon",
    conditionDescription: "Cuir souple, coutures saines, marquages lisibles.",
    isAuthentic: true,
    historicalInfo: {},
  },
]

async function seedAncientWeapons() {
  let created = 0

  for (const w of ANCIENT_WEAPONS) {
    const [existing] = await db.select({ id: products.id }).from(products).where(eq(products.sku, w.sku)).limit(1)
    if (existing) continue

    const [category] = await db
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(eq(productCategories.slug, w.categorySlug))
      .limit(1)
    const [legal] = await db
      .select({ id: legalCategories.id })
      .from(legalCategories)
      .where(eq(legalCategories.category, w.legalCategory))
      .limit(1)
    if (!category || !legal) continue

    const [product] = await db
      .insert(products)
      .values({
        sku: w.sku,
        slug: w.slug,
        name: w.name,
        description: w.description,
        longDescription: w.longDescription,
        categoryId: category.id,
        legalCategoryId: legal.id,
        priceHt: w.priceHt.toFixed(2),
        stockQty: 1,
        requiresLegalVerification: w.legalCategory !== "none",
        featuredImageUrl: null,
        published: true,
      })
      .returning({ id: products.id })
    if (!product) continue

    await db.insert(ancientWeapons).values({
      productId: product.id,
      period: w.period,
      periodStartYear: w.periodStartYear,
      periodEndYear: w.periodEndYear,
      provenance: w.provenance,
      makerName: w.makerName,
      makerLocation: w.makerLocation,
      condition: w.condition,
      conditionDescription: w.conditionDescription,
      isAuthentic: w.isAuthentic,
      expertName: w.expertName,
      historicalInfo: w.historicalInfo,
      isUnique: true,
    })

    // Sans variante, la pièce ne peut pas entrer dans le panier (clé variantId).
    await db.insert(productVariants).values({
      productId: product.id,
      skuVariant: `${w.sku}-PU`,
      finition: "Pièce unique",
      stockQty: 1,
      priceDeltaHt: "0",
    })

    for (const slug of w.tagSlugs) {
      const [tag] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug)).limit(1)
      if (tag) {
        await db.insert(productTags).values({ productId: product.id, tagId: tag.id }).onConflictDoNothing()
      }
    }

    created++
  }

  console.log(`✅ Ancient weapons seeded (${created} new)`)
}

// ==========================================================================
// BLOG — section éditoriale SEO-first (Story 9.4)
// ==========================================================================

const BLOG_POSTS = [
  {
    slug: "histoire-du-luger-p08",
    title: "Le Luger P08, une icône d'ingénierie",
    excerpt:
      "Retour sur l'arme de poing qui a marqué le XXe siècle, devenue objet de collection et sujet photographique de prédilection.",
    category: "Histoire",
    tags: "luger, collection, histoire",
    orientation: "landscape" as const,
    content:
      "<p>Conçu par Georg Luger au tournant du XXe siècle, le P08 reste l'une des armes de poing les plus reconnaissables jamais produites.</p>" +
      "<h2>Une silhouette inimitable</h2>" +
      "<p>Son système à genouillère, son équilibre et sa ligne tendue en ont fait un objet de fascination bien au-delà de son usage d'origine.</p>" +
      "<h2>Objet de collection</h2>" +
      "<p>Aujourd'hui, le P08 se contemple autant qu'il se collectionne. C'est cette tension entre mémoire et esthétique que nos tirages explorent.</p>",
    featured: true,
  },
  {
    slug: "photographier-l-acier",
    title: "Photographier l'acier : lumière et matière",
    excerpt: "Comment nos artistes révèlent la patine, les reflets et la géométrie des armes de collection.",
    category: "Atelier",
    tags: "photographie, atelier, lumière",
    orientation: "portrait" as const,
    content:
      "<p>Photographier le métal, c'est d'abord apprivoiser la lumière.</p>" +
      "<h2>La patine comme récit</h2>" +
      "<p>Chaque éraflure raconte une histoire ; le travail du photographe consiste à la rendre lisible sans la trahir.</p>" +
      "<blockquote>Le reflet n'est pas un défaut : c'est le sujet.</blockquote>" +
      "<p>De ce dialogue entre ombre et acier naissent les tirages de la collection Gun Art.</p>",
    featured: false,
  },
  {
    slug: "edition-limitee-pourquoi",
    title: "Pourquoi l'édition strictement limitée ?",
    excerpt: "Signature, numérotation, certificat : ce qui fait la valeur d'un tirage d'art à tirage restreint.",
    category: "Collection",
    tags: "édition limitée, certificat, valeur",
    orientation: "landscape" as const,
    content:
      "<p>Une édition limitée n'est pas qu'un argument commercial : c'est un engagement.</p>" +
      "<h2>Rareté et confiance</h2>" +
      "<p>Chaque tirage est signé, numéroté et accompagné de son certificat d'authenticité — une traçabilité qui protège le collectionneur.</p>" +
      "<p>La rareté, ici, est au service de l'œuvre et de celles et ceux qui la font vivre.</p>",
    featured: false,
  },
] as const

async function seedBlog() {
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1)
  const now = Date.now()

  for (let i = 0; i < BLOG_POSTS.length; i++) {
    const post = BLOG_POSTS[i]
    const [existing] = await db.select({ id: blogPosts.id }).from(blogPosts).where(eq(blogPosts.slug, post.slug)).limit(1)
    if (existing) continue

    // Stagger publication dates so the index reads as a real timeline.
    const publishedAt = new Date(now - i * 7 * 24 * 60 * 60 * 1000)
    await db.insert(blogPosts).values({
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      content: post.content,
      category: post.category,
      tags: post.tags,
      // Same as artworks: let the storefront render its own placeholder.
      featuredImageUrl: null,
      metaDescription: post.excerpt,
      authorId: admin?.id ?? null,
      published: true,
      featured: post.featured,
      publishedAt,
    })
  }

  console.log(`✅ Blog seeded (${BLOG_POSTS.length} posts)`)
}
