import { describe, expect, it } from "vitest"
import {
  formatFileSize,
  legalDocHelp,
  legalDocLabel,
  legalDocUploadMessage,
  needsUpload,
  requiredDocStatusLabel,
  requiredDocTone,
} from "./legal.js"

describe("requiredDocStatusLabel", () => {
  it("translates required-doc statuses", () => {
    expect(requiredDocStatusLabel("missing")).toBe("À fournir")
    expect(requiredDocStatusLabel("approved")).toBe("Validé")
    expect(requiredDocStatusLabel("rejected")).toBe("Refusé — à renvoyer")
  })
  it("falls back to an em dash", () => {
    expect(requiredDocStatusLabel("weird")).toBe("—")
  })
})

describe("requiredDocTone", () => {
  it("classifies the chip tone", () => {
    expect(requiredDocTone("approved")).toBe("positive")
    expect(requiredDocTone("rejected")).toBe("negative")
    expect(requiredDocTone("infected")).toBe("negative")
    expect(requiredDocTone("pending_review")).toBe("neutral")
    expect(requiredDocTone("missing")).toBe("neutral")
  })
})

describe("needsUpload", () => {
  it("is true only for states requiring a (re)upload", () => {
    expect(needsUpload("missing")).toBe(true)
    expect(needsUpload("rejected")).toBe(true)
    expect(needsUpload("infected")).toBe(true)
    expect(needsUpload("approved")).toBe(false)
    expect(needsUpload("pending_review")).toBe(false)
  })
})

describe("formatFileSize", () => {
  it("formats bytes / Ko / Mo", () => {
    expect(formatFileSize(512)).toBe("512 o")
    expect(formatFileSize(2048)).toBe("2 Ko")
    // French decimals, and no ",0" on a round size.
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5 Mo")
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2,5 Mo")
  })
})

describe("legalDocUploadMessage", () => {
  const apiError = (status: number, error?: string) => ({ response: { status }, data: error ? { error } : {} })

  it("tells the customer the document has already expired (story 12.9f)", () => {
    expect(legalDocUploadMessage(apiError(400, "DocumentExpired"))).toBe(
      "Ce document est déjà expiré. Envoyez une pièce en cours de validité.",
    )
  })
  it("translates the size and format refusals", () => {
    expect(legalDocUploadMessage(apiError(413))).toBe("Fichier trop volumineux (max 10 Mo).")
    expect(legalDocUploadMessage(apiError(415, "UnsupportedMediaType"))).toBe(
      "Format de fichier non accepté ou contenu non conforme.",
    )
  })
  it("falls back on a generic message", () => {
    expect(legalDocUploadMessage(apiError(400, "ValidationError"))).toBe(
      "Document invalide. Vérifiez le fichier et les informations saisies.",
    )
    expect(legalDocUploadMessage(new Error("network"))).toBe("L'envoi a échoué. Veuillez réessayer.")
  })
})

// UX audit 2026-11-01 (I2): customers read "cni" or "SIA" without a word of
// explanation, and could not tell whether a passport would do.
describe("legalDocLabel", () => {
  it("names each document in full, a passport counting as an identity document", () => {
    expect(legalDocLabel("cni")).toBe("Pièce d'identité (carte d'identité ou passeport)")
    expect(legalDocLabel("sia")).toBe("Numéro de détenteur SIA")
    expect(legalDocLabel("autorisation_det")).toBe("Autorisation préfectorale de détention")
  })

  it("names an organisation's documents too", () => {
    expect(legalDocLabel("autorisation_cnaps")).toBe("Autorisation CNAPS")
  })
})

describe("legalDocHelp", () => {
  it("explains what the SIA is", () => {
    expect(legalDocHelp("sia")).toMatch(/Système d'information sur les armes/)
  })

  it("says what to send for an identity document", () => {
    expect(legalDocHelp("cni")).toMatch(/passeport/)
  })

  it("has nothing to add for a document that needs no explanation", () => {
    expect(legalDocHelp("autorisation_cnaps")).toBeNull()
  })
})
