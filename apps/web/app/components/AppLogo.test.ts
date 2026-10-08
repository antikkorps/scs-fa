// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import AppLogo from "./AppLogo.vue"

describe("AppLogo", () => {
  it("shows the brand file, named for screen readers by default", async () => {
    const wrapper = await mountSuspended(AppLogo)
    const image = wrapper.find("img")
    expect(image.attributes("src")).toContain("scs-A-horizontal")
    expect(image.attributes("alt")).toBe("SCS Firearms")
  })

  it("reserves its box before the file loads, so the header never jumps", async () => {
    const wrapper = await mountSuspended(AppLogo)
    const image = wrapper.find("img")
    expect(Number(image.attributes("width"))).toBeGreaterThan(0)
    expect(Number(image.attributes("height"))).toBeGreaterThan(0)
  })

  it("stays silent when the link around it already says where it goes", async () => {
    const wrapper = await mountSuspended(AppLogo, { props: { decorative: true } })
    expect(wrapper.find("img").attributes("alt")).toBe("")
  })
})
