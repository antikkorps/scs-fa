// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ProAccountPanel from "./ProAccountPanel.vue"

const { mine, request, lookup } = vi.hoisted(() => ({ mine: vi.fn(), request: vi.fn(), lookup: vi.fn() }))
mockNuxtImport("useOrganisation", () => () => ({ mine, request, lookup }))

const ORGANISATION = {
  id: "o1",
  legalName: "Club de Tir du Val",
  siret: "73282932000074",
  type: "club",
  status: "pending",
  reviewReason: null,
  createdAt: "2026-10-21T10:00:00Z",
}

beforeEach(() => {
  mine.mockReset()
  request.mockReset()
  lookup.mockReset().mockResolvedValue({ status: "unavailable" })
})

async function mounted() {
  const wrapper = await mountSuspended(ProAccountPanel)
  await flushPromises()
  return wrapper
}

describe("ProAccountPanel (story 12.8b)", () => {
  it("offers a customer outside any organisation to turn pro", async () => {
    mine.mockResolvedValue(null)
    request.mockResolvedValue({ data: ORGANISATION })
    const wrapper = await mounted()
    expect(wrapper.text()).toContain("Vous êtes un professionnel ?")

    await wrapper.find("button.pro-panel__open").trigger("click")
    await wrapper.find('input[name="siret"]').setValue("73282932000074")
    await wrapper.find('input[name="legalName"]').setValue("Club de Tir du Val")
    await wrapper.find('select[name="organisationType"]').setValue("club")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(request).toHaveBeenCalledWith({
      siret: "73282932000074",
      legalName: "Club de Tir du Val",
      organisationType: "club",
    })
    expect(wrapper.text()).toContain("Demande en cours d'examen")
    expect(wrapper.text()).toContain("code")
  })

  it("tells a pending member their request is being reviewed", async () => {
    mine.mockResolvedValue(ORGANISATION)
    const wrapper = await mounted()
    expect(wrapper.text()).toContain("Demande en cours d'examen")
    expect(wrapper.text()).toContain("Club de Tir du Val")
    expect(wrapper.find("form").exists()).toBe(false)
  })

  it("shows the reason of a refusal and lets the member file again", async () => {
    mine.mockResolvedValue({ ...ORGANISATION, status: "rejected", reviewReason: "Affiliation fédérale manquante" })
    const wrapper = await mounted()
    expect(wrapper.text()).toContain("Affiliation fédérale manquante")
    expect(wrapper.find("button.pro-panel__open").text()).toContain("nouvelle demande")
  })

  it("shows the reason of a suspension, with no new request", async () => {
    mine.mockResolvedValue({ ...ORGANISATION, status: "suspended", reviewReason: "Impayés" })
    const wrapper = await mounted()
    expect(wrapper.text()).toContain("Compte professionnel suspendu")
    expect(wrapper.text()).toContain("Impayés")
    expect(wrapper.find("button.pro-panel__open").exists()).toBe(false)
  })

  it("confirms an approved account", async () => {
    mine.mockResolvedValue({ ...ORGANISATION, status: "approved" })
    const wrapper = await mounted()
    expect(wrapper.text()).toContain("Compte professionnel validé")
  })
})
