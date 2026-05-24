import { z } from "zod"
import { LEGAL_CATEGORIES, PRODUCT_CATEGORIES } from "./constants.js"

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

export const productFiltersSchema = z.object({
  category: z.enum(PRODUCT_CATEGORIES).optional(),
  legalCategory: z.enum(LEGAL_CATEGORIES).optional(),
  search: z.string().max(200).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type RefreshInput = z.infer<typeof refreshSchema>
export type CreateOrderInput = z.infer<typeof createOrderSchema>
export type ProductFilters = z.infer<typeof productFiltersSchema>

export type AuthTokens = {
  accessToken: string
  refreshToken: string
  expiresIn: number
}
