import { describe, expect, it } from "vitest"
import { detectLegalDocMimeType, fileContentMatchesDeclaredMime } from "./file-signature.js"

const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
// `<svg ...` — a classic stored-XSS payload masquerading as an image
const SVG = Uint8Array.from([0x3c, 0x73, 0x76, 0x67, 0x20])
const HTML = new TextEncoder().encode("<!DOCTYPE html><script>alert(1)</script>")

describe("detectLegalDocMimeType", () => {
  it("detects PDF, JPEG and PNG from their magic bytes", () => {
    expect(detectLegalDocMimeType(PDF)).toBe("application/pdf")
    expect(detectLegalDocMimeType(JPEG)).toBe("image/jpeg")
    expect(detectLegalDocMimeType(PNG)).toBe("image/png")
  })

  it("returns null for disallowed/unrecognized content (SVG, HTML, empty)", () => {
    expect(detectLegalDocMimeType(SVG)).toBeNull()
    expect(detectLegalDocMimeType(HTML)).toBeNull()
    expect(detectLegalDocMimeType(Uint8Array.from([]))).toBeNull()
  })
})

describe("fileContentMatchesDeclaredMime", () => {
  it("accepts content whose real type matches the declared type", () => {
    expect(fileContentMatchesDeclaredMime(PNG, "image/png")).toBe(true)
    expect(fileContentMatchesDeclaredMime(PDF, "application/pdf")).toBe(true)
  })

  it("rejects a spoofed Content-Type (HTML/SVG declared as image/png)", () => {
    expect(fileContentMatchesDeclaredMime(HTML, "image/png")).toBe(false)
    expect(fileContentMatchesDeclaredMime(SVG, "image/png")).toBe(false)
  })

  it("rejects a real image whose declared type points at the wrong allowed format", () => {
    expect(fileContentMatchesDeclaredMime(PNG, "image/jpeg")).toBe(false)
  })
})
