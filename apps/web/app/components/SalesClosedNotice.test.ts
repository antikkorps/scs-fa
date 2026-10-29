// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import SalesClosedNotice from "./SalesClosedNotice.vue"

describe("SalesClosedNotice (story 12.10)", () => {
  it("stands in for the purchase: available at the opening, and the way to hear of it", async () => {
    const wrapper = await mountSuspended(SalesClosedNotice)
    expect(wrapper.find(".closed__btn").text()).toBe("Disponible à l'ouverture")
    expect(wrapper.find(".closed__btn").attributes("disabled")).toBeDefined()
    expect(wrapper.find('input[type="email"]').exists()).toBe(true)
  })

  it("names what opens with the shop instead of a button when told so", async () => {
    const wrapper = await mountSuspended(SalesClosedNotice, { props: { what: "La création de compte" } })
    expect(wrapper.find(".closed__btn").exists()).toBe(false)
    expect(wrapper.text()).toContain("La création de compte ouvre avec la boutique")
  })

  it("pre-ticks the newsletter of the universe it stands in", async () => {
    const wrapper = await mountSuspended(SalesClosedNotice, { props: { segments: ["collection"] } })
    const ticked = wrapper.findAll('input[type="checkbox"]').filter((box) => (box.element as HTMLInputElement).checked)
    expect(ticked.map((box) => box.attributes("value"))).toEqual(["collection"])
  })
})
