// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import ComingSoonPage from "./ComingSoonPage.vue"

describe("ComingSoonPage (story 12.10)", () => {
  it("announces the opening and offers the newsletter", async () => {
    const wrapper = await mountSuspended(ComingSoonPage)
    expect(wrapper.find("h1").text()).toBe("Ouverture prochaine")
    expect(wrapper.find('input[type="email"]').exists()).toBe(true)
  })

  it("links the legal pages, the only ones still open", async () => {
    const wrapper = await mountSuspended(ComingSoonPage)
    expect(wrapper.find('a[href="/mentions-legales"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/confidentialite"]').exists()).toBe(true)
  })
})
