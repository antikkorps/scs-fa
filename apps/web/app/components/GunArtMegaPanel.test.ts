// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import GunArtMegaPanel from "./GunArtMegaPanel.vue"

describe("GunArtMegaPanel", () => {
  it("pitches the editions, then leads to the artist before the collection", async () => {
    const wrapper = await mountSuspended(GunArtMegaPanel)
    expect(wrapper.text()).toContain("Signées & numérotées")
    const targets = wrapper.findAll("a.mega__cta").map((cta) => cta.attributes("href"))
    expect(targets).toEqual(["/collection/artiste", "/collection"])
  })
})
