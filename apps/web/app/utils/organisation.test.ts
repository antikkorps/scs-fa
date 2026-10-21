import { ORGANISATION_STATUSES, ORGANISATION_TYPES } from "@armurier/shared"
import { describe, expect, it } from "vitest"
import {
  ORGANISATION_TYPE_OPTIONS,
  organisationStatus,
  organisationTypeLabel,
  registryCheckLabel,
} from "./organisation"

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
