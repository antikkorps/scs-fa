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
  primaryKey,
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
export const docScanEnum = pgEnum("doc_scan_status", [
  "pending", // uploaded, antivirus scan not yet run
  "clean", // scan passed — document is usable
  "infected", // scan flagged the file — quarantined
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
  "partially_refunded",
  "refunded",
])
// Refund channel mirrors the two payment buckets: card (Stripe) and bank transfer
// (recorded manually — the actual wire-back happens out of band).
export const refundChannelEnum = pgEnum("refund_channel", ["carte", "virement"])
// A card refund may settle asynchronously (pending → succeeded via webhook); a
// manually-recorded virement refund is asserted succeeded by the admin.
export const refundStatusEnum = pgEnum("refund_status", ["pending", "succeeded", "failed", "cancelled"])
export const printStatusEnum = pgEnum("print_status", [
  "available",
  "in_cart",
  "sold",
  "reserved",
  "cancelled",
])
// Nature d'un produit — UNE seule par produit, structurelle (pilote la nav, le
// méga-menu et les URLs `?category=` déjà indexées). Les états et époques
// (occasion, arme ancienne, historique de guerre) sont des TAGS, pas des
// catégories : ils se cumulent, une arme historique étant nécessairement
// d'occasion (story 11.1).
export const productCategoryEnum = pgEnum("product_category", [
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
    // Refresh-token rotation with reuse detection (RTR): all rotations of one
    // session share a family_id; a consumed token is kept with revoked_at set so
    // that replaying it is detectable as theft → the whole family is revoked.
    familyId: uuid("family_id").notNull().defaultRandom(),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [
    index("idx_refresh_tokens_user").on(t.userId),
    index("idx_refresh_tokens_expires").on(t.expiresAt),
    index("idx_refresh_tokens_family").on(t.familyId),
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

    // Antivirus
    scanStatus: docScanEnum("scan_status").notNull().default("pending"),
    scannedAt: timestamp("scanned_at"),

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
    rejectionReason: varchar("rejection_reason", { length: 50 }), // standardized code (LEGAL_DOC_REJECTION_REASONS)
    verificationDeadline: timestamp("verification_deadline"), // pour SLA 48h
    slaBreachNotifiedAt: timestamp("sla_breach_notified_at"), // SLA 4.4 : alerte breach envoyée une seule fois

    // Métadonnées
    uploadedAt: timestamp("uploaded_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
     index("idx_legal_docs_user").on(t.userId),
     index("idx_legal_docs_status").on(t.verificationStatus),
     index("idx_legal_docs_expires").on(t.expiresAt),
     // SLA 4.4 : scan ciblé des docs en attente jamais encore alertés
     index("idx_legal_docs_sla_breach")
      .on(t.verificationDeadline)
      .where(sql`${t.verificationStatus} = 'pending' AND ${t.slaBreachNotifiedAt} IS NULL`),
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
// TAGS TRANSVERSES (story 11.1)
// ============================================================================
// Un produit porte UNE catégorie (sa nature) et AUTANT DE TAGS que nécessaire.
// C'est ce qui permet à une arme d'être à la fois « historique » et
// « d'occasion » — ce qu'une catégorie unique ne pouvait pas exprimer.
//
// La FACETTE regroupe les tags pour le filtrage : **OU à l'intérieur d'une
// facette, ET entre facettes**. Cocher un second état élargit donc le résultat,
// tandis qu'ajouter une époque le restreint — le comportement attendu d'un
// filtre à facettes. Les facettes sont structurelles (peu nombreuses, stables,
// elles pilotent la requête) et vivent donc dans un enum ; les tags sont
// éditoriaux (nombreux, renommables depuis le backoffice sans migration).
export const tagFacetEnum = pgEnum("tag_facet", ["etat", "epoque", "caracteristique"])

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 100 }).unique().notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    facet: tagFacetEnum("facet").notNull(),
    description: text("description"),
    displayOrder: integer("display_order").default(0),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [index("idx_tags_facet").on(t.facet, t.displayOrder)],
)

// Pivot n-n. Clé primaire composite = un tag ne peut être posé deux fois sur le
// même produit ; les deux FK cascadent, donc supprimer un tag le retire partout
// sans laisser de ligne orpheline.
export const productTags = pgTable(
  "product_tags",
  {
    productId: uuid("product_id").notNull(),
    tagId: uuid("tag_id").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.tagId] }),
    foreignKey({ columns: [t.productId], foreignColumns: [products.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.tagId], foreignColumns: [tags.id] }).onDelete("cascade"),
    // L'index sur product_id est déjà fourni par la PK composite (colonne de
    // tête) ; celui-ci sert le sens inverse : « tous les produits de ce tag ».
    index("idx_product_tags_tag").on(t.tagId),
  ],
)

export const tagsRelations = relations(tags, ({ many }) => ({
  products: many(productTags),
}))

export const productTagsRelations = relations(productTags, ({ one }) => ({
  product: one(products, {
    fields: [productTags.productId],
    references: [products.id],
  }),
  tag: one(tags, {
    fields: [productTags.tagId],
    references: [tags.id],
  }),
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
// ============================================================================
// BÉNÉFICIAIRES (story 11.10)
// ============================================================================
// Déclarée ICI, avant `products` et `artists`, parce que les deux la référencent
// — une table Drizzle ne peut pointer que vers une table déjà déclarée. La table
// des reversements, elle, vit plus bas : elle référence `orders`.
export const beneficiaryKindEnum = pgEnum("beneficiary_kind", ["artist", "advisor"])

export const beneficiaries = pgTable(
  "beneficiaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 255 }).unique().notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    kind: beneficiaryKindEnum("kind").notNull(),

    /** Taux par défaut, redéfinissable article par article quand c'est négocié. */
    defaultSharePct: decimal("default_share_pct", { precision: 5, scale: 2 }).notNull().default("0"),

    contactEmail: varchar("contact_email", { length: 255 }),
    // ⚠️ Volontairement PAS d'IBAN : ce serait une donnée bancaire de plus à
    // protéger pour un besoin que rien n'exige encore. Une note libre suffit
    // tant que les versements se font hors du site.
    paymentNotes: text("payment_notes"),

    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [index("idx_beneficiaries_active").on(t.active, t.name)],
)

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

    // Charges d'un article (story 11.10) : en pourcentage OU en montant, les
    // deux étant laissés vides quand le défaut global de configuration suffit.
    // ⚠️ Strictement administratif — aucune route publique ne les expose.
    chargesPct: decimal("charges_pct", { precision: 5, scale: 2 }),
    chargesAmountHt: decimal("charges_amount_ht", { precision: 10, scale: 2 }),

    // Reversement (story 11.10) : qui touche une part sur la vente de cet
    // article, et à quel taux si le défaut du bénéficiaire est renégocié ici.
    beneficiaryId: uuid("beneficiary_id"),
    beneficiarySharePct: decimal("beneficiary_share_pct", { precision: 5, scale: 2 }),

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
     // Un bénéficiaire supprimé ne doit pas laisser de référence morte sur un
     // article : le lien se vide, l'article reste vendable.
     foreignKey({ columns: [t.beneficiaryId], foreignColumns: [beneficiaries.id] }).onDelete("set null"),
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
  tags: many(productTags),
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

    // Réservation panier des PIÈCES UNIQUES (story 11.2). Une arme de collection
    // n'existe qu'en un exemplaire : sans blocage à l'ajout au panier, deux
    // clients peuvent la préparer en parallèle et le second n'apprend qu'à la
    // validation qu'elle est partie. Même intention que la réservation des
    // tirages Gun Art (story 5.2), transposée au stock d'une variante.
    //
    // Une réservation **expirée n'est jamais balayée** : elle est ignorée à la
    // lecture (`reserved_until < now()`). Pas de tâche planifiée à maintenir, et
    // aucune fenêtre pendant laquelle une pièce libre paraîtrait encore prise.
    reservedBy: uuid("reserved_by"),
    reservedUntil: timestamp("reserved_until"),

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
     foreignKey({
      columns: [t.reservedBy],
      foreignColumns: [users.id],
      // A deleted account must not keep a piece hostage.
    }).onDelete("set null"),
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
// MÉDIAS (story 7.5b)
// ============================================================================
// Une seule table pour TOUS les visuels du catalogue, parce qu'il y a déjà
// quatre porteurs — produit, œuvre, série, artiste — et qu'il y en aura
// d'autres. Quatre tables quasi identiques auraient voulu dire quatre CRUD et
// une cinquième à chaque nouveau porteur.
//
// ⚠️ Le prix assumé du polymorphisme : **aucune FK ne garantit que `owner_id`
// existe encore**. La suppression du porteur ne cascade donc pas toute seule —
// le nettoyage est explicite dans `media/service.ts` et verrouillé par un test.
export const mediaOwnerTypeEnum = pgEnum("media_owner_type", ["product", "artwork", "artwork_series", "artist"])

export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    ownerType: mediaOwnerTypeEnum("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),

    // Rang dans la galerie. La position 0 est l'image principale : c'est elle
    // qui alimente `featuredImageUrl` (ou son équivalent) du porteur.
    position: integer("position").notNull().default(0),

    // Obligatoire à l'upload (a11y + SEO) : une galerie d'images sans alt est
    // une galerie inaccessible.
    alt: varchar("alt", { length: 500 }).notNull(),

    // Largeurs réellement disponibles, en px. Une petite image n'est jamais
    // agrandie, donc la liste varie d'un fichier à l'autre et ne peut pas être
    // devinée côté front.
    widths: jsonb("widths").$type<number[]>().notNull().default(sql`'[]'::jsonb`),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),

    // ⚠️ Vrai pour les œuvres : le fichier servi porte le filigrane de la 11.5 et
    // sa résolution est plafonnée. Stocké plutôt que déduit du type de porteur,
    // pour qu'un visuel protégé le reste même si la règle évolue.
    watermarked: boolean("watermarked").notNull().default(false),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    index("idx_media_owner").on(t.ownerType, t.ownerId, t.position),
  ],
)

// ============================================================================
// 5. GUN ART (Tableaux, Photos, Tirages limités)
// ============================================================================

// --- Éditorial Gun Art (story 11.6) -----------------------------------------
// L'œuvre isolée ne suffit pas : Sylvain travaille par SÉRIES, chacune adossée à
// un THÈME (un film, un univers de référence) et signée par un ARTISTE. Ces
// trois notions sont des tables et non des colonnes, pour trois raisons :
//   - un thème doit pouvoir porter sa propre page indexable, avec un libellé
//     unique qui ne dérive pas d'une saisie à l'autre ;
//   - la bio de l'artiste vivait dupliquée sur CHAQUE œuvre — une page artiste
//     n'aurait eu aucune source de vérité à lire ;
//   - le modèle ne présume pas d'un artiste unique, même si le client n'en a
//     qu'un aujourd'hui.

export const artists = pgTable(
  "artists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 255 }).unique().notNull(),
    name: varchar("name", { length: 255 }).notNull(),

    // Éditorial
    headline: varchar("headline", { length: 255 }), // accroche sous le nom
    bio: text("bio"),
    journey: text("journey"), // parcours
    portraitUrl: varchar("portrait_url", { length: 512 }),

    // Livre de l'artiste (lien affilié : rendu en rel="sponsored noopener").
    // En base et non en configuration, pour que le lien se change depuis le
    // backoffice plutôt que par un déploiement.
    bookTitle: varchar("book_title", { length: 255 }),
    bookUrl: varchar("book_url", { length: 512 }),

    published: boolean("published").default(false),

    // Identité FINANCIÈRE de l'artiste (story 11.10), tenue à part de sa fiche
    // éditoriale : ce ne sont ni les mêmes données ni les mêmes personnes qui
    // les saisissent.
    beneficiaryId: uuid("beneficiary_id"),

    // SEO
    metaTitle: varchar("meta_title", { length: 255 }),
    metaDescription: varchar("meta_description", { length: 500 }),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    index("idx_artists_slug").on(t.slug),
    foreignKey({ columns: [t.beneficiaryId], foreignColumns: [beneficiaries.id] }).onDelete("set null"),
  ],
)

export const artworkThemes = pgTable(
  "artwork_themes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 100 }).unique().notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    displayOrder: integer("display_order").default(0),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [index("idx_artwork_themes_order").on(t.displayOrder)],
)

export const artworkSeries = pgTable(
  "artwork_series",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 255 }).unique().notNull(),
    title: varchar("title", { length: 255 }).notNull(),

    // Le texte de présentation : ce qui fait de la série une unité éditoriale
    // et non un simple regroupement.
    intro: text("intro"),
    // Le film ou l'univers dont la série s'inspire, en clair.
    reference: varchar("reference", { length: 255 }),

    themeId: uuid("theme_id"),
    artistId: uuid("artist_id"),

    coverImageUrl: varchar("cover_image_url", { length: 512 }),
    displayOrder: integer("display_order").default(0),
    published: boolean("published").default(false),

    // SEO
    metaTitle: varchar("meta_title", { length: 255 }),
    metaDescription: varchar("meta_description", { length: 500 }),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    index("idx_artwork_series_slug").on(t.slug),
    index("idx_artwork_series_theme").on(t.themeId, t.displayOrder),
    index("idx_artwork_series_published").on(t.published),
    // Une série survit à la suppression de son thème ou de son artiste : elle
    // reste publiable, seule sa navigation éditoriale se vide.
    foreignKey({ columns: [t.themeId], foreignColumns: [artworkThemes.id] }).onDelete("set null"),
    foreignKey({ columns: [t.artistId], foreignColumns: [artists.id] }).onDelete("set null"),
  ],
)

export const artistsRelations = relations(artists, ({ many }) => ({
  series: many(artworkSeries),
  artworks: many(artworks),
}))

export const artworkThemesRelations = relations(artworkThemes, ({ many }) => ({
  series: many(artworkSeries),
}))

export const artworkSeriesRelations = relations(artworkSeries, ({ one, many }) => ({
  theme: one(artworkThemes, { fields: [artworkSeries.themeId], references: [artworkThemes.id] }),
  artist: one(artists, { fields: [artworkSeries.artistId], references: [artists.id] }),
  artworks: many(artworks),
}))

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

    // Artiste & série (story 11.6) — la bio de l'artiste vivait ici, dupliquée
    // sur chaque œuvre ; elle vit désormais dans `artists`, source unique.
    artistId: uuid("artist_id"),
    seriesId: uuid("series_id"),
    // Rang de l'œuvre DANS sa série : une série se lit dans un ordre voulu.
    seriesOrder: integer("series_order").default(0),

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

    // Rentabilité (story 11.10). Le bénéficiaire d'une œuvre n'est pas répété
    // ici : c'est celui de son ARTISTE (`artists.beneficiary_id`). Seul le taux
    // peut être renégocié pièce par pièce.
    costPriceHt: decimal("cost_price_ht", { precision: 10, scale: 2 }),
    chargesPct: decimal("charges_pct", { precision: 5, scale: 2 }),
    chargesAmountHt: decimal("charges_amount_ht", { precision: 10, scale: 2 }),
    beneficiarySharePct: decimal("beneficiary_share_pct", { precision: 5, scale: 2 }),

    // Certificat
    certificateTemplateUrl: varchar("certificate_template_url", { length: 512 }),
    includeCertificate: boolean("include_certificate").default(true),

    // Médias
    featuredImageUrl: varchar("featured_image_url", { length: 512 }),
    imagesCount: integer("images_count").default(0),
    // Orientation de l'image ("portrait" | "landscape" | "square") — pilote le
    // ratio des cartes et du détail côté front. Propriété de l'image, pas du
    // format papier, donc stockée explicitement (cf. shared/artwork.ts).
    orientation: varchar("orientation", { length: 16 }).notNull().default("portrait"),

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

    // Recherche full-text (généré: title pondéré A, artist_name B, description C)
    // ⚠️ Une colonne générée ne peut lire que SA propre ligne : le nom de
    // l'artiste ayant quitté la table, il ne peut plus être indexé ici. La
    // recherche globale le rattrape en joignant `artists` (cf. search/global.ts),
    // donc « Sylvain » retrouve toujours ses œuvres.
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('french', coalesce(title, '')), 'A') || setweight(to_tsvector('french', coalesce(description, '')), 'C')`,
    ),

    // Métadonnées
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
     index("idx_artworks_slug").on(t.slug),
     index("idx_artworks_published").on(t.published),
     index("idx_artworks_available").on(t.availableFrom, t.availableUntil),
     index("idx_artworks_search").using("gin", t.searchVector),
     index("idx_artworks_series").on(t.seriesId, t.seriesOrder),
     index("idx_artworks_artist").on(t.artistId),
     foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
    }).onDelete("cascade"),
     // Une œuvre survit à la suppression de sa série ou de son artiste : elle
     // reste vendable, elle perd seulement son rattachement éditorial.
     foreignKey({ columns: [t.artistId], foreignColumns: [artists.id] }).onDelete("set null"),
     foreignKey({ columns: [t.seriesId], foreignColumns: [artworkSeries.id] }).onDelete("set null"),
  ],
)

export const artworksRelations = relations(artworks, ({ one, many }) => ({
  product: one(products, {
    fields: [artworks.productId],
    references: [products.id],
  }),
  artist: one(artists, { fields: [artworks.artistId], references: [artists.id] }),
  series: one(artworkSeries, { fields: [artworks.seriesId], references: [artworkSeries.id] }),
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
          // Tag slugs at purchase time (story 11.1). Absent on pre-11.1 orders,
          // whose state was carried by `category` — see isNewFirearmQualifying.
          tags?: string[]
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

// ============================================================================
// BÉNÉFICIAIRES & REVERSEMENTS (story 11.10)
// ============================================================================
// Deux tiers sont rémunérés sur les ventes, et la mécanique est la même :
//   - **Sylvain** (artiste Gun Art) : le site vend **pour son compte**, il touche
//     une part de chaque tirage vendu ;
//   - **Florian** (conseil) : Fred et Steph achètent les armes de collection sur
//     ses conseils et lui reversent une commission **sur la vente**.
// Un seul aujourd'hui de chaque côté, plusieurs possibles demain — d'où une
// entité dédiée plutôt que deux champs taillés sur mesure.
//
// La fiche `artists` (11.6) reste **éditoriale** (bio, parcours, livre) et pointe
// vers son identité **financière** ici : les deux ne se gèrent pas au même
// endroit ni par les mêmes personnes.
export const payoutStatusEnum = pgEnum("payout_status", ["pending", "due", "paid", "cancelled"])

/**
 * Ce qui est dû à un bénéficiaire sur une vente.
 *
 * ⚠️ Le taux, la base et le montant sont **figés à la commande** — même principe
 * que l'instantané `orders.items_json` : changer un taux demain ne doit jamais
 * réécrire ce qui était dû sur une vente d'hier.
 *
 * ⚠️ Les lignes de commande ne vivent PAS dans `order_items` (inutilisée au
 * tunnel) mais dans `orders.items_json`. Une ligne de reversement désigne donc
 * la sienne par `variant_id` (armurerie) ou `print_id` (Gun Art), et en conserve
 * le libellé.
 */
export const beneficiaryPayouts = pgTable(
  "beneficiary_payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull(),
    beneficiaryId: uuid("beneficiary_id").notNull(),

    variantId: uuid("variant_id"),
    printId: uuid("print_id"),
    label: varchar("label", { length: 255 }).notNull(),

    sharePct: decimal("share_pct", { precision: 5, scale: 2 }).notNull(),
    /** Assiette HT, nette de remboursement — la TVA n'est pas du chiffre d'affaires. */
    baseHt: decimal("base_ht", { precision: 10, scale: 2 }).notNull(),
    amountHt: decimal("amount_ht", { precision: 10, scale: 2 }).notNull(),

    // pending : la commande n'est pas payée, rien n'est encore dû.
    // due     : encaissée, le reversement est exigible.
    // paid    : versé.
    // cancelled : commande annulée ou intégralement remboursée.
    status: payoutStatusEnum("status").notNull().default("pending"),
    paidAt: timestamp("paid_at"),
    paidNotes: text("paid_notes"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    index("idx_payouts_beneficiary").on(t.beneficiaryId, t.status),
    index("idx_payouts_order").on(t.orderId),
    foreignKey({ columns: [t.orderId], foreignColumns: [orders.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.beneficiaryId], foreignColumns: [beneficiaries.id] }),
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
    bicRecipient: varchar("bic_recipient", { length: 11 }),
    bankName: varchar("bank_name", { length: 255 }),
    accountHolderName: varchar("account_holder_name", { length: 255 }),
    paymentReference: varchar("payment_reference", { length: 100 }).unique(),

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
// 8b. REMBOURSEMENTS (Story 6.4) — one row per refund action, on either bucket
// ============================================================================
export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull(),
    channel: refundChannelEnum("channel").notNull(),
    amountTtc: decimal("amount_ttc", { precision: 10, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("EUR"),
    reason: varchar("reason", { length: 255 }),
    notes: text("notes"),

    status: refundStatusEnum("status").notNull().default("pending"),
    // Set for card refunds; null for manually-recorded bank-transfer refunds.
    stripeRefundId: varchar("stripe_refund_id", { length: 255 }).unique(),
    failureReason: text("failure_reason"),

    initiatedBy: uuid("initiated_by"),
    processedAt: timestamp("processed_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    index("idx_refunds_order").on(t.orderId),
    index("idx_refunds_status").on(t.status),
    foreignKey({ columns: [t.orderId], foreignColumns: [orders.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.initiatedBy], foreignColumns: [users.id] }),
  ],
)

export const refundsRelations = relations(refunds, ({ one }) => ({
  order: one(orders, {
    fields: [refunds.orderId],
    references: [orders.id],
  }),
  initiatedByUser: one(users, {
    fields: [refunds.initiatedBy],
    references: [users.id],
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
    }).onDelete("set null"),
  ],
)

export const blogPostsRelations = relations(blogPosts, ({ one }) => ({
  author: one(users, {
    fields: [blogPosts.authorId],
    references: [users.id],
  }),
}))

// ============================================================================
// 12. NEWSLETTER (story 11.4) — contact unique, N abonnements segmentés
// ============================================================================
//
// Modèle : **un contact porte N abonnements** (un par univers), et non un
// contact par liste. Le consentement est donc horodaté *par segment*, et un
// désabonnement peut viser un seul univers sans toucher aux autres.
//
// RGPD : l'adresse n'est conservée que tant qu'un consentement est actif. Au
// désabonnement total elle est **effacée** ; la ligne survit anonymisée (hash +
// horodatages) pour pouvoir prouver qu'un consentement a existé puis a été
// retiré, sans conserver de donnée personnelle exploitable.

export const newsletterSegmentEnum = pgEnum("newsletter_segment", ["armurerie", "collection", "gun_art"])
export const newsletterSubscriptionStatusEnum = pgEnum("newsletter_subscription_status", [
  "pending",
  "confirmed",
  "unsubscribed",
])
export const newsletterTokenPurposeEnum = pgEnum("newsletter_token_purpose", ["confirm", "unsubscribe"])

export const newsletterContacts = pgTable(
  "newsletter_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable **par conception** : purgée au désabonnement total. Postgres
    // autorise plusieurs NULL sous un index unique, donc les traces anonymisées
    // coexistent sans se marcher dessus.
    email: varchar("email", { length: 255 }),
    // SHA-256 de l'adresse normalisée. Clé d'identité stable : elle survit à la
    // purge, ce qui permet à la fois de retrouver un contact qui se réabonne et
    // de prouver l'historique de consentement sans stocker l'adresse.
    emailHash: varchar("email_hash", { length: 64 }).notNull().unique(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    // Renseigné quand plus aucun segment n'est actif (adresse purgée).
    unsubscribedAt: timestamp("unsubscribed_at"),
  },
  (t) => [uniqueIndex("uq_newsletter_contacts_email").on(t.email)],
)

export const newsletterSubscriptions = pgTable(
  "newsletter_subscriptions",
  {
    contactId: uuid("contact_id").notNull(),
    segment: newsletterSegmentEnum("segment").notNull(),
    status: newsletterSubscriptionStatusEnum("status").notNull().default("pending"),
    // Preuve de consentement, exigible par la CNIL : quand il a été donné, quand
    // il a été confirmé (double opt-in), d'où il vient et depuis quel navigateur.
    requestedAt: timestamp("requested_at").notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at"),
    unsubscribedAt: timestamp("unsubscribed_at"),
    consentSource: varchar("consent_source", { length: 255 }),
    consentIp: varchar("consent_ip", { length: 45 }),
    consentUserAgent: text("consent_user_agent"),
    // Dernière synchronisation réussie vers le fournisseur d'envoi. Notre base
    // reste la source de vérité : un échec Brevo ne bloque pas le consentement.
    providerSyncedAt: timestamp("provider_synced_at"),
  },
  (t) => [
    primaryKey({ columns: [t.contactId, t.segment] }),
    foreignKey({ columns: [t.contactId], foreignColumns: [newsletterContacts.id] }).onDelete("cascade"),
    index("idx_newsletter_subscriptions_segment").on(t.segment, t.status),
  ],
)

// Jetons de lien opaques, stockés **hachés** (comme les jetons de mot de passe) :
// une fuite de la base ne permet pas de confirmer ni de désabonner à la place
// d'un tiers. `expires_at` est nul pour un jeton de désabonnement, qui voyage
// dans chaque envoi et doit rester valable tant que l'adresse existe.
export const newsletterTokens = pgTable(
  "newsletter_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    purpose: newsletterTokenPurposeEnum("purpose").notNull(),
    expiresAt: timestamp("expires_at"),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    index("idx_newsletter_tokens_contact").on(t.contactId, t.purpose),
    foreignKey({ columns: [t.contactId], foreignColumns: [newsletterContacts.id] }).onDelete("cascade"),
  ],
)

export const newsletterContactsRelations = relations(newsletterContacts, ({ many }) => ({
  subscriptions: many(newsletterSubscriptions),
  tokens: many(newsletterTokens),
}))

export const newsletterSubscriptionsRelations = relations(newsletterSubscriptions, ({ one }) => ({
  contact: one(newsletterContacts, {
    fields: [newsletterSubscriptions.contactId],
    references: [newsletterContacts.id],
  }),
}))

export const newsletterTokensRelations = relations(newsletterTokens, ({ one }) => ({
  contact: one(newsletterContacts, {
    fields: [newsletterTokens.contactId],
    references: [newsletterContacts.id],
  }),
}))
