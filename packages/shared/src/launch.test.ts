import { describe, expect, it } from "vitest"
import { LAUNCH_STAGES, salesAreOpen } from "./launch.js"
import { shopSettingsSchema } from "./validation.js"

describe("launch stages (story 12.10)", () => {
  it("go from the waiting page to the showcase, then open", () => {
    expect(LAUNCH_STAGES).toEqual(["coming_soon", "showcase", "open"])
  })

  it("open sales only at the last stage", () => {
    expect(salesAreOpen("coming_soon")).toBe(false)
    expect(salesAreOpen("showcase")).toBe(false)
    expect(salesAreOpen("open")).toBe(true)
  })
})

describe("shopSettingsSchema (stories 12.9e, 12.10)", () => {
  const valid = { vipMarginSharePct: 50, launchStage: "showcase", indexingEnabled: false }

  it("takes the VIP share, the launch stage and the indexing switch together", () => {
    expect(shopSettingsSchema.parse(valid)).toEqual(valid)
  })

  it("refuses an unknown stage, a missing setting or a stringly switch", () => {
    expect(shopSettingsSchema.safeParse({ ...valid, launchStage: "closed" }).success).toBe(false)
    expect(shopSettingsSchema.safeParse({ vipMarginSharePct: 50 }).success).toBe(false)
    expect(shopSettingsSchema.safeParse({ ...valid, indexingEnabled: "false" }).success).toBe(false)
  })
})
