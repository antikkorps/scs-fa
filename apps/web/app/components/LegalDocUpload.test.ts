// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import LegalDocUpload from "./LegalDocUpload.vue"

const { uploadMock } = vi.hoisted(() => ({ uploadMock: vi.fn() }))
mockNuxtImport("useDocuments", () => () => ({ upload: uploadMock }))

beforeEach(() => {
  uploadMock.mockReset().mockResolvedValue({ id: "d1" })
})

async function pickFile(wrapper: Awaited<ReturnType<typeof mountSuspended>>) {
  const input = wrapper.find("input[type=file]")
  const file = new File(["%PDF-1.4"], "licence.pdf", { type: "application/pdf" })
  Object.defineProperty(input.element, "files", { value: [file] })
  await input.trigger("change")
}

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

// I7 — decision Franck 2026-11-04: category C takes a hunting licence validated
// for the season OR a sport-shooting licence, both renewed every season.
describe("LegalDocUpload — a line satisfied by either licence", () => {
  const alternatives = ["permis_chasse", "licence_tir"] as const

  it("asks which document is sent, and names the one chosen", async () => {
    const wrapper = await mountSuspended(LegalDocUpload, {
      props: { docType: "permis_chasse", alternatives: [...alternatives] },
    })
    const choices = wrapper.findAll("input[type=radio]")
    expect(choices.map((choice) => choice.attributes("value"))).toEqual(["permis_chasse", "licence_tir"])
    expect(wrapper.text()).toContain("Licence de tir sportif")

    await choices[1]?.setValue(true)

    expect(wrapper.find(".up__lede").text()).toContain("Licence de tir sportif")
    expect(wrapper.find(".up__help").text()).toContain("Fédération française de tir")
  })

  it("sends the chosen licence with the end of its validity, which it requires", async () => {
    const wrapper = await mountSuspended(LegalDocUpload, {
      props: { docType: "permis_chasse", alternatives: [...alternatives] },
    })
    await wrapper.findAll("input[type=radio]")[1]?.setValue(true)
    await pickFile(wrapper)
    const validityEnd = wrapper.find("input[type=date]")
    expect(validityEnd.attributes("required")).toBeDefined()
    expect(wrapper.text()).toContain("Fin de validité")
    expect(wrapper.find("button[type=submit]").attributes("disabled")).toBeDefined()

    await validityEnd.setValue("2027-08-31")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(uploadMock).toHaveBeenCalledWith(expect.any(File), { docType: "licence_tir", expiresAt: "2027-08-31" })
  })

  it("keeps the date optional for a document that does not expire every season", async () => {
    const wrapper = await mountSuspended(LegalDocUpload, { props: { docType: "cni" } })
    expect(wrapper.find("input[type=date]").attributes("required")).toBeUndefined()
    expect(wrapper.findAll("input[type=radio]")).toHaveLength(0)
  })
})
