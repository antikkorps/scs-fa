// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import { h } from "vue"
import MobileNavAccordion from "./MobileNavAccordion.vue"

function mountAccordion() {
  return mountSuspended(MobileNavAccordion, {
    props: { panelId: "msub-test", label: "Rayon" },
    slots: { default: () => h("li", h("a", { href: "/rayon" }, "Tout le rayon")) },
  })
}

describe("MobileNavAccordion", () => {
  it("names its panel and starts collapsed", async () => {
    const wrapper = await mountAccordion()
    const toggle = wrapper.find("button")
    expect(toggle.text()).toContain("Rayon")
    expect(toggle.attributes("aria-controls")).toBe("msub-test")
    expect(toggle.attributes("aria-expanded")).toBe("false")
    expect(wrapper.find("#msub-test").text()).toContain("Tout le rayon")
  })

  it("opens and closes on a tap", async () => {
    const wrapper = await mountAccordion()
    const toggle = wrapper.find("button")
    await toggle.trigger("click")
    expect(toggle.attributes("aria-expanded")).toBe("true")
    expect(wrapper.find(".msub-wrap").classes()).toContain("is-open")
    await toggle.trigger("click")
    expect(toggle.attributes("aria-expanded")).toBe("false")
  })
})
