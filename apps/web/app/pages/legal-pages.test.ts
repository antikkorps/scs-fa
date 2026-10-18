// @vitest-environment nuxt

import { CURRENT_TERMS_VERSION, SITE_HOST } from "@armurier/shared"
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import { formatDate } from "~/utils/format"
import Cgv from "./cgv.vue"
import Confidentialite from "./confidentialite.vue"
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

  it("names Henrri among the processors, with what it receives (story 12.6)", async () => {
    const wrapper = await mountSuspended(Confidentialite)
    const processors = wrapper.findAll("li").map((item) => item.text())
    expect(processors).toContainEqual(expect.stringMatching(/^Henrri .*factures.*avoirs.*adresse de facturation/))
    // Decision 2026-10-14: the e-mail is not sent to Henrri.
    expect(processors.find((item) => item.startsWith("Henrri"))).not.toMatch(/e-mail/)
  })

  it("names Brevo as the sender of the service e-mails and the newsletter", async () => {
    const wrapper = await mountSuspended(Confidentialite)
    const processors = wrapper.findAll("li").map((item) => item.text())
    expect(processors).toContainEqual(expect.stringMatching(/^Brevo .*e-mails de service.*lettre d'information/))
    expect(processors.some((item) => item.includes("prestataire d'envoi des e-mails"))).toBe(false)
  })

  it("states how long the journal of sensitive operations is kept (story 12.7e)", async () => {
    const wrapper = await mountSuspended(Confidentialite)
    const row = wrapper.findAll("tr").find((line) => line.text().startsWith("Journal des opérations sensibles"))
    expect(row?.find("mark.todo").exists()).toBe(false)
    expect(row?.text()).toContain("10 ans à compter de la date de la commande")
    expect(row?.text()).toContain("1 an")
    expect(row?.text()).toContain("14 jours")
  })
})
