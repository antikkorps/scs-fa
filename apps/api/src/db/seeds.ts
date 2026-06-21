// apps/api/src/db/seeds.ts
// Données de base à insérer au démarrage

import { calculateArtworkPrice, CURRENT_RGPD_CONSENT_VERSION } from "@armurier/shared"
import { hash } from "@node-rs/argon2"
import { eq } from "drizzle-orm"
import { db } from "./client.js"
import {
  artworkPrints,
  artworks,
  blogPosts,
  legalCategories,
  productCategories,
  products,
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
  await seedBlog()

  console.log("🌱 Seeding complete!")
}

// ==========================================================================
// GUN ART — œuvres en tirage limité (≤25) pour la page collection
// ==========================================================================

// Image placeholders: Lorem Picsum (real photos, deterministic per slug) so the
// collection is visual out of the box. Replace `featuredImageUrl` from the admin
// backend with the real artwork photography when available.
// Demo image whose dimensions match the artwork's orientation, so landscape
// pieces don't render as cropped portraits in the gallery.
const PICSUM_DIMS: Record<string, [number, number]> = {
  portrait: [1200, 1500],
  landscape: [1500, 1000],
  square: [1200, 1200],
}
const picsum = (seed: string, orientation = "portrait") => {
  const [w, h] = PICSUM_DIMS[orientation] ?? PICSUM_DIMS.portrait
  return `https://picsum.photos/seed/${seed}/${w}/${h}`
}

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
    orientation: "landscape",
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
    orientation: "portrait",
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
    orientation: "landscape",
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
    orientation: "square",
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
    orientation: "portrait",
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
        featuredImageUrl: picsum(piece.slug, piece.orientation),
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
      featuredImageUrl: picsum(`blog-${post.slug}`, post.orientation),
      metaDescription: post.excerpt,
      authorId: admin?.id ?? null,
      published: true,
      featured: post.featured,
      publishedAt,
    })
  }

  console.log(`✅ Blog seeded (${BLOG_POSTS.length} posts)`)
}
