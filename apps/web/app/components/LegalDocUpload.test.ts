// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it, vi } from "vitest"
import LegalDocUpload from "./LegalDocUpload.vue"

mockNuxtImport("useDocuments", () => () => ({ upload: vi.fn() }))

// UX audit 2026-11-01 (I2): the form asked to "send your cni".
describe("LegalDocUpload", () => {
  it("names the document in full and says what to send", async () => {
    const wrapper = await mountSuspended(LegalDocUpload, { props: { docType: "cni" } })
    expect(wrapper.find(".up__lede").text()).toBe(
      "Pièce d'identité (carte d'identité ou passeport) : PDF, JPEG ou PNG, 10 Mo max.",
    )
    expect(wrapper.find(".up__help").text()).toBe("Carte d'identité recto verso, ou passeport, en cours de validité.")
  })

  it("adds no help line for a document whose name says it all", async () => {
    const wrapper = await mountSuspended(LegalDocUpload, { props: { docType: "autorisation_cnaps" } })
    expect(wrapper.find(".up__lede").text()).toBe("Autorisation CNAPS : PDF, JPEG ou PNG, 10 Mo max.")
    expect(wrapper.find(".up__help").exists()).toBe(false)
  })
})
