// @vitest-environment nuxt

import { CURRENT_TERMS_VERSION, SITE_HOST } from "@armurier/shared"
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import { formatDate } from "~/utils/format"
import Cgv from "./cgv.vue"
import MentionsLegales from "./mentions-legales.vue"

describe("legal pages (story 12.1)", () => {
  it("dates the CGV with the version the checkout sends and stores", async () => {
    const wrapper = await mountSuspended(Cgv)
    expect(wrapper.text()).toContain(`${formatDate(CURRENT_TERMS_VERSION)} (version en vigueur)`)
  })

  it("ships the model withdrawal form with the CGV", async () => {
    const wrapper = await mountSuspended(Cgv)
    expect(wrapper.find("#withdrawal-h").text()).toBe("Formulaire de rétractation")
    expect(wrapper.text()).toContain("Je vous notifie par la présente ma rétractation")
  })

  it("marks both drafts as such and highlights the facts still missing", async () => {
    for (const page of [Cgv, MentionsLegales]) {
      const wrapper = await mountSuspended(page)
      expect(wrapper.text()).toContain("Version provisoire.")
      expect(wrapper.findAll("mark.todo").length).toBeGreaterThan(0)
    }
  })

  it("names the host in the legal notice", async () => {
    const wrapper = await mountSuspended(MentionsLegales)
    expect(wrapper.text()).toContain(SITE_HOST.name)
    expect(wrapper.text()).toContain(SITE_HOST.address)
  })
})
