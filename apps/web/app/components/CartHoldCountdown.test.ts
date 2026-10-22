// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import CartHoldCountdown from "./CartHoldCountdown.vue"

describe("CartHoldCountdown (story 12.9a)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-22T10:00:00Z"))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("counts down the time the item stays held", async () => {
    const wrapper = await mountSuspended(CartHoldCountdown, { props: { heldUntil: "2026-10-22T10:12:30Z" } })
    expect(wrapper.text()).toContain("12:30")

    await vi.advanceTimersByTimeAsync(30_000)
    expect(wrapper.text()).toContain("12:00")
  })

  it("tells screen readers the end time once, rather than every second", async () => {
    const wrapper = await mountSuspended(CartHoldCountdown, { props: { heldUntil: "2026-10-22T10:12:30Z" } })
    expect(wrapper.find("[aria-hidden='true']").text()).toContain("12:30")
    expect(wrapper.find(".sr-only").text()).toContain("jusqu'à")
    expect(wrapper.find("[aria-live]").exists()).toBe(false)
  })

  it("warns when little time is left", async () => {
    const wrapper = await mountSuspended(CartHoldCountdown, { props: { heldUntil: "2026-10-22T10:04:00Z" } })
    expect(wrapper.classes()).toContain("hold--short")
  })

  it("says when the hold is over, once", async () => {
    const wrapper = await mountSuspended(CartHoldCountdown, { props: { heldUntil: "2026-10-22T10:00:02Z" } })

    await vi.advanceTimersByTimeAsync(5_000)

    expect(wrapper.emitted("expired")).toHaveLength(1)
    expect(wrapper.text()).toContain("0:00")
  })
})
