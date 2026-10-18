import { describe, expect, it } from "vitest"
import { createWindowLimiter } from "./window-limiter.js"

describe("createWindowLimiter (story 12.7d)", () => {
  it("lets `max` hits through per key and window, then refuses until the window rolls over", () => {
    let now = 0
    const limiter = createWindowLimiter({ max: 2, windowMs: 60_000, now: () => now })

    expect([limiter.hit("a"), limiter.hit("a"), limiter.hit("a")]).toEqual([true, true, false])
    expect(limiter.hit("b")).toBe(true)

    now = 60_000
    expect(limiter.hit("a")).toBe(true)
  })

  it("forgets keys whose window is over, so memory does not grow with visitors", () => {
    let now = 0
    const limiter = createWindowLimiter({ max: 1, windowMs: 1_000, now: () => now })
    for (let visitor = 0; visitor < 50; visitor++) limiter.hit(`ip-${visitor}`)
    expect(limiter.size()).toBe(50)

    now = 1_000
    limiter.hit("late")
    expect(limiter.size()).toBe(1)
  })
})
