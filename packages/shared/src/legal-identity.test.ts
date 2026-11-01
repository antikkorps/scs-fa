import { describe, expect, it } from "vitest"
import { EMPTY_SHOP_IDENTITY, missingLegalFacts, shopIdentitySchema } from "./legal-identity.js"

const complete = {
  companyName: "SCS Firearms",
  legalForm: "SAS",
  shareCapital: "10 000 €",
  registration: "RCS Lyon 912 345 678",
  siret: "91234567800012",
  vatNumber: "FR12912345678",
  address: "3 quai du Stand, 69002 Lyon",
  email: "contact@scs-firearms.fr",
  privacyEmail: "rgpd@scs-firearms.fr",
  phone: "04 78 00 00 00",
  publicationDirector: "Frédéric Exemple",
  firearmsTradeAuthorisation: "Autorisation préfectorale n° 2026-01",
  mediatorName: "Médiateur de la consommation",
  mediatorUrl: "https://www.mediateur.example",
  contactHours: "Du mardi au samedi, 9 h – 18 h",
  contactNote: "Retrait en boutique sur rendez-vous.",
}

describe("the shop's identity (audit 2026-11-01, I8)", () => {
  it("starts empty: every legal fact is still to supply", () => {
    expect(missingLegalFacts(EMPTY_SHOP_IDENTITY)).toHaveLength(14)
  })

  it("counts only the legal facts, not the contact extras", () => {
    expect(missingLegalFacts(complete)).toEqual([])
    expect(missingLegalFacts({ ...complete, contactHours: null, contactNote: null })).toEqual([])
    expect(missingLegalFacts({ ...complete, siret: null })).toEqual(["siret"])
  })

  it("accepts a complete identity, and turns a blank field into a missing one", () => {
    const parsed = shopIdentitySchema.parse({ ...complete, vatNumber: "   ", contactNote: "" })
    expect(parsed.vatNumber).toBeNull()
    expect(parsed.contactNote).toBeNull()
    expect(parsed.companyName).toBe("SCS Firearms")
  })

  it("checks what has a format: e-mails, phone, SIRET, the mediator's site", () => {
    expect(shopIdentitySchema.safeParse({ ...complete, email: "pas-un-email" }).success).toBe(false)
    expect(shopIdentitySchema.safeParse({ ...complete, phone: "appelez-nous" }).success).toBe(false)
    expect(shopIdentitySchema.safeParse({ ...complete, siret: "123" }).success).toBe(false)
    expect(shopIdentitySchema.safeParse({ ...complete, siret: "912 345 678 00012" }).data?.siret).toBe("91234567800012")
    expect(shopIdentitySchema.safeParse({ ...complete, mediatorUrl: "javascript:alert(1)" }).success).toBe(false)
  })

  it("is replaced whole: every field present, nothing else", () => {
    const { contactHours: _dropped, ...partial } = complete
    expect(shopIdentitySchema.safeParse(partial).success).toBe(false)
    expect(shopIdentitySchema.safeParse({ ...complete, isAdmin: true }).success).toBe(false)
  })
})
