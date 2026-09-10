// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import type { AdminProfitability } from "~/types/admin-finance"
import AdminProfitabilityPanel from "./AdminProfitabilityPanel.vue"

const base: AdminProfitability = {
  priceHt: 1000,
  costPriceHt: 600,
  chargesHt: 50,
  payoutHt: 100,
  marginHt: 250,
  marginPct: 25,
  costUnknown: false,
}

const mounted = (profitability: AdminProfitability | null, beneficiaryName?: string | null) =>
  mountSuspended(AdminProfitabilityPanel, { props: { profitability, beneficiaryName } })

describe("AdminProfitabilityPanel (story 11.10)", () => {
  it("renders nothing at all when there is no figure yet", async () => {
    const wrapper = await mounted(null)
    expect(wrapper.find(".prof").exists()).toBe(false)
  })

  /**
   * The reversement is part of the subtraction on purpose: a margin that ignored
   * what is owed to the artist or the advisor would read as profit and would not
   * be.
   */
  it("shows the third-party share as a line of the subtraction, named", async () => {
    const wrapper = await mounted(base, "Florian")
    const text = wrapper.text()
    expect(text).toContain("Reversement")
    expect(text).toContain("Florian")
    expect(text).toContain("100,00")
    expect(text).toContain("250,00")
    expect(text).toContain("25 %")
  })

  it("marks a loss instead of dressing it up", async () => {
    const wrapper = await mounted({ ...base, marginHt: -40, marginPct: -4 })
    expect(wrapper.find(".prof--loss").exists()).toBe(true)
    expect(wrapper.text()).toContain("-40,00")
  })

  /** An unknown purchase price makes the margin an upper bound, not a result. */
  it("warns that a margin without a purchase price is a ceiling", async () => {
    const wrapper = await mounted({ ...base, costPriceHt: 0, costUnknown: true })
    expect(wrapper.text()).toContain("non renseigné")
    expect(wrapper.text()).toContain("plafond")
  })

  it("says nothing of the sort once the cost is known", async () => {
    const wrapper = await mounted(base)
    expect(wrapper.text()).not.toContain("plafond")
  })

  /** An edition has as many prices as prints; the figure has to say which one. */
  it("names the print an artwork's figures are based on", async () => {
    const wrapper = await mounted({ ...base, basedOnPriceHt: 148 })
    expect(wrapper.text()).toContain("tirage le plus cher")
    expect(wrapper.text()).toContain("148,00")
  })
})
