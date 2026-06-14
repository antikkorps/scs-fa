import { describe, expect, it, vi } from "vitest"
import { type AlertContext, createAlerter } from "./alerting.js"

function ctx(overrides: Partial<AlertContext> = {}): AlertContext {
  return {
    signature: "GET /api/x Error",
    statusCode: 500,
    method: "GET",
    url: "/api/x",
    reqId: "req-1",
    message: "boom",
    ...overrides,
  }
}

describe("createAlerter", () => {
  it("dispatches the first alert for a signature", async () => {
    const sendAlert = vi.fn().mockResolvedValue(undefined)
    const alerter = createAlerter({ sendAlert, now: () => 0, cooldownMs: 1000 })
    expect(await alerter.alert(ctx())).toBe(true)
    expect(sendAlert).toHaveBeenCalledTimes(1)
  })

  it("throttles repeats of the same signature within the cooldown", async () => {
    const sendAlert = vi.fn().mockResolvedValue(undefined)
    let clock = 0
    const alerter = createAlerter({ sendAlert, now: () => clock, cooldownMs: 1000 })

    expect(await alerter.alert(ctx())).toBe(true)
    clock = 500
    expect(await alerter.alert(ctx())).toBe(false) // still within cooldown
    clock = 1001
    expect(await alerter.alert(ctx())).toBe(true) // cooldown elapsed
    expect(sendAlert).toHaveBeenCalledTimes(2)
  })

  it("alerts distinct signatures independently", async () => {
    const sendAlert = vi.fn().mockResolvedValue(undefined)
    const alerter = createAlerter({ sendAlert, now: () => 0, cooldownMs: 1000 })
    expect(await alerter.alert(ctx({ signature: "A" }))).toBe(true)
    expect(await alerter.alert(ctx({ signature: "B" }))).toBe(true)
    expect(sendAlert).toHaveBeenCalledTimes(2)
  })

  it("never throws when delivery fails — routes it to onError instead", async () => {
    const sendAlert = vi.fn().mockRejectedValue(new Error("smtp down"))
    const onError = vi.fn()
    const alerter = createAlerter({ sendAlert, onError, now: () => 0 })
    await expect(alerter.alert(ctx())).resolves.toBe(true)
    expect(onError).toHaveBeenCalledOnce()
  })
})
