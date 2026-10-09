// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MetricsResult } from "~/types/admin"
import Metrics from "./metrics.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const METRICS: MetricsResult = {
  period: { from: "2026-09-09", to: "2026-10-09" },
  revenue: { grossTtc: 1_234_567.89, refundedTtc: 0, netTtc: 1_234_567.89, paidOrders: 2 },
  commission: { ratePct: 12.5, amount: 154_320.99 },
  funnel: {
    totalOrders: 3,
    paidOrders: 2,
    pendingOrders: 1,
    failedOrders: 0,
    refundedOrders: 0,
    conversionPct: 66.67,
  },
  legalSla: { reviewed: 4, withinSla: 3, withinSlaPct: 75, avgReviewHours: 12.5, pendingOverdue: 0 },
  timeseries: [],
}

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockResolvedValue({ data: METRICS })
})

async function mountPage() {
  const wrapper = await mountSuspended(Metrics, { route: "/admin/metrics" })
  await flushPromises()
  return wrapper
}

/** Text with every kind of space (fr-FR uses narrow no-break ones) folded to a plain space. */
function plainText(text: string): string {
  return text.replace(/\s/g, " ")
}

describe("admin/metrics.vue", () => {
  it("writes percentages the French way, with a decimal comma", async () => {
    const wrapper = await mountPage()
    const values = wrapper.findAll(".kpi__value").map((value) => plainText(value.text()))
    expect(values).toContain("66,67 %")
    expect(values).toContain("75 %")
    expect(plainText(wrapper.text())).toContain("Commission (12,5 %)")
  })

  it("writes the average review delay with a decimal comma", async () => {
    const wrapper = await mountPage()
    expect(plainText(wrapper.text())).toContain("12,5 h")
  })
})
