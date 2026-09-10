import { z } from "zod"
import { ARTWORK_ORIENTATIONS } from "./artwork.js"
import {
  ADDRESS_TYPES,
  LEGAL_CATEGORIES,
  LEGAL_DOC_REJECTION_REASONS,
  LEGAL_DOC_TYPES,
  LEGAL_DOC_VERIFICATION_STATUS,
  MAX_TAG_FILTERS,
  TAG_FACETS,
} from "./constants.js"
import { NEWSLETTER_SEGMENTS } from "./newsletter.js"
import { ORDER_LEGAL_STATUSES, ORDER_PAYMENT_STATUSES, REFUND_CHANNELS } from "./orders.js"

export const emailSchema = z.string().email().max(255)
export const passwordSchema = z.string().min(12).max(128)
export const phoneSchema = z
  .string()
  .min(6)
  .max(20)
  .regex(/^[+0-9 ().-]+$/, "Invalid phone format")

export const CURRENT_RGPD_CONSENT_VERSION = "1.0"

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: phoneSchema.optional(),
  rgpdConsent: z.literal(true, { message: "RGPD consent is required" }),
})

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
  deviceLabel: z.string().max(255).optional(),
})

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(256),
})

export const logoutSchema = refreshSchema

export const updateProfileSchema = z
  .object({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    phone: phoneSchema.optional().nullable(),
    addressStreet: z.string().max(255).optional().nullable(),
    addressPostal: z.string().max(10).optional().nullable(),
    addressCity: z.string().max(100).optional().nullable(),
    addressCountry: z.string().length(2).optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, {
    message: "At least one field must be provided",
  })

export const forgotPasswordSchema = z.object({
  email: emailSchema,
})

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(256),
  password: passwordSchema,
})

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

export const cartItemSchema = z
  .object({
    variantId: z.string().uuid().optional(),
    printId: z.string().uuid().optional(),
    qty: z.number().int().positive().max(10),
  })
  .refine((d) => Boolean(d.variantId) !== Boolean(d.printId), {
    message: "Either variantId or printId must be provided, not both",
  })

// Update the quantity of an existing (product-variant) cart line.
export const updateCartItemSchema = z.object({
  qty: z.number().int().positive().max(10),
})

export type AddCartItemInput = z.infer<typeof cartItemSchema>
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>

// Address book entry (create)
export const createAddressSchema = z
  .object({
    label: z.string().max(100).optional(),
    type: z.enum(ADDRESS_TYPES).optional().default("both"),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    line1: z.string().min(1).max(255),
    line2: z.string().max(255).optional(),
    postal: z.string().min(1).max(10),
    city: z.string().min(1).max(100),
    country: z.string().length(2).optional().default("FR"),
    phone: phoneSchema.optional(),
    isDefault: z.boolean().optional(),
  })
  .strict()

// Address book entry (partial update — defaults intentionally omitted)
export const updateAddressSchema = z
  .object({
    label: z.string().max(100).nullable().optional(),
    type: z.enum(ADDRESS_TYPES).optional(),
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    line1: z.string().min(1).max(255).optional(),
    line2: z.string().max(255).nullable().optional(),
    postal: z.string().min(1).max(10).optional(),
    city: z.string().min(1).max(100).optional(),
    country: z.string().length(2).optional(),
    phone: phoneSchema.nullable().optional(),
    isDefault: z.boolean().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, {
    message: "At least one field must be provided",
  })

export type CreateAddressInput = z.infer<typeof createAddressSchema>
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>

// Order is built from the server-side cart; the body only carries address references
export const createOrderSchema = z
  .object({
    shippingAddressId: z.string().uuid(),
    billingAddressId: z.string().uuid().optional(),
  })
  .strict()

// Legal document metadata (the non-file fields of the multipart upload).
// Multipart values arrive as strings, so dates are validated as ISO YYYY-MM-DD.
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD)")

export const legalDocumentMetaSchema = z
  .object({
    docType: z.enum(LEGAL_DOC_TYPES),
    docNumber: z.string().min(1).max(100).optional(),
    issuedAt: isoDateSchema.optional(),
    expiresAt: isoDateSchema.optional(),
  })
  .strict()
  .refine((d) => d.issuedAt === undefined || d.expiresAt === undefined || d.expiresAt >= d.issuedAt, {
    message: "expiresAt must be on or after issuedAt",
    path: ["expiresAt"],
  })

export type LegalDocumentMetaInput = z.infer<typeof legalDocumentMetaSchema>

// Admin review queue filters (status defaults to the actionable pending queue)
export const legalDocQueueQuerySchema = z.object({
  status: z.enum([...LEGAL_DOC_VERIFICATION_STATUS, "all"]).default("pending"),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

export type LegalDocQueueQuery = z.infer<typeof legalDocQueueQuerySchema>

// Admin rejection of a legal document — "other" must be explained in notes
export const rejectLegalDocumentSchema = z
  .object({
    reason: z.enum(LEGAL_DOC_REJECTION_REASONS),
    notes: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .refine((d) => d.reason !== "other" || d.notes !== undefined, {
    message: 'notes are required when the reason is "other"',
    path: ["notes"],
  })

export type RejectLegalDocumentInput = z.infer<typeof rejectLegalDocumentSchema>

// Product category slug (references product_categories.slug, e.g. "arme-poing")
export const categorySlugSchema = z
  .string()
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid category slug")

// Tag slug (references tags.slug, e.g. "occasion", "avant-1900")
export const tagSlugSchema = z
  .string()
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid tag slug")

// `?tags=` accepts both a comma-separated list (`?tags=occasion,avant-1900`) and
// repeated params (`?tags=occasion&tags=avant-1900`), because Fastify hands us a
// string for one occurrence and an array for several. Duplicates are collapsed,
// and an empty selection normalises to `undefined` so `?tags=` behaves like no
// filter at all rather than "match nothing".
const tagsFilterSchema = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined
  const entries = (Array.isArray(value) ? value : [value])
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return entries.length > 0 ? [...new Set(entries)] : undefined
}, z.array(tagSlugSchema).max(MAX_TAG_FILTERS).optional())

export const productFiltersSchema = z
  .object({
    category: categorySlugSchema.optional(),
    tags: tagsFilterSchema,
    legalCategory: z.enum(LEGAL_CATEGORIES).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    minPrice: z.coerce.number().nonnegative().optional(),
    maxPrice: z.coerce.number().nonnegative().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .refine((f) => f.minPrice === undefined || f.maxPrice === undefined || f.maxPrice >= f.minPrice, {
    message: "maxPrice must be greater than or equal to minPrice",
    path: ["maxPrice"],
  })

// Collection-weapon listing filters. Narrower than the catalogue's: a visitor
// browsing the collection universe filters by period/state tag, legal category
// and availability — price and free-text search belong to the main catalogue.
export const ancientWeaponFiltersSchema = z.object({
  tags: tagsFilterSchema,
  legalCategory: z.enum(LEGAL_CATEGORIES).optional(),
  // Tri-state: omitted shows everything, including sold pieces — a sold
  // historical weapon stays on display (story 11.3).
  available: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === "true")),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

export type AncientWeaponFilters = z.infer<typeof ancientWeaponFiltersSchema>

// --- Admin: collection weapons (story 11.2) -------------------------------
// A collection weapon is one product row plus one ancient_weapons row; the API
// takes them as a single payload because they are never useful apart.

const ANCIENT_CONDITIONS = ["excellent", "bon", "moyen", "restaure"] as const
export const ANCIENT_WEAPON_CONDITIONS: readonly string[] = ANCIENT_CONDITIONS

const historicalInfoSchema = z.object({
  battles: z.array(z.string().max(200)).max(20).optional(),
  owners: z.array(z.string().max(200)).max(20).optional(),
  events: z.array(z.string().max(200)).max(20).optional(),
  notes: z.string().max(5000).optional(),
})

export const createAncientWeaponSchema = z.object({
  sku: z.string().trim().min(1).max(100),
  slug: categorySlugSchema,
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(1000).optional(),
  // The client asked for roughly thirty lines telling the weapon's story, so
  // this is the field that actually carries the piece's value.
  longDescription: z.string().trim().max(20000).optional(),
  categorySlug: categorySlugSchema,
  legalCategory: z.enum(LEGAL_CATEGORIES),
  priceHt: z.coerce.number().positive(),
  featuredImageUrl: z.string().url().max(512).optional(),
  published: z.boolean().default(false),
  tagSlugs: z.array(tagSlugSchema).max(MAX_TAG_FILTERS).default([]),

  period: z.string().trim().max(100).optional(),
  periodStartYear: z.coerce.number().int().min(1000).max(2100).optional(),
  periodEndYear: z.coerce.number().int().min(1000).max(2100).optional(),
  provenance: z.string().trim().max(500).optional(),
  makerName: z.string().trim().max(255).optional(),
  makerLocation: z.string().trim().max(255).optional(),
  condition: z.enum(ANCIENT_CONDITIONS),
  conditionDescription: z.string().trim().max(5000).optional(),
  restorationInfo: z.string().trim().max(5000).optional(),
  isAuthentic: z.boolean().default(false),
  expertName: z.string().trim().max(255).optional(),
  expertDate: z.string().date().optional(),
  historicalInfo: historicalInfoSchema.optional(),
})

export type CreateAncientWeaponInput = z.infer<typeof createAncientWeaponSchema>

// Every field optional, but `sku`/`slug`/`categorySlug` are deliberately absent:
// changing them would break indexed URLs and the variant SKU derived from them.
export const updateAncientWeaponSchema = createAncientWeaponSchema
  .omit({ sku: true, slug: true, categorySlug: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "At least one field must be provided" })

export type UpdateAncientWeaponInput = z.infer<typeof updateAncientWeaponSchema>

// Generic pagination query (page/limit, max 100)
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

export type PaginationInput = z.infer<typeof paginationSchema>

// Generic UUID route param `{ id }` (e.g. GET /api/products/:id, cart item id)
export const uuidParamSchema = z.object({
  id: z.string().uuid(),
})

export type UuidParam = z.infer<typeof uuidParamSchema>

// Story 6.1 — initiate a Stripe card payment for an order
export const createStripePaymentSchema = z.object({
  orderId: z.string().uuid(),
})

export type CreateStripePaymentInput = z.infer<typeof createStripePaymentSchema>

// Story 6.3 — bank-transfer reconciliation

// A positive money amount accepted from a JSON body (number) and pinned to cents.
const moneyAmountSchema = z.coerce
  .number()
  .positive()
  .max(10_000_000)
  .refine((n) => Number.isFinite(n), "Invalid amount")

// Customer declares "I have sent the transfer". Every field is optional — it is
// a helpful heads-up for the admin, not authoritative; the bank statement is.
export const claimVirementSchema = z
  .object({
    reportedIban: z.string().trim().min(8).max(50).optional(),
    reportedDate: isoDateSchema.optional(),
    reportedAmount: moneyAmountSchema.optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict()

export type ClaimVirementInput = z.infer<typeof claimVirementSchema>

// Admin queue filter for bank-transfer buckets awaiting / under reconciliation.
export const VIREMENT_RECONCILE_STATUSES = [
  "awaiting_transfer",
  "transfer_claimed",
  "reconciled",
  "failed",
  "cancelled",
] as const

export const virementQueueQuerySchema = z.object({
  status: z.enum([...VIREMENT_RECONCILE_STATUSES, "all"]).default("awaiting_transfer"),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

export type VirementQueueQuery = z.infer<typeof virementQueueQuerySchema>

// Admin manually marks a bank-transfer bucket as received & reconciled.
export const reconcileVirementSchema = z
  .object({
    amountReceived: moneyAmountSchema,
    receivedFromIban: z.string().trim().min(8).max(50).optional(),
    receivedAt: isoDateSchema.optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict()

export type ReconcileVirementInput = z.infer<typeof reconcileVirementSchema>

// Admin uploads a bank statement CSV for automatic matching by reference.
export const importBankStatementSchema = z
  .object({
    csv: z.string().min(1).max(2_000_000),
  })
  .strict()

export type ImportBankStatementInput = z.infer<typeof importBankStatementSchema>

// Story 6.4 — admin issues a refund on a paid order, per channel (card/transfer).
// `amount` is the gross (TTC) amount to return; the service caps it at what is
// still refundable on that channel.
export const createRefundSchema = z
  .object({
    channel: z.enum(REFUND_CHANNELS),
    amount: moneyAmountSchema,
    reason: z.string().trim().min(1).max(255).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict()

export type CreateRefundInput = z.infer<typeof createRefundSchema>

// Story 7.1 — admin orders list filters. `search` matches the customer email.
export const adminOrderQuerySchema = z.object({
  paymentStatus: z.enum(ORDER_PAYMENT_STATUSES).optional(),
  legalStatus: z.enum(ORDER_LEGAL_STATUSES).optional(),
  search: z.string().trim().min(1).max(255).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

export type AdminOrderQuery = z.infer<typeof adminOrderQuerySchema>

// Story 7.3 — admin metrics period. ISO dates (YYYY-MM-DD); both optional, the
// route defaults to a trailing window and enforces from <= to.
export const adminMetricsQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .refine((d) => d.from === undefined || d.to === undefined || d.from <= d.to, {
    message: "from must be on or before to",
    path: ["from"],
  })

export type AdminMetricsQuery = z.infer<typeof adminMetricsQuerySchema>

// Story 9.1 — global search query (firearms catalogue + Gun Art). `q` is the
// full-text term; `limit` caps results returned *per source*.
export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().positive().max(50).default(10),
})

export type SearchQuery = z.infer<typeof searchQuerySchema>

// Backwards-compatible alias used by the product detail route
export const productIdParamSchema = uuidParamSchema

export type ProductIdParam = z.infer<typeof productIdParamSchema>

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type RefreshInput = z.infer<typeof refreshSchema>
export type CreateOrderInput = z.infer<typeof createOrderSchema>
export type ProductFilters = z.infer<typeof productFiltersSchema>

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>

export type AuthTokens = {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

// ============================================================================
// Story 9.4 — Blog (SEO-first). The `blog_posts` table backs an editorial
// section authored from the backoffice. `content` is sanitised HTML authored by
// an admin; `excerpt` feeds cards and the meta description.

// Blog post slug (references blog_posts.slug, e.g. "histoire-du-luger-p08").
export const blogSlugSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid blog slug")

// Admin list query: optional published filter + free-text search, paginated.
export const blogQuerySchema = z.object({
  // `published` arrives as a string on the query string; coerce the two literals.
  published: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  search: z.string().trim().min(1).max(255).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

export type BlogQuery = z.infer<typeof blogQuerySchema>

// Create a blog post (admin). `authorId` is taken from the session, never the body.
export const blogArticleCreateSchema = z
  .object({
    slug: blogSlugSchema,
    title: z.string().min(1).max(255),
    excerpt: z.string().max(500).nullable().optional(),
    content: z.string().min(1),
    category: z.string().max(100).nullable().optional(),
    tags: z.string().max(500).nullable().optional(),
    featuredImageUrl: z.string().url().max(512).nullable().optional(),
    metaTitle: z.string().max(255).nullable().optional(),
    metaDescription: z.string().max(500).nullable().optional(),
    published: z.boolean().optional().default(false),
    featured: z.boolean().optional().default(false),
  })
  .strict()

// Partial update (admin) — at least one field; defaults intentionally omitted.
export const blogArticleUpdateSchema = z
  .object({
    slug: blogSlugSchema.optional(),
    title: z.string().min(1).max(255).optional(),
    excerpt: z.string().max(500).nullable().optional(),
    content: z.string().min(1).optional(),
    category: z.string().max(100).nullable().optional(),
    tags: z.string().max(500).nullable().optional(),
    featuredImageUrl: z.string().url().max(512).nullable().optional(),
    metaTitle: z.string().max(255).nullable().optional(),
    metaDescription: z.string().max(500).nullable().optional(),
    published: z.boolean().optional(),
    featured: z.boolean().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, {
    message: "At least one field must be provided",
  })

export type BlogArticleCreateInput = z.infer<typeof blogArticleCreateSchema>
export type BlogArticleUpdateInput = z.infer<typeof blogArticleUpdateSchema>

// ---------------------------------------------------------------------------
// Newsletter (story 11.4)
// ---------------------------------------------------------------------------

// One opt-in covers one or more segments, never "all of them by default": the
// form pre-checks at most the segment the visitor came from, and an empty
// selection is a validation error rather than a silent subscribe-to-everything.
const newsletterSegmentsSchema = z
  .array(z.enum(NEWSLETTER_SEGMENTS))
  .min(1, "Select at least one newsletter")
  .max(NEWSLETTER_SEGMENTS.length)
  .transform((segments) => [...new Set(segments)])

// Opaque, single-use link token (base64url of 32 random bytes). Bounded so a
// bogus value is rejected before it ever reaches a hash + DB lookup.
export const newsletterTokenSchema = z
  .string()
  .min(20)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid token")

export const newsletterSubscribeSchema = z
  .object({
    email: emailSchema,
    segments: newsletterSegmentsSchema,
    // Explicit, affirmative consent — the checkbox that makes the opt-in lawful.
    // `literal(true)` means an unticked box cannot be coerced into a yes.
    consent: z.literal(true, { message: "Consent is required" }),
    // Where the address was captured (a page path), stored with the consent so
    // it stays provable months later. Never a full URL: no query string, no PII.
    source: z
      .string()
      .max(255)
      .regex(/^\/[A-Za-z0-9/_-]*$/, "Source must be a site path")
      .optional(),
  })
  .strict()

export const newsletterConfirmSchema = z.object({ token: newsletterTokenSchema }).strict()

// Omitting `segments` withdraws consent entirely (the "unsubscribe from
// everything" link); passing a subset unsubscribes only those.
export const newsletterUnsubscribeSchema = z
  .object({
    token: newsletterTokenSchema,
    segments: newsletterSegmentsSchema.optional(),
  })
  .strict()

export type NewsletterSubscribeInput = z.infer<typeof newsletterSubscribeSchema>
export type NewsletterUnsubscribeInput = z.infer<typeof newsletterUnsubscribeSchema>

// --- Gun Art price simulator (story 11.7) ---

// The simulated grid is `editionLimit x formats` cells wide, so both dimensions
// are bounded: they size the response, not just the input. 250 prints is far
// above the 25 the client works with, and 10 formats far above his 3 to 4.
export const artworkPriceFormatSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(100),
    widthCm: z.number().positive().max(1000).optional(),
    heightCm: z.number().positive().max(1000).optional(),
    priceFactor: z.number().positive().max(100),
  })
  .strict()

export const artworkPriceGridSchema = z
  .object({
    basePriceHt: z.number().min(0).max(1_000_000),
    priceIncrementHt: z.number().min(0).max(1_000_000),
    editionLimit: z.number().int().min(1).max(250),
    vatPct: z.number().min(0).max(100).default(20),
    formats: z.array(artworkPriceFormatSchema).min(1).max(10),
  })
  .strict()
  // Ids address the cells of the returned grid, so two formats sharing one would
  // make the simulator ambiguous rather than merely wrong.
  .refine((v) => new Set(v.formats.map((f) => f.id)).size === v.formats.length, {
    message: "Format ids must be unique",
    path: ["formats"],
  })

export type ArtworkPriceGridInput = z.infer<typeof artworkPriceGridSchema>

// ===========================================================================
// Admin catalogue CRUD (story 7.5a)
// ===========================================================================
// The backoffice is the only way content gets in — nobody is going to write SQL.
// Every schema below is the single gate an entity passes through on the way in,
// shared by the API (which enforces it) and the admin forms (which mirror it).

/** A public-facing slug. Lower-case only: every slug route in the API rejects the rest. */
export const entitySlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid slug (lower-case words separated by single dashes)")

/** Optional free text that must be either absent or non-empty — never an empty string in the DB. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? undefined : v))
    .optional()

const optionalUrl = z
  .string()
  .trim()
  .max(512)
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional()
  .refine((v) => v === undefined || /^https?:\/\//.test(v) || v.startsWith("/"), {
    message: "Must be an absolute http(s) URL or a site-relative path",
  })

// --- Artists ---------------------------------------------------------------

export const createArtistSchema = z
  .object({
    slug: entitySlugSchema,
    name: z.string().trim().min(1).max(255),
    headline: optionalText(255),
    bio: optionalText(20000),
    journey: optionalText(20000),
    portraitUrl: optionalUrl,
    bookTitle: optionalText(255),
    // Affiliate link, rendered rel="sponsored noopener" — see the artist page.
    bookUrl: optionalUrl,
    published: z.boolean().default(false),
    /** Identité financière de l'artiste (story 11.10), tenue à part de l'éditorial. */
    beneficiaryId: z.string().uuid().nullish(),
    metaTitle: optionalText(255),
    metaDescription: optionalText(500),
  })
  .strict()

export const updateArtistSchema = createArtistSchema
  .omit({ slug: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "At least one field must be provided" })

export type CreateArtistInput = z.infer<typeof createArtistSchema>
export type UpdateArtistInput = z.infer<typeof updateArtistSchema>

// --- Artwork themes --------------------------------------------------------

export const createArtworkThemeSchema = z
  .object({
    slug: entitySlugSchema,
    name: z.string().trim().min(1).max(100),
    description: optionalText(5000),
    displayOrder: z.coerce.number().int().min(0).max(9999).default(0),
  })
  .strict()

export const updateArtworkThemeSchema = createArtworkThemeSchema
  .omit({ slug: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "At least one field must be provided" })

export type CreateArtworkThemeInput = z.infer<typeof createArtworkThemeSchema>
export type UpdateArtworkThemeInput = z.infer<typeof updateArtworkThemeSchema>

// --- Artwork series --------------------------------------------------------

export const createArtworkSeriesSchema = z
  .object({
    slug: entitySlugSchema,
    title: z.string().trim().min(1).max(255),
    intro: optionalText(20000),
    // The film or universe the series draws on, in plain words.
    reference: optionalText(255),
    themeId: z.string().uuid().nullish(),
    artistId: z.string().uuid().nullish(),
    coverImageUrl: optionalUrl,
    displayOrder: z.coerce.number().int().min(0).max(9999).default(0),
    published: z.boolean().default(false),
    metaTitle: optionalText(255),
    metaDescription: optionalText(500),
  })
  .strict()

export const updateArtworkSeriesSchema = createArtworkSeriesSchema
  .omit({ slug: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "At least one field must be provided" })

export type CreateArtworkSeriesInput = z.infer<typeof createArtworkSeriesSchema>
export type UpdateArtworkSeriesInput = z.infer<typeof updateArtworkSeriesSchema>

// --- Artworks --------------------------------------------------------------

/** A purchasable size. `priceFactor` scales the base price; the 11.7 guard rail validates the set. */
export const artworkFormatSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(100),
    widthCm: z.coerce.number().positive().max(1000),
    heightCm: z.coerce.number().positive().max(1000),
    priceFactor: z.coerce.number().positive().max(100),
  })
  .strict()

// ⚠️ The refinement lives on the *derived* schemas, never on the base: zod 4
// refuses `.omit()` on a refined object — and it refuses it at RUNTIME, while
// the types still check. The base object is therefore kept plain.
const artworkBaseSchema = z
  .object({
    sku: z.string().trim().min(1).max(100),
    slug: entitySlugSchema,
    title: z.string().trim().min(1).max(255),
    description: optionalText(1000),
    longDescription: optionalText(20000),

    artistId: z.string().uuid().nullish(),
    seriesId: z.string().uuid().nullish(),
    seriesOrder: z.coerce.number().int().min(0).max(9999).default(0),

    // The edition is counted ACROSS formats: `editionLimit` prints in total, not
    // per format. Capped at the same 250 as the price simulator.
    editionLimit: z.coerce.number().int().min(1).max(250),
    editionYear: z.coerce.number().int().min(1800).max(2200).nullish(),
    availableFormats: z.array(artworkFormatSchema).min(1).max(10),

    basePriceHt: z.coerce.number().min(0).max(1_000_000),
    priceIncrementHt: z.coerce.number().min(0).max(1_000_000),
    vatPct: z.coerce.number().min(0).max(100).default(20),

    // Rentabilité (story 11.10). Le bénéficiaire vient de l'ARTISTE ; seul le
    // taux se renégocie pièce par pièce.
    costPriceHt: z.coerce.number().min(0).max(10_000_000).nullish(),
    chargesPct: z.coerce.number().min(0).max(100).nullish(),
    chargesAmountHt: z.coerce.number().min(0).max(10_000_000).nullish(),
    beneficiarySharePct: z.coerce.number().min(0).max(100).nullish(),

    orientation: z.enum(ARTWORK_ORIENTATIONS).default("portrait"),
    includeCertificate: z.boolean().default(true),
    featuredImageUrl: optionalUrl,
    published: z.boolean().default(false),
    featured: z.boolean().default(false),

    metaTitle: optionalText(255),
    metaDescription: optionalText(500),
  })
  .strict()

const uniqueFormatIds = {
  message: "Format ids must be unique",
  path: ["availableFormats"],
}

export const createArtworkSchema = artworkBaseSchema.refine(
  (v) => new Set(v.availableFormats.map((f) => f.id)).size === v.availableFormats.length,
  uniqueFormatIds,
)

// `sku`, `slug` and `editionLimit` are deliberately absent: the first two are
// indexed URLs, and the third is the size of an edition already numbered and
// partly sold — changing it would rewrite what buyers were promised.
export const updateArtworkSchema = artworkBaseSchema
  .omit({ sku: true, slug: true, editionLimit: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "At least one field must be provided" })
  .refine(
    (patch) =>
      patch.availableFormats === undefined ||
      new Set(patch.availableFormats.map((f) => f.id)).size === patch.availableFormats.length,
    { message: "Format ids must be unique", path: ["availableFormats"] },
  )

export type CreateArtworkInput = z.infer<typeof createArtworkSchema>
export type UpdateArtworkInput = z.infer<typeof updateArtworkSchema>

// --- Tags ------------------------------------------------------------------

export const createTagSchema = z
  .object({
    slug: tagSlugSchema,
    name: z.string().trim().min(1).max(100),
    facet: z.enum(TAG_FACETS),
    description: optionalText(1000),
    displayOrder: z.coerce.number().int().min(0).max(9999).default(0),
  })
  .strict()

// The facet drives the query semantics (OR inside a facet, AND across facets),
// so moving a tag between facets silently changes every saved filter — refused.
export const updateTagSchema = createTagSchema
  .omit({ slug: true, facet: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "At least one field must be provided" })

export type CreateTagInput = z.infer<typeof createTagSchema>
export type UpdateTagInput = z.infer<typeof updateTagSchema>

// --- Products (armurerie) --------------------------------------------------

export const productVariantSchema = z
  .object({
    id: z.string().uuid().optional(),
    skuVariant: z.string().trim().min(1).max(150),
    // The three attributes the table actually carries — see `product_variants`.
    finition: optionalText(100),
    munition: optionalText(100),
    couleur: optionalText(100),
    priceDeltaHt: z.coerce.number().min(-1_000_000).max(1_000_000).default(0),
    stockQty: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict()
  // `chk_variant_attrs` demands at least one of them; catching it here turns a
  // 500 from Postgres into a field-level message.
  .refine((v) => Boolean(v.finition || v.munition || v.couleur), {
    message: "A variant needs at least one attribute (finish, ammunition or colour)",
  })

const productBaseSchema = z
  .object({
    sku: z.string().trim().min(1).max(100),
    slug: entitySlugSchema,
    name: z.string().trim().min(1).max(255),
    description: optionalText(1000),
    longDescription: optionalText(20000),
    categorySlug: categorySlugSchema,
    legalCategory: z.enum(LEGAL_CATEGORIES),
    priceHt: z.coerce.number().min(0).max(10_000_000),
    vatPct: z.coerce.number().min(0).max(100).default(20),
    stockQty: z.coerce.number().int().min(0).max(1_000_000).default(0),
    trackStock: z.boolean().default(true),
    featuredImageUrl: optionalUrl,
    published: z.boolean().default(false),
    featured: z.boolean().default(false),
    tagSlugs: z.array(tagSlugSchema).max(MAX_TAG_FILTERS).default([]),
    variants: z.array(productVariantSchema).max(50).default([]),

    // Rentabilité (story 11.10) — strictement administratif, jamais exposé.
    costPriceHt: z.coerce.number().min(0).max(10_000_000).nullish(),
    chargesPct: z.coerce.number().min(0).max(100).nullish(),
    chargesAmountHt: z.coerce.number().min(0).max(10_000_000).nullish(),
    beneficiaryId: z.string().uuid().nullish(),
    beneficiarySharePct: z.coerce.number().min(0).max(100).nullish(),
    metaTitle: optionalText(255),
    metaDescription: optionalText(500),
  })
  .strict()

const uniqueVariantSkus = {
  message: "Variant SKUs must be unique",
  path: ["variants"],
}

export const createProductSchema = productBaseSchema.refine(
  (v) => new Set(v.variants.map((x) => x.skuVariant)).size === v.variants.length,
  uniqueVariantSkus,
)

export const updateProductSchema = productBaseSchema
  .omit({ sku: true, slug: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "At least one field must be provided" })
  .refine(
    (patch) =>
      patch.variants === undefined || new Set(patch.variants.map((x) => x.skuVariant)).size === patch.variants.length,
    { message: "Variant SKUs must be unique", path: ["variants"] },
  )

export type ProductVariantInput = z.infer<typeof productVariantSchema>
export type CreateProductInput = z.infer<typeof createProductSchema>
export type UpdateProductInput = z.infer<typeof updateProductSchema>

// --- Catalogue media (story 7.5b) ------------------------------------------

export const MEDIA_OWNER_TYPES = ["product", "artwork", "artwork_series", "artist"] as const
export type MediaOwnerTypeInput = (typeof MEDIA_OWNER_TYPES)[number]

export const mediaOwnerQuerySchema = z
  .object({
    ownerType: z.enum(MEDIA_OWNER_TYPES),
    ownerId: z.string().uuid(),
  })
  .strict()

// Alternative text is REQUIRED, not optional: a gallery without it is a gallery
// screen readers and search engines cannot use.
export const mediaUploadFieldsSchema = z
  .object({
    ownerType: z.enum(MEDIA_OWNER_TYPES),
    ownerId: z.string().uuid(),
    alt: z.string().trim().min(1).max(500),
  })
  .strict()

export const updateMediaSchema = z
  .object({
    alt: z.string().trim().min(1).max(500).optional(),
    position: z.coerce.number().int().min(0).max(999).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: "At least one field must be provided" })

/** Whole-gallery reorder: the ids in their new order. */
export const reorderMediaSchema = z
  .object({
    ownerType: z.enum(MEDIA_OWNER_TYPES),
    ownerId: z.string().uuid(),
    ids: z.array(z.string().uuid()).min(1).max(200),
  })
  .strict()

export type MediaUploadFields = z.infer<typeof mediaUploadFieldsSchema>
export type UpdateMediaInput = z.infer<typeof updateMediaSchema>
export type ReorderMediaInput = z.infer<typeof reorderMediaSchema>

// --- Bénéficiaires & reversements (story 11.10) ----------------------------

export const BENEFICIARY_KINDS = ["artist", "advisor"] as const
export const PAYOUT_STATUSES = ["pending", "due", "paid", "cancelled"] as const

const sharePctSchema = z.coerce.number().min(0).max(100)

export const createBeneficiarySchema = z
  .object({
    slug: entitySlugSchema,
    name: z.string().trim().min(1).max(255),
    kind: z.enum(BENEFICIARY_KINDS),
    defaultSharePct: sharePctSchema.default(0),
    contactEmail: emailSchema.optional(),
    // ⚠️ Deliberately no IBAN: that is one more piece of banking data to protect
    // for a need nothing has expressed. A free note is enough while payouts are
    // settled outside the site.
    paymentNotes: optionalText(2000),
    active: z.boolean().default(true),
  })
  .strict()

export const updateBeneficiarySchema = createBeneficiarySchema
  .omit({ slug: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "At least one field must be provided" })

export const updatePayoutSchema = z
  .object({
    // Only the human decision is patchable: marking a payout settled. The rate,
    // the basis and the amount were frozen at the sale and stay frozen.
    status: z.enum(["due", "paid"]),
    paidNotes: optionalText(2000),
  })
  .strict()

export const payoutQuerySchema = z
  .object({
    beneficiaryId: z.string().uuid().optional(),
    status: z.enum(PAYOUT_STATUSES).optional(),
  })
  .strict()

export type CreateBeneficiaryInput = z.infer<typeof createBeneficiarySchema>
export type UpdateBeneficiaryInput = z.infer<typeof updateBeneficiarySchema>
export type UpdatePayoutInput = z.infer<typeof updatePayoutSchema>
