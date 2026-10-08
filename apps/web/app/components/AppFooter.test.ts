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
})
