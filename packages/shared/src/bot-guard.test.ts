import { describe, expect, it } from "vitest"
import { looksAutomated, MIN_FORM_FILL_MS } from "./bot-guard.js"

describe("looksAutomated — the robot traps shared by the public forms", () => {
  it("lets a person through: hidden field empty, time taken to fill the form", () => {
    expect(looksAutomated({ website: "", filledInMs: MIN_FORM_FILL_MS })).toBe(false)
    expect(looksAutomated({ filledInMs: 60_000 })).toBe(false)
  })

  it("catches the hidden field a robot fills", () => {
    expect(looksAutomated({ website: "http://spam.example", filledInMs: 60_000 })).toBe(true)
  })

  it("ignores a hidden field holding only blanks", () => {
    expect(looksAutomated({ website: "   ", filledInMs: 60_000 })).toBe(false)
  })

  it("catches a form sent faster than a person can fill it", () => {
    expect(looksAutomated({ website: "", filledInMs: MIN_FORM_FILL_MS - 1 })).toBe(true)
  })
})
