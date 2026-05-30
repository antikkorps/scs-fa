import { z } from "zod"
import { LEGAL_CATEGORIES } from "./constants.js"

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

export const createOrderSchema = z.object({
  items: z.array(cartItemSchema).min(1),
  shippingAddressId: z.string().uuid(),
})

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

// Product detail lookup by UUID (GET /api/products/:id)
export const productIdParamSchema = z.object({
  id: z.string().uuid(),
})

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
