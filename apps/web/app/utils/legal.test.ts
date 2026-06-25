import { describe, expect, it } from "vitest"
import { formatFileSize, needsUpload, requiredDocStatusLabel, requiredDocTone } from "./legal.js"

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
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 Mo")
  })
})
