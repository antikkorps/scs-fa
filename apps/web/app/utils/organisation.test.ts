import {
  ORGANISATION_DOC_TYPES,
  ORGANISATION_STATUSES,
  ORGANISATION_TYPES,
  QUOTE_REQUEST_STATUSES,
} from "@armurier/shared"
import { describe, expect, it } from "vitest"
import { SHOP_NOT_OPEN_MESSAGE } from "./launch"
import {
  legalDocOwner,
  ORGANISATION_TYPE_OPTIONS,
  organisationStatus,
  organisationTypeLabel,
  quoteAcceptanceMessage,
  quoteRequestStatus,
  registryCheckLabel,
} from "./organisation"
import { docTypeLabel } from "./status"

describe("organisation labels (story 12.8b)", () => {
  it("names every type the API accepts, in the order of the form", () => {
    expect(ORGANISATION_TYPE_OPTIONS.map((option) => option.value)).toEqual([...ORGANISATION_TYPES])
    expect(organisationTypeLabel("securite_privee")).toBe("Sécurité privée")
  })

  it("gives every status a label and a colour", () => {
    for (const status of ORGANISATION_STATUSES) {
      expect(organisationStatus(status).label).not.toBe(status)
    }
    expect(organisationStatus("approved")).toEqual({ label: "Validé", severity: "ok" })
    expect(organisationStatus("suspended").severity).toBe("bad")
  })

  it("tells SCS plainly what the registry said", () => {
    expect(registryCheckLabel("verified")).toEqual({ label: "Établissement actif", severity: "ok" })
    expect(registryCheckLabel("unavailable").severity).toBe("warn")
    expect(registryCheckLabel("inactive").severity).toBe("bad")
  })
})

describe("quote request labels (story 12.8c)", () => {
  it("gives every request status a label and a colour", () => {
    for (const status of QUOTE_REQUEST_STATUSES) expect(quoteRequestStatus(status).label).not.toBe(status)
    expect(quoteRequestStatus("requested")).toEqual({ label: "Envoyée", severity: "warn" })
  })
})

describe("an organisation's documents (story 12.8d)", () => {
  it("names every professional document type", () => {
    for (const type of ORGANISATION_DOC_TYPES) expect(docTypeLabel(type)).not.toBe(type)
    expect(docTypeLabel("autorisation_cnaps")).toBe("Autorisation CNAPS")
  })

  it("names the owner of a document: the person, or the organisation", () => {
    expect(
      legalDocOwner({
        user: { email: "paul@ex.fr", firstname: "Paul", lastname: "Martin" },
        organisation: null,
      }),
    ).toEqual({ name: "Paul Martin", contact: "paul@ex.fr" })
    expect(legalDocOwner({ user: null, organisation: { legalName: "Armurerie du Stand" } })).toEqual({
      name: "Armurerie du Stand",
      contact: "Compte pro",
    })
  })
})

describe("quoteAcceptanceMessage", () => {
  it("says the shop is not open yet (story 12.10)", () => {
    expect(quoteAcceptanceMessage("ShopNotOpen")).toBe(SHOP_NOT_OPEN_MESSAGE)
  })
})
