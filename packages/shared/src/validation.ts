import { z } from "zod"
import {
  ADDRESS_TYPES,
  LEGAL_CATEGORIES,
  LEGAL_DOC_REJECTION_REASONS,
  LEGAL_DOC_TYPES,
  LEGAL_DOC_VERIFICATION_STATUS,
} from "./constants.js"

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

export const productFiltersSchema = z
  .object({
    category: categorySlugSchema.optional(),
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
