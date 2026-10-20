import { describe, expect, it } from "vitest"
import { z } from "zod"
// Importing a schema module is all it takes: the setting must be in place
// before the first schema is built, in whatever bundle imports one.
import "./validation.js"

describe("zod configuration", () => {
  it("runs jitless, so a strict CSP never sees the `new Function` probe", () => {
    expect(z.config().jitless).toBe(true)
  })
})
