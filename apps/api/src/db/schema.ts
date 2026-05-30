// apps/api/src/db/schema.ts
// Schéma complet Drizzle ORM pour armurier e-commerce
// Stack: PostgreSQL + Drizzle + TypeScript

import { relations, sql } from "drizzle-orm"
import {
  boolean,
  check,
  customType,
  date,
  decimal,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core"

// Postgres full-text search vector (no native Drizzle type)
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector"
  },
})

// Immutable snapshot of an address book entry, frozen onto an order
export interface OrderAddressSnapshot {
  firstName: string
  lastName: string
  line1: string
  line2: string | null
  postal: string
  city: string
  country: string
  phone: string | null
}

// ============================================================================
// ENUMS (Catégories légales FR, rôles, statuts, etc.)
// ============================================================================

export const userRoleEnum = pgEnum("user_role", ["customer", "vendor", "admin"])
export const addressTypeEnum = pgEnum("address_type", ["shipping", "billing", "both"])
export const legalCategoryEnum = pgEnum("legal_category", ["A", "B", "C", "D", "none"])
export const docTypeEnum = pgEnum("doc_type", [
  "cni",
  "permis_chasse",
  "autorisation_det",
  "sia",
  "expertise",
])
export const docVerificationEnum = pgEnum("doc_verification_status", [
  "pending",
  "approved",
  "rejected",
  "expired",
])
export const orderLegalStatusEnum = pgEnum("order_legal_status", [
  "pending", // attente upload docs
  "docs_verifying", // en cours de vérif
  "docs_verified", // docs OK
  "docs_rejected", // docs rejetés, peut réupload
  "payment_pending", // docs OK, attente paiement
  "completed", // complètement traité (paiement + livraison)
])
export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "awaiting_transfer",
  "transfer_claimed",
  "received",
  "reconciled",
  "failed",
  "cancelled",
])
export const printStatusEnum = pgEnum("print_status", [
  "available",
  "in_cart",
  "sold",
  "reserved",
  "cancelled",
])
export const productCategoryEnum = pgEnum("product_category", [
  "arme_ancienne",
  "occasion",
  "arme_longue",
  "arme_poing",
  "arme_defense",
  "munition",
  "accessoire_tireur",
  "aide_visee",
  "accessoire_autre",
  "gun_art",
])

// ============================================================================
// 1. UTILISATEURS & AUTHENTIFICATION
// ============================================================================

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).unique().notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),

    // Profil
    firstname: varchar("firstname", { length: 100 }),
    lastname: varchar("lastname", { length: 100 }),
    phone: varchar("phone", { length: 20 }),

    // Rôles
    role: userRoleEnum("role").notNull().default("customer"),

    // Statut légal
    legalVerifiedAt: timestamp("legal_verified_at"),
    legalVerifiedBy: uuid("legal_verified_by"),
    legalRejectionReason: text("legal_rejection_reason"),
    legalRejectionAt: timestamp("legal_rejection_at"),

    // VIP (illimité après 1ère arme neuve)
    vipStatus: varchar("vip_status"), // null | 'premium' | 'elite' | 'custom'
    vipDiscountPct: decimal("vip_discount_pct", { precision: 5, scale: 2 }).default("0"),
    vipEligibleSince: timestamp("vip_eligible_since"), // date du 1er achat arme neuve
    vipActive: boolean("vip_active").default(false),

    // Adresse
    addressStreet: varchar("address_street", { length: 255 }),
    addressPostal: varchar("address_postal", { length: 10 }),
    addressCity: varchar("address_city", { length: 100 }),
    addressCountry: varchar("address_country", { length: 2 }).default("FR"),

    // Métadonnées
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    lastLoginAt: timestamp("last_login_at"),
    deletedAt: timestamp("deleted_at"), // Soft delete RGPD

    // Brute-force protection
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until"),

    // RGPD consent (recorded at registration; version tracks ToS revision)
    rgpdConsentAt: timestamp("rgpd_consent_at"),
    rgpdConsentVersion: varchar("rgpd_consent_version", { length: 20 }),
  },
  (t) => [
     index("idx_users_email").on(t.email).where(sql`${t.deletedAt} IS NULL`),
     index("idx_users_role").on(t.role),
     index("idx_users_vip_status").on(t.vipStatus),
     foreignKey({
      columns: [t.legalVerifiedBy],
      foreignColumns: [t.id],
    }),
  ],
)

export const usersRelations = relations(users, ({ many, one }) => ({
  legalDocuments: many(legalDocuments),
  addresses: many(addresses),
  orders: many(orders),
  cartItems: many(cartItems),
  artworkCartItems: many(artworkCartItems),
  auditLogs: many(auditLogs),
  refreshTokens: many(refreshTokens),
  verifiedByLogs: many(auditLogs, { relationName: "verifiedBy" }),
  legalVerifiedByUser: one(users, {
    fields: [users.legalVerifiedBy],
    references: [users.id],
  }),
}))

// ============================================================================
// Address book (multiple saved shipping/billing addresses per user)
// ============================================================================

export const addresses = pgTable(
  "addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),

    label: varchar("label", { length: 100 }), // e.g. "Domicile", "Bureau"
    type: addressTypeEnum("type").notNull().default("both"),

    firstName: varchar("first_name", { length: 100 }).notNull(),
    lastName: varchar("last_name", { length: 100 }).notNull(),
    line1: varchar("line1", { length: 255 }).notNull(),
    line2: varchar("line2", { length: 255 }),
    postal: varchar("postal", { length: 10 }).notNull(),
    city: varchar("city", { length: 100 }).notNull(),
    country: varchar("country", { length: 2 }).notNull().default("FR"),
    phone: varchar("phone", { length: 20 }),

    isDefault: boolean("is_default").notNull().default(false),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    index("idx_addresses_user").on(t.userId),
    foreignKey({
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
  ],
)

export const addressesRelations = relations(addresses, ({ one }) => ({
  user: one(users, {
    fields: [addresses.userId],
    references: [users.id],
  }),
}))

// ============================================================================
// Password reset tokens (single-use, 1h TTL)
// ============================================================================

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    index("idx_password_reset_tokens_user").on(t.userId),
    index("idx_password_reset_tokens_expires").on(t.expiresAt),
    foreignKey({
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
  ],
)

export const passwordResetTokensRelations = relations(passwordResetTokens, ({ one }) => ({
  user: one(users, {
    fields: [passwordResetTokens.userId],
    references: [users.id],
  }),
}))

// ============================================================================
// Refresh tokens (multi-device sessions; one row per active refresh token)
// ============================================================================

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    deviceLabel: varchar("device_label", { length: 255 }),
    lastUsedAt: timestamp("last_used_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    index("idx_refresh_tokens_user").on(t.userId),
    index("idx_refresh_tokens_expires").on(t.expiresAt),
    foreignKey({
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
  ],
)

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}))

// ============================================================================
export const legalDocuments = pgTable(
  "legal_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),

    // Type document
    docType: docTypeEnum("doc_type").notNull(), // 'cni', 'permis_chasse', 'autorisation_det', 'sia'
    docNumber: varchar("doc_number", { length: 100 }),

    // Stockage S3
    s3Key: varchar("s3_key", { length: 512 }).notNull(),
    s3Url: varchar("s3_url", { length: 512 }).notNull(),
    mimeType: varchar("mime_type", { length: 50 }),
    fileSize: integer("file_size"),

    // Validité
    issuedAt: date("issued_at"),
    expiresAt: date("expires_at"),

    // Statut vérification
    verificationStatus: docVerificationEnum("verification_status")
      .notNull()
      .default("pending"),
    verifiedAt: timestamp("verified_at"),
    verifiedBy: uuid("verified_by"),
    verificationNotes: text("verification_notes"),
    verificationDeadline: timestamp("verification_deadline"), // pour SLA 48h

    // Métadonnées
    uploadedAt: timestamp("uploaded_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
     index("idx_legal_docs_user").on(t.userId),
     index("idx_legal_docs_status").on(t.verificationStatus),
     index("idx_legal_docs_expires").on(t.expiresAt),
     uniqueIndex("uniq_user_doc_type")
      .on(t.userId, t.docType)
      .where(sql`${t.verificationStatus} = 'approved'`),
     foreignKey({
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
     foreignKey({
      columns: [t.verifiedBy],
      foreignColumns: [users.id],
    }),
  ],
)

export const legalDocumentsRelations = relations(legalDocuments, ({ one }) => ({
  user: one(users, {
    fields: [legalDocuments.userId],
    references: [users.id],
  }),
  verifiedByUser: one(users, {
    fields: [legalDocuments.verifiedBy],
    references: [users.id],
    relationName: "verifiedByLegalDocs",
  }),
}))

// ============================================================================
// 2. CATÉGORIES & TYPES D'ARMES
// ============================================================================

export const productCategories = pgTable("product_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 100 }).unique().notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  category: productCategoryEnum("category").notNull(),
  displayOrder: integer("display_order").default(0),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
})

export const productCategoriesRelations = relations(productCategories, ({ many }) => ({
  products: many(products),
}))

// ============================================================================
export const legalCategories = pgTable("legal_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  category: legalCategoryEnum("category").notNull().unique(), // A, B, C, D, none
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  requiresVerification: boolean("requires_verification").notNull().default(true),
  minAge: integer("min_age").default(18),
  requiredDocTypes: jsonb("required_doc_types").$type<string[]>().default(sql`'[]'::jsonb`), // ["cni", "permis_chasse", ...]
  createdAt: timestamp("created_at").defaultNow(),
})

export const legalCategoriesRelations = relations(legalCategories, ({ many }) => ({
  products: many(products),
}))

// ============================================================================
// 3. PRODUITS & VARIANTES
// ============================================================================

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  contactEmail: varchar("contact_email", { length: 255 }),
  contactPhone: varchar("contact_phone", { length: 20 }),
  defaultMarginPct: decimal("default_margin_pct", { precision: 5, scale: 2 }).default(
    "30",
  ),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
})

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  products: many(products),
}))

// ============================================================================
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Identifiants
    sku: varchar("sku", { length: 100 }).unique().notNull(),
    slug: varchar("slug", { length: 255 }).unique().notNull(),

    // Infos
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    longDescription: text("long_description"),

    // Catégorisation
    categoryId: uuid("category_id").notNull(),
    legalCategoryId: uuid("legal_category_id"), // null pour gun art, 'none' pour accessoires

    // Fournisseur
    supplierId: uuid("supplier_id"),
    supplierSku: varchar("supplier_sku", { length: 100 }),
    supplierPrice: decimal("supplier_price_ht", { precision: 10, scale: 2 }),

    // Pricing
    priceHt: decimal("price_ht", { precision: 10, scale: 2 }).notNull(),
    marginPct: decimal("margin_pct", { precision: 5, scale: 2 }).default("30"),
    costPrice: decimal("cost_price_ht", { precision: 10, scale: 2 }),

    // TVA
    vatPct: decimal("vat_pct", { precision: 4, scale: 2 }).default("20"),

    // Stock
    stockQty: integer("stock_qty").default(0),
    stockAlertLevel: integer("stock_alert_level").default(5),
    trackStock: boolean("track_stock").default(true),

    // Attributs légaux
    requiresLegalVerification: boolean("requires_legal_verification").notNull(),
    ageMinRequired: integer("age_min_required"),
    hasAccessoryRestrictions: boolean("has_accessory_restrictions").default(false),
    accessoryRestrictionNotes: text("accessory_restriction_notes"),

    // Média
    featuredImageUrl: varchar("featured_image_url", { length: 512 }),
    imagesCount: integer("images_count").default(0),

    // SEO
    metaTitle: varchar("meta_title", { length: 255 }),
    metaDescription: varchar("meta_description", { length: 500 }),
    keywords: varchar("keywords", { length: 500 }),

    // Statuts
    published: boolean("published").default(true),
    featured: boolean("featured").default(false),

    // Recherche full-text (généré: name pondéré A, description B, longDescription C)
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('french', coalesce(name, '')), 'A') || setweight(to_tsvector('french', coalesce(description, '')), 'B') || setweight(to_tsvector('french', coalesce(long_description, '')), 'C')`,
    ),

    // Métadonnées
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
     index("idx_products_category").on(t.categoryId),
     index("idx_products_legal_category").on(t.legalCategoryId),
     index("idx_products_slug").on(t.slug),
     index("idx_products_published").on(t.published),
     index("idx_products_requires_legal").on(
      t.requiresLegalVerification,
    ),
     index("idx_products_search").using("gin", t.searchVector),
     foreignKey({
      columns: [t.categoryId],
      foreignColumns: [productCategories.id],
    }),
     foreignKey({
      columns: [t.legalCategoryId],
      foreignColumns: [legalCategories.id],
    }),
     foreignKey({
      columns: [t.supplierId],
      foreignColumns: [suppliers.id],
    }),
  ],
)

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(productCategories, {
    fields: [products.categoryId],
    references: [productCategories.id],
  }),
  legalCategory: one(legalCategories, {
    fields: [products.legalCategoryId],
    references: [legalCategories.id],
  }),
  supplier: one(suppliers, {
    fields: [products.supplierId],
    references: [suppliers.id],
  }),
  variants: many(productVariants),
  ancientWeapon: one(ancientWeapons),
  artwork: one(artworks),
  orderItems: many(orderItems),
}))

// ============================================================================
export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").notNull(),

    // SKU variant
    skuVariant: varchar("sku_variant", { length: 150 }).unique().notNull(),

    // Attributs
    finition: varchar("finition", { length: 100 }),
    munition: varchar("munition", { length: 100 }),
    couleur: varchar("couleur", { length: 100 }),

    // Stock & prix
    stockQty: integer("stock_qty").default(0),
    priceDeltaHt: decimal("price_delta_ht", { precision: 8, scale: 2 }).default("0"),

    // Métadonnées
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
     index("idx_variants_product").on(t.productId),
     index("idx_variants_sku").on(t.skuVariant),
     foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
    }).onDelete("cascade"),
     check(
      "chk_variant_attrs",
      sql`finition IS NOT NULL OR munition IS NOT NULL OR couleur IS NOT NULL`,
    ),
  ],
)

export const productVariantsRelations = relations(productVariants, ({ one, many }) => ({
  product: one(products, {
    fields: [productVariants.productId],
    references: [products.id],
  }),
  cartItems: many(cartItems),
  orderItems: many(orderItems),
  stockMovements: many(stockMovements),
}))

// ============================================================================
// 4. ARMES ANCIENNES (spécialisées)
// ============================================================================

export const ancientWeapons = pgTable(
  "ancient_weapons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").notNull().unique(),

    // Historique
    period: varchar("period", { length: 100 }),
    periodStartYear: integer("period_start_year"),
    periodEndYear: integer("period_end_year"),
    provenance: varchar("provenance", { length: 500 }),
    makerName: varchar("maker_name", { length: 255 }),
    makerLocation: varchar("maker_location", { length: 255 }),

    // Condition
    condition: varchar("condition", { length: 50 }).notNull(), // 'excellent', 'bon', 'moyen', 'restauré'
    conditionDescription: text("condition_description"),
    restorationInfo: text("restoration_info"),

    // Authenticité & expertise
    isAuthentic: boolean("is_authentic").notNull().default(false),
    expertName: varchar("expert_name", { length: 255 }),
    expertCertificationUrl: varchar("expert_certification_url", { length: 512 }),
    expertDate: date("expert_date"),

    // Historique JSONB
    historicalInfo: jsonb("historical_info")
      .$type<{
        battles?: string[]
        owners?: string[]
        events?: string[]
        notes?: string
      }>()
      .default({}),

    // Unicité
    isUnique: boolean("is_unique").default(false),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
     foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
    }).onDelete("cascade"),
     index("idx_ancient_period").on(t.periodStartYear, t.periodEndYear),
     index("idx_ancient_authentic").on(t.isAuthentic),
  ],
)

export const ancientWeaponsRelations = relations(ancientWeapons, ({ one }) => ({
  product: one(products, {
    fields: [ancientWeapons.productId],
    references: [products.id],
  }),
}))

// ============================================================================
// 5. GUN ART (Tableaux, Photos, Tirages limités)
// ============================================================================

export const artworks = pgTable(
  "artworks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").notNull().unique(),

    // Identifiants
    slug: varchar("slug", { length: 255 }).unique().notNull(),
    sku: varchar("sku", { length: 100 }).unique().notNull(),

    // Infos
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    longDescription: text("long_description"),

    // Artiste
    artistName: varchar("artist_name", { length: 255 }),
    artistBio: text("artist_bio"),
    artistImageUrl: varchar("artist_image_url", { length: 512 }),

    // Série
    editionLimit: integer("edition_limit").notNull(), // 25 max pour photos
    editionYear: integer("edition_year"),

    // Formats disponibles pour cette oeuvre
    // Format: [{ name: 'A4', width: 21, height: 29.7 }, { name: 'A3', width: 29.7, height: 42 }, ...]
    availableFormats: jsonb("available_formats")
      .$type<
        Array<{
          id: string
          name: string
          widthCm: number
          heightCm: number
          priceFactor: number // 1.0, 1.5, 2.0, etc.
        }>
      >()
      .notNull()
      .default(sql`'[]'::jsonb`),

    // Pricing dynamique
    basePriceHt: decimal("base_price_ht", { precision: 10, scale: 2 }).notNull(), // prix pour 1er tirage petit format
    priceIncrementHt: decimal("price_increment_ht", { precision: 8, scale: 2 }).notNull(), // augmentation par tirage restant
    // Formule: basePriceHt * formatPriceFactor + (priceIncrementHt * (editionLimit - printNumber))

    vatPct: decimal("vat_pct", { precision: 4, scale: 2 }).default("20"),

    // Certificat
    certificateTemplateUrl: varchar("certificate_template_url", { length: 512 }),
    includeCertificate: boolean("include_certificate").default(true),

    // Médias
    featuredImageUrl: varchar("featured_image_url", { length: 512 }),
    imagesCount: integer("images_count").default(0),

    // Disponibilité
    availableFrom: timestamp("available_from"),
    availableUntil: timestamp("available_until"),

    // Statuts
    published: boolean("published").default(false),
    featured: boolean("featured").default(false),

    // SEO
    metaTitle: varchar("meta_title", { length: 255 }),
    metaDescription: varchar("meta_description", { length: 500 }),
    keywords: varchar("keywords", { length: 500 }),

    // Métadonnées
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
     index("idx_artworks_slug").on(t.slug),
     index("idx_artworks_published").on(t.published),
     index("idx_artworks_available").on(t.availableFrom, t.availableUntil),
     foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
    }).onDelete("cascade"),
  ],
)

export const artworksRelations = relations(artworks, ({ one, many }) => ({
  product: one(products, {
    fields: [artworks.productId],
    references: [products.id],
  }),
  prints: many(artworkPrints),
}))

// ============================================================================
export const artworkPrints = pgTable(
  "artwork_prints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artworkId: uuid("artwork_id").notNull(),

    // Numérotation & format
    printNumber: integer("print_number").notNull(), // 1, 2, 3, ...
    totalPrints: integer("total_prints").notNull(), // snapshot de edition_limit
    printDesignation: varchar("print_designation", { length: 50 }).notNull(), // "1/25", "2/25", etc.
    formatId: varchar("format_id", { length: 100 }).notNull(), // référence à artwork.availableFormats[].id

    // Prix
    priceHtUnit: decimal("price_ht_unit", { precision: 10, scale: 2 }).notNull(), // calculé à la création

    // Statut du tirage
    status: printStatusEnum("status").notNull().default("available"),

    // Vente
    orderId: uuid("order_id"),
    soldAt: timestamp("sold_at"),
    soldPriceTtc: decimal("sold_price_ttc", { precision: 10, scale: 2 }),

    // Certificat
    certificateNumber: varchar("certificate_number", { length: 100 }).unique(),
    certificateUrl: varchar("certificate_url", { length: 512 }),
    certificateGeneratedAt: timestamp("certificate_generated_at"),

    // Métadonnées
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
     index("idx_prints_artwork").on(t.artworkId),
     index("idx_prints_status").on(t.status),
     index("idx_prints_sold").on(t.orderId),
     uniqueIndex("uniq_print_per_artwork").on(t.artworkId, t.printNumber),
     foreignKey({
      columns: [t.artworkId],
      foreignColumns: [artworks.id],
    }).onDelete("cascade"),
     foreignKey({
      columns: [t.orderId],
      foreignColumns: [orders.id],
    }),
     check(
      "chk_print_number",
      sql`print_number >= 1 AND print_number <= total_prints`,
    ),
  ],
)

export const artworkPrintsRelations = relations(artworkPrints, ({ one, many }) => ({
  artwork: one(artworks, {
    fields: [artworkPrints.artworkId],
    references: [artworks.id],
  }),
  order: one(orders, {
    fields: [artworkPrints.orderId],
    references: [orders.id],
  }),
  cartItems: many(artworkCartItems),
}))

// ============================================================================
// 6. PANIER
// ============================================================================

export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    variantId: uuid("variant_id").notNull(),

    // Quantité & prix
    qty: integer("qty").notNull().default(1),
    priceHtAtTime: decimal("price_ht_at_time", { precision: 10, scale: 2 }).notNull(),

    // Métadonnées
    addedAt: timestamp("added_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
     index("idx_cart_user").on(t.userId),
     foreignKey({
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
     foreignKey({
      columns: [t.variantId],
      foreignColumns: [productVariants.id],
    }).onDelete("cascade"),
  ],
)

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  user: one(users, {
    fields: [cartItems.userId],
    references: [users.id],
  }),
  variant: one(productVariants, {
    fields: [cartItems.variantId],
    references: [productVariants.id],
  }),
}))

// ============================================================================
export const artworkCartItems = pgTable(
  "artwork_cart_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    printId: uuid("print_id").notNull(),

    // Prix
    priceHtAtTime: decimal("price_ht_at_time", { precision: 10, scale: 2 }).notNull(),

    // Métadonnées
    addedAt: timestamp("added_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
     index("idx_art_cart_user").on(t.userId),
     uniqueIndex("uniq_print_per_user_cart").on(t.userId, t.printId),
     foreignKey({
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
     foreignKey({
      columns: [t.printId],
      foreignColumns: [artworkPrints.id],
    }).onDelete("cascade"),
  ],
)

export const artworkCartItemsRelations = relations(artworkCartItems, ({ one }) => ({
  user: one(users, {
    fields: [artworkCartItems.userId],
    references: [users.id],
  }),
  print: one(artworkPrints, {
    fields: [artworkCartItems.printId],
    references: [artworkPrints.id],
  }),
}))

// ============================================================================
// 7. COMMANDES
// ============================================================================

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),

    // Workflow légal (seules armes réglementées requis)
    legalVerificationStatus: orderLegalStatusEnum("legal_verification_status")
      .notNull()
      .default("pending"),
    legalVerifiedAt: timestamp("legal_verified_at"),
    legalVerifiedBy: uuid("legal_verified_by"),
    legalRejectionReason: text("legal_rejection_reason"),
    legalVerificationDeadline: timestamp("legal_verification_deadline"), // SLA 48h

    // Paiement
    paymentStatus: paymentStatusEnum("payment_status").notNull().default("pending"),

    // Snapshot items (immuable)
    itemsJson: jsonb("items_json")
      .$type<
        Array<{
          variantId?: string
          printId?: string
          qty: number
          priceHt: number
          name: string
          sku: string
          category: string
          legalCategory?: string | null
          requiresPaymentVirement: boolean
        }>
      >()
      .notNull()
      .default(sql`'[]'::jsonb`),

    // Totaux
    subtotalHt: decimal("subtotal_ht", { precision: 10, scale: 2 }).notNull(),
    vatAmount: decimal("vat_amount", { precision: 10, scale: 2 }).notNull(),
    totalTtc: decimal("total_ttc", { precision: 10, scale: 2 }).notNull(),

    // Réductions
    vipDiscountAppliedPct: decimal("vip_discount_applied_pct", {
      precision: 5,
      scale: 2,
    }).default("0"),
    vipDiscountAmount: decimal("vip_discount_amount", {
      precision: 10,
      scale: 2,
    }).default("0"),
    promoCode: varchar("promo_code", { length: 100 }),
    promoDiscountAmount: decimal("promo_discount_amount", {
      precision: 10,
      scale: 2,
    }).default("0"),

    // Livraison
    shippingMethod: varchar("shipping_method", { length: 50 }), // 'std', 'express', 'retirait'
    shippingCost: decimal("shipping_cost", { precision: 8, scale: 2 }).default("0"),
    shippingAddressStreet: varchar("shipping_address_street", { length: 255 }),
    shippingAddressPostal: varchar("shipping_address_postal", { length: 10 }),
    shippingAddressCity: varchar("shipping_address_city", { length: 100 }),

    // Immutable address snapshots taken from the address book at order time
    shippingAddress: jsonb("shipping_address").$type<OrderAddressSnapshot>(),
    billingAddress: jsonb("billing_address").$type<OrderAddressSnapshot>(),

    // Henrri
    henrriInvoiceId: varchar("henrri_invoice_id", { length: 100 }).unique(),
    henrriSyncAt: timestamp("henrri_sync_at"),
    henrriSyncStatus: varchar("henrri_sync_status", { length: 50 }), // pending, synced, failed
    henrriErrorMsg: text("henrri_error_msg"),

    // Métadonnées
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
     index("idx_orders_user").on(t.userId),
     index("idx_orders_legal_status").on(t.legalVerificationStatus),
     index("idx_orders_payment_status").on(t.paymentStatus),
     index("idx_orders_created").on(t.createdAt),
     index("idx_orders_henrri").on(t.henrriInvoiceId),
     foreignKey({
      columns: [t.userId],
      foreignColumns: [users.id],
    }),
     foreignKey({
      columns: [t.legalVerifiedBy],
      foreignColumns: [users.id],
    }),
  ],
)

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, {
    fields: [orders.userId],
    references: [users.id],
  }),
  legalVerifiedByUser: one(users, {
    fields: [orders.legalVerifiedBy],
    references: [users.id],
    relationName: "verifiedByOrders",
  }),
  items: many(orderItems),
  paymentVirement: one(paymentVirement),
  paymentCarte: one(paymentCarte),
  invoice: one(invoices),
  prints: many(artworkPrints),
  auditLogs: many(auditLogs),
}))

// ============================================================================
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull(),

    // Produit
    productId: uuid("product_id").notNull(),
    variantId: uuid("variant_id"),

    // Snapshot
    productName: varchar("product_name", { length: 255 }).notNull(),
    productSku: varchar("product_sku", { length: 100 }).notNull(),
    variantSku: varchar("variant_sku", { length: 150 }),

    // Pricing
    qty: integer("qty").notNull(),
    priceHtUnit: decimal("price_ht_unit", { precision: 10, scale: 2 }).notNull(),
    priceHtTotal: decimal("price_ht_total", { precision: 10, scale: 2 }).notNull(),
    vatPct: decimal("vat_pct", { precision: 4, scale: 2 }).notNull(),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
     index("idx_order_items_order").on(t.orderId),
     foreignKey({
      columns: [t.orderId],
      foreignColumns: [orders.id],
    }).onDelete("cascade"),
     foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
    }),
     foreignKey({
      columns: [t.variantId],
      foreignColumns: [productVariants.id],
    }),
  ],
)

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
  variant: one(productVariants, {
    fields: [orderItems.variantId],
    references: [productVariants.id],
  }),
}))

// ============================================================================
// 8. PAIEMENTS
// ============================================================================

export const paymentVirement = pgTable(
  "payment_virements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().unique(),

    // Montant
    amountExpectedTtc: decimal("amount_expected_ttc", {
      precision: 10,
      scale: 2,
    }).notNull(),
    currency: varchar("currency", { length: 3 }).default("EUR"),

    // Instruction
    ibanRecipient: varchar("iban_recipient", { length: 50 }).notNull(),
    bankName: varchar("bank_name", { length: 255 }),
    accountHolderName: varchar("account_holder_name", { length: 255 }),
    paymentReference: varchar("payment_reference", { length: 100 }),

    // Suivi
    paymentStatus: paymentStatusEnum("payment_status")
      .notNull()
      .default("awaiting_transfer"),

    // Claim client
    clientReportedIban: varchar("client_reported_iban", { length: 50 }),
    clientReportedDate: date("client_reported_date"),
    clientReportedAmount: decimal("client_reported_amount", { precision: 10, scale: 2 }),
    clientReportedRef: varchar("client_reported_ref", { length: 100 }),
    clientNotes: text("client_notes"),

    // Réconciliation
    amountReceivedTtc: decimal("amount_received_ttc", { precision: 10, scale: 2 }),
    receivedAt: timestamp("received_at"),
    receivedFromIban: varchar("received_from_iban", { length: 50 }),
    reconciledAt: timestamp("reconciled_at"),
    reconciledBy: uuid("reconciled_by"),
    reconciliationNotes: text("reconciliation_notes"),

    // Métadonnées
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
     index("idx_payments_order").on(t.orderId),
     index("idx_payments_status").on(t.paymentStatus),
     foreignKey({
      columns: [t.orderId],
      foreignColumns: [orders.id],
    }).onDelete("cascade"),
     foreignKey({
      columns: [t.reconciledBy],
      foreignColumns: [users.id],
    }),
  ],
)

export const paymentVirementRelations = relations(paymentVirement, ({ one }) => ({
  order: one(orders, {
    fields: [paymentVirement.orderId],
    references: [orders.id],
  }),
  reconciledByUser: one(users, {
    fields: [paymentVirement.reconciledBy],
    references: [users.id],
  }),
}))

// ============================================================================
export const paymentCarte = pgTable(
  "payment_carte",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().unique(),

    // Montant
    amountTtc: decimal("amount_ttc", { precision: 10, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("EUR"),

    // Paiement
    paymentStatus: paymentStatusEnum("payment_status").notNull().default("pending"),
    stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
    last4: varchar("last4", { length: 4 }),
    brand: varchar("brand", { length: 50 }),

    // Métadonnées
    processedAt: timestamp("processed_at"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
     index("idx_payment_carte_order").on(t.orderId),
     index("idx_payment_carte_status").on(t.paymentStatus),
     foreignKey({
      columns: [t.orderId],
      foreignColumns: [orders.id],
    }).onDelete("cascade"),
  ],
)

export const paymentCarteRelations = relations(paymentCarte, ({ one }) => ({
  order: one(orders, {
    fields: [paymentCarte.orderId],
    references: [orders.id],
  }),
}))

// ============================================================================
// 9. FACTURES (Henrri)
// ============================================================================

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull(),

    // Henrri
    henrriInvoiceNumber: varchar("henrri_invoice_number", { length: 50 })
      .notNull()
      .unique(),
    henrriSyncStatus: varchar("henrri_sync_status", { length: 50 }).default("pending"),

    // PDF
    pdfUrl: varchar("pdf_url", { length: 512 }),
    pdfGeneratedAt: timestamp("pdf_generated_at"),

    // Dates
    issuedAt: timestamp("issued_at"),
    dueDate: date("due_date"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
     index("idx_invoices_order").on(t.orderId),
     index("idx_invoices_henrri_number").on(t.henrriInvoiceNumber),
     foreignKey({
      columns: [t.orderId],
      foreignColumns: [orders.id],
    }).onDelete("cascade"),
  ],
)

export const invoicesRelations = relations(invoices, ({ one }) => ({
  order: one(orders, {
    fields: [invoices.orderId],
    references: [orders.id],
  }),
}))

// ============================================================================
// 10. AUDIT & LOGS
// ============================================================================

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Acteur
    userId: uuid("user_id"),
    userRole: varchar("user_role", { length: 50 }),

    // Action
    entityType: varchar("entity_type", { length: 100 }).notNull(),
    entityId: uuid("entity_id"),
    action: varchar("action", { length: 50 }).notNull(),

    // Modifications
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),

    // Contexte
    reason: text("reason"),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
     index("idx_audit_entity").on(t.entityType, t.entityId),
     index("idx_audit_user").on(t.userId),
     index("idx_audit_action").on(t.action),
     index("idx_audit_created").on(t.createdAt),
     foreignKey({
      columns: [t.userId],
      foreignColumns: [users.id],
    }),
  ],
)

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}))

// ============================================================================
// 11. STOCK
// ============================================================================

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Produit
    variantId: uuid("variant_id").notNull(),

    // Mouvement
    qtyChange: integer("qty_change").notNull(),
    movementType: varchar("movement_type", { length: 50 }).notNull(), // 'purchase', 'sale', 'return', 'adjustment', 'loss'

    // Référence
    referenceId: uuid("reference_id"),
    referenceType: varchar("reference_type", { length: 50 }),

    // Notes
    notes: text("notes"),

    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
     index("idx_stock_variant").on(t.variantId),
     index("idx_stock_type").on(t.movementType),
     index("idx_stock_created").on(t.createdAt),
     foreignKey({
      columns: [t.variantId],
      foreignColumns: [productVariants.id],
    }),
     foreignKey({
      columns: [t.createdBy],
      foreignColumns: [users.id],
    }),
  ],
)

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  variant: one(productVariants, {
    fields: [stockMovements.variantId],
    references: [productVariants.id],
  }),
  createdByUser: one(users, {
    fields: [stockMovements.createdBy],
    references: [users.id],
  }),
}))

// ============================================================================
// 12. BLOG
// ============================================================================

export const blogPosts = pgTable(
  "blog_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    slug: varchar("slug", { length: 255 }).unique().notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    excerpt: text("excerpt"),
    content: text("content").notNull(),

    // Auteur
    authorId: uuid("author_id"),

    // Catégorisation
    category: varchar("category", { length: 100 }),
    tags: varchar("tags", { length: 500 }),

    // Media
    featuredImageUrl: varchar("featured_image_url", { length: 512 }),

    // SEO
    metaTitle: varchar("meta_title", { length: 255 }),
    metaDescription: varchar("meta_description", { length: 500 }),

    // Statuts
    published: boolean("published").default(false),
    featured: boolean("featured").default(false),

    publishedAt: timestamp("published_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
     index("idx_blog_slug").on(t.slug),
     index("idx_blog_published").on(t.published),
     index("idx_blog_category").on(t.category),
     foreignKey({
      columns: [t.authorId],
      foreignColumns: [users.id],
    }),
  ],
)

export const blogPostsRelations = relations(blogPosts, ({ one }) => ({
  author: one(users, {
    fields: [blogPosts.authorId],
    references: [users.id],
  }),
}))
