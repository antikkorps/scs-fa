import { describe, expect, it } from "vitest"
import { isUniqueViolation } from "./errors.js"

describe("isUniqueViolation", () => {
  it("recognises Postgres' unique violation, raw or wrapped by Drizzle", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true)
    expect(isUniqueViolation(new Error("Failed query", { cause: { code: "23505" } }))).toBe(true)
  })

  it("leaves every other error alone", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false)
    expect(isUniqueViolation(new Error("boom"))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation("23505")).toBe(false)
  })
})
