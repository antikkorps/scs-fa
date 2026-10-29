import { describe, expect, it, vi } from "vitest"
import { CLOSED_SHOP_STATUS, createShopStatusLoader, type ShopStatus } from "./shopStatus"

const OPEN: ShopStatus = { launchStage: "open", indexingEnabled: true }
const SHOWCASE: ShopStatus = { launchStage: "showcase", indexingEnabled: false }

function clock(start = 0) {
  let current = start
  return { now: () => current, advance: (ms: number) => (current += ms) }
}

describe("createShopStatusLoader", () => {
  it("asks the API once per time-to-live", async () => {
    const time = clock()
    const fetchStatus = vi.fn().mockResolvedValueOnce(OPEN).mockResolvedValueOnce(SHOWCASE)
    const load = createShopStatusLoader(fetchStatus, { ttlMs: 10_000, now: time.now })

    expect(await load()).toEqual(OPEN)
    time.advance(9_999)
    expect(await load()).toEqual(OPEN)
    expect(fetchStatus).toHaveBeenCalledTimes(1)

    time.advance(1)
    expect(await load()).toEqual(SHOWCASE)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
  })

  it("shares one call between concurrent requests", async () => {
    const fetchStatus = vi.fn().mockResolvedValue(OPEN)
    const load = createShopStatusLoader(fetchStatus, { ttlMs: 10_000, now: clock().now })

    await Promise.all([load(), load(), load()])
    expect(fetchStatus).toHaveBeenCalledTimes(1)
  })

  it("stays closed and unindexed when the API never answered", async () => {
    const load = createShopStatusLoader(vi.fn().mockRejectedValue(new Error("down")), {
      ttlMs: 10_000,
      now: clock().now,
    })

    expect(await load()).toEqual(CLOSED_SHOP_STATUS)
    expect(CLOSED_SHOP_STATUS).toEqual({ launchStage: "coming_soon", indexingEnabled: false })
  })

  it("keeps the last known status through an outage, and asks again on the next request", async () => {
    const time = clock()
    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce(OPEN)
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(SHOWCASE)
    const load = createShopStatusLoader(fetchStatus, { ttlMs: 10_000, now: time.now })

    await load()
    time.advance(10_000)
    expect(await load()).toEqual(OPEN)
    expect(await load()).toEqual(SHOWCASE)
    expect(fetchStatus).toHaveBeenCalledTimes(3)
  })
})
