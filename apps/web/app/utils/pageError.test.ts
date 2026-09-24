import { describe, expect, it } from "vitest"
import { missingPageError } from "./pageError"

describe("missingPageError (story 9.6)", () => {
  it("answers 404 only when the content is really absent", () => {
    expect(missingPageError(null, "Œuvre introuvable").statusCode).toBe(404)
    expect(missingPageError({ statusCode: 404 }, "Œuvre introuvable").statusMessage).toBe("Œuvre introuvable")
  })

  it("answers 503 for an outage, a rate limit or a crash — never 'gone'", () => {
    for (const statusCode of [429, 500, 502, undefined]) {
      expect(missingPageError({ statusCode }, "Œuvre introuvable").statusCode).toBe(503)
    }
  })
})
