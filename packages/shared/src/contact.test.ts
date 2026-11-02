import { describe, expect, it } from "vitest"
import {
  CONTACT_MESSAGE_RETENTION_YEARS,
  CONTACT_MIN_FILL_MS,
  CONTACT_SUBJECT_LABELS,
  CONTACT_SUBJECTS,
  contactMessageSchema,
  contactStatusSchema,
  looksAutomated,
} from "./contact.js"

const message = {
  name: "Jeanne Armand",
  email: "jeanne@example.fr",
  subject: "order",
  orderReference: "7C338E18",
  message: "Bonjour, où en est ma commande ?",
  filledInMs: 25_000,
}

describe("the contact form (audit 2026-11-01, I8b)", () => {
  it("offers the subjects decided with Franck, labelled in French", () => {
    expect(CONTACT_SUBJECTS).toEqual(["order", "product", "gun_art", "pro_account", "other"])
    expect(CONTACT_SUBJECT_LABELS).toEqual({
      order: "Commande",
      product: "Arme ou produit",
      gun_art: "Gun Art",
      pro_account: "Compte professionnel",
      other: "Autre",
    })
  })

  it("takes a name, an e-mail, a subject and a message; phone and order reference are optional", () => {
    expect(contactMessageSchema.safeParse(message).success).toBe(true)
    const { orderReference: _ref, ...minimal } = message
    expect(contactMessageSchema.safeParse({ ...minimal, phone: "" }).data?.phone).toBeNull()
  })

  it("refuses a missing name, a bad e-mail, an unknown subject, an empty or huge message", () => {
    expect(contactMessageSchema.safeParse({ ...message, name: " " }).success).toBe(false)
    expect(contactMessageSchema.safeParse({ ...message, email: "jeanne" }).success).toBe(false)
    expect(contactMessageSchema.safeParse({ ...message, subject: "spam" }).success).toBe(false)
    expect(contactMessageSchema.safeParse({ ...message, message: "  " }).success).toBe(false)
    expect(contactMessageSchema.safeParse({ ...message, message: "x".repeat(5001) }).success).toBe(false)
  })

  it("spots a robot: the hidden field filled, or the form sent too fast to have been read", () => {
    expect(looksAutomated(contactMessageSchema.parse(message))).toBe(false)
    expect(looksAutomated(contactMessageSchema.parse({ ...message, website: "http://spam.example" }))).toBe(true)
    expect(looksAutomated(contactMessageSchema.parse({ ...message, filledInMs: CONTACT_MIN_FILL_MS - 1 }))).toBe(true)
  })

  it("keeps a message one year after it was handled", () => {
    expect(CONTACT_MESSAGE_RETENTION_YEARS).toBe(1)
    expect(contactStatusSchema.safeParse({ status: "handled" }).success).toBe(true)
    expect(contactStatusSchema.safeParse({ status: "deleted" }).success).toBe(false)
  })
})
