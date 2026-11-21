// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import AppFooter from "./AppFooter.vue"

mockNuxtImport("useConsent", () => () => ({ reopen: () => {} }))

describe("AppFooter", () => {
  it("signs the page with the brand logo", async () => {
    const wrapper = await mountSuspended(AppFooter)
    expect(wrapper.find(".ft__brand img.logo").attributes("alt")).toBe("SCS Firearms")
  })

  it("leads to the second-hand guns from the Explorer column", async () => {
    const wrapper = await mountSuspended(AppFooter)
    const explorer = wrapper.find('nav[aria-label="Explorer"]')
    const link = explorer.findAll("a").find((anchor) => anchor.text() === "Armes d'occasion")
    expect(link?.attributes("href")).toContain("occasion")
  })
})
