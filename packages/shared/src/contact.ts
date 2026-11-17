// Audit 2026-11-01 (I8b) — the contact form, decided with Franck: what a
// visitor sends, how a robot is told apart, how long a message is kept.

import { botTrapFields } from "./bot-guard.js"
import { emailSchema, phoneSchema } from "./validation.js"
import { z } from "./zod.js"

export const CONTACT_SUBJECTS = ["order", "product", "gun_art", "pro_account", "other"] as const
export type ContactSubject = (typeof CONTACT_SUBJECTS)[number]

export const CONTACT_SUBJECT_LABELS: Record<ContactSubject, string> = {
  order: "Commande",
  product: "Arme ou produit",
  gun_art: "Gun Art",
  pro_account: "Compte professionnel",
  other: "Autre",
}

export const CONTACT_STATUSES = ["new", "handled"] as const
export type ContactStatus = (typeof CONTACT_STATUSES)[number]

/** A message goes this long after it was handled (or after receipt, if never handled). */
export const CONTACT_MESSAGE_RETENTION_YEARS = 1

const blankToNull = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => value?.trim() || null)

export const contactMessageSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().pipe(emailSchema),
    phone: blankToNull.pipe(phoneSchema.nullable()),
    subject: z.enum(CONTACT_SUBJECTS),
    orderReference: blankToNull.pipe(z.string().max(40).nullable()),
    message: z.string().trim().min(1).max(5000),
    ...botTrapFields,
  })
  .strict()

export type ContactMessageInput = z.infer<typeof contactMessageSchema>

export const contactStatusSchema = z.object({ status: z.enum(CONTACT_STATUSES) }).strict()
