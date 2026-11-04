import { describe, expect, it } from "vitest"
import { LEGAL_DOC_LABELS, LEGAL_DOC_TYPES } from "./constants.js"
import {
  docTypesOf,
  parseRequiredDocEntries,
  requiredDocEntryKey,
  requiredDocEntryLabel,
  requiresValidityEnd,
} from "./required-docs.js"
import { legalDocumentMetaSchema } from "./validation.js"

// I7 — decision Franck 2026-11-04 (answer of Fred and Steph): a category C
// weapon asks an identity document and EITHER a hunting licence validated for
// the season OR a sport-shooting licence. A required entry is a document type,
// or a group of alternatives of which one is enough.

describe("the shooting licence (I7)", () => {
  it("is a document a customer can send, named in full", () => {
    expect(LEGAL_DOC_TYPES).toContain("licence_tir")
    expect(LEGAL_DOC_LABELS.licence_tir).toBe("Licence de tir sportif")
  })
})

describe("parseRequiredDocEntries", () => {
  it("reads single types and groups of alternatives, as stored", () => {
    expect(parseRequiredDocEntries(["cni", ["permis_chasse", "licence_tir"]])).toEqual([
      "cni",
      ["permis_chasse", "licence_tir"],
    ])
  })

  it("drops what is not a customer's document type, and a group left with one type becomes that type", () => {
    expect(parseRequiredDocEntries(["cni", "bogus", ["permis_chasse", "bogus"], [], 3, null])).toEqual([
      "cni",
      "permis_chasse",
    ])
  })

  it("reads nothing from a value that is not a list", () => {
    expect(parseRequiredDocEntries(null)).toEqual([])
    expect(parseRequiredDocEntries("cni")).toEqual([])
  })
})

describe("an entry, read", () => {
  it("names a group as its alternatives", () => {
    expect(requiredDocEntryLabel(["permis_chasse", "licence_tir"])).toBe(
      "Permis de chasser validé ou licence de tir sportif",
    )
    expect(requiredDocEntryLabel("cni")).toBe(LEGAL_DOC_LABELS.cni)
  })

  it("lists the types that satisfy it, and has a stable key", () => {
    expect(docTypesOf(["permis_chasse", "licence_tir"])).toEqual(["permis_chasse", "licence_tir"])
    expect(docTypesOf("cni")).toEqual(["cni"])
    expect(requiredDocEntryKey(["permis_chasse", "licence_tir"])).toBe("permis_chasse|licence_tir")
    expect(requiredDocEntryKey("cni")).toBe("cni")
  })
})

describe("documents renewed every season (I7)", () => {
  it("are the hunting and the shooting licence", () => {
    expect(requiresValidityEnd("permis_chasse")).toBe(true)
    expect(requiresValidityEnd("licence_tir")).toBe(true)
    expect(requiresValidityEnd("cni")).toBe(false)
  })

  it("cannot be sent without the end of their validity", () => {
    expect(legalDocumentMetaSchema.safeParse({ docType: "licence_tir" }).success).toBe(false)
    expect(legalDocumentMetaSchema.safeParse({ docType: "permis_chasse", expiresAt: "2027-06-30" }).success).toBe(true)
    expect(legalDocumentMetaSchema.safeParse({ docType: "cni" }).success).toBe(true)
  })
})
