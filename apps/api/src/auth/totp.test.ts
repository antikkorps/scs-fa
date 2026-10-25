import { describe, expect, it } from "vitest"
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  otpauthUri,
  totpCode,
  verifyTotp,
} from "./totp.js"

// RFC 6238, appendix B: the SHA-1 seed is the ASCII string "12345678901234567890".
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii")
const KEY = "test-totp-encryption-key-of-a-reasonable-length"

describe("TOTP (story 12.8e)", () => {
  it("gives the RFC 6238 SHA-1 codes, to six digits", () => {
    // The RFC lists eight digits; an authenticator app shows the last six.
    expect(totpCode(RFC_SECRET, Math.floor(59 / 30))).toBe("287082")
    expect(totpCode(RFC_SECRET, Math.floor(1111111109 / 30))).toBe("081804")
    expect(totpCode(RFC_SECRET, Math.floor(1234567890 / 30))).toBe("005924")
    expect(totpCode(RFC_SECRET, Math.floor(20000000000 / 30))).toBe("353130")
  })

  it("round-trips a secret through base32, as authenticator apps read it", () => {
    expect(base32Encode(RFC_SECRET)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")
    expect(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq")).toEqual(RFC_SECRET)
  })

  it("draws a 20-byte random secret", () => {
    const secret = generateTotpSecret()
    expect(secret).toHaveLength(20)
    expect(generateTotpSecret()).not.toEqual(secret)
  })

  describe("verifyTotp", () => {
    const at = (seconds: number) => new Date(seconds * 1000)

    it("accepts the current code and its neighbours, a 30-second step either side", () => {
      const step = Math.floor(1234567890 / 30)
      for (const offset of [-1, 0, 1]) {
        expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + offset), at(1234567890), null)).toBe(step + offset)
      }
      expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 2), at(1234567890), null)).toBeNull()
    })

    it("refuses a code already used, and an older one", () => {
      const step = Math.floor(1234567890 / 30)
      const code = totpCode(RFC_SECRET, step)
      expect(verifyTotp(RFC_SECRET, code, at(1234567890), step)).toBeNull()
      expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), at(1234567890), step)).toBeNull()
      expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), at(1234567890), step)).toBe(step + 1)
    })

    it("tolerates spaces and refuses anything but six digits", () => {
      const step = Math.floor(1234567890 / 30)
      expect(verifyTotp(RFC_SECRET, "005 924", at(1234567890), null)).toBe(step)
      expect(verifyTotp(RFC_SECRET, "05924", at(1234567890), null)).toBeNull()
      expect(verifyTotp(RFC_SECRET, "abcdef", at(1234567890), null)).toBeNull()
    })
  })

  it("builds the otpauth:// link authenticator apps scan", () => {
    expect(otpauthUri(RFC_SECRET, "jeanne@stand.fr")).toBe(
      "otpauth://totp/SCS%20Firearms:jeanne%40stand.fr?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=SCS%20Firearms&algorithm=SHA1&digits=6&period=30",
    )
  })

  describe("secret at rest", () => {
    it("is encrypted, differently each time, and decrypts with the same key", () => {
      const sealed = encryptSecret(RFC_SECRET, KEY)
      expect(sealed).not.toContain(base32Encode(RFC_SECRET))
      expect(encryptSecret(RFC_SECRET, KEY)).not.toBe(sealed)
      expect(decryptSecret(sealed, KEY)).toEqual(RFC_SECRET)
    })

    it("refuses another key or a tampered value", () => {
      const sealed = encryptSecret(RFC_SECRET, KEY)
      expect(() => decryptSecret(sealed, "another-key-entirely-different-from-the-first")).toThrow()
      const tampered = `${sealed.slice(0, -2)}${sealed.endsWith("A") ? "B" : "A"}${sealed.slice(-1)}`
      expect(() => decryptSecret(tampered, KEY)).toThrow()
    })
  })
})
