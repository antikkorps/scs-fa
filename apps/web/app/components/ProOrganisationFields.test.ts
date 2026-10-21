// @vitest-environment nuxt
import type { OrganisationType } from "@armurier/shared"
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h, reactive } from "vue"
import ProOrganisationFields from "./ProOrganisationFields.vue"

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }))
mockNuxtImport("useOrganisation", () => () => ({ lookup }))

// The fields bind to a parent's form object, as the signup page and the account panel do.
type Form = { siret: string; legalName: string; organisationType: OrganisationType | "" }

function mountWithForm(initial: Partial<Form> = {}) {
  const form = reactive<Form>({ siret: "", legalName: "", organisationType: "", ...initial })
  const Host = defineComponent({
    setup: () => () => h(ProOrganisationFields, { form, fieldErrors: {} }),
  })
  return { form, mounted: mountSuspended(Host) }
}

beforeEach(() => {
  lookup.mockReset()
})

describe("ProOrganisationFields (story 12.8b)", () => {
  it("asks the registry once the SIRET is complete, and pre-fills the name and type", async () => {
    lookup.mockResolvedValue({
      status: "found",
      legalName: "MAIRIE DE LYON",
      suggestedType: "administration",
      active: true,
    })
    const { form, mounted } = mountWithForm()
    const wrapper = await mounted

    await wrapper.find('input[name="siret"]').setValue("732 829 320 00074")
    await wrapper.find('input[name="siret"]').trigger("blur")
    await flushPromises()

    expect(lookup).toHaveBeenCalledWith("73282932000074")
    expect(form.legalName).toBe("MAIRIE DE LYON")
    expect(form.organisationType).toBe("administration")
    expect(wrapper.text()).toContain("Établissement actif")
  })

  it("keeps a name the visitor already typed", async () => {
    lookup.mockResolvedValue({ status: "found", legalName: "SAS ARMAND", suggestedType: null, active: true })
    const { form, mounted } = mountWithForm({ legalName: "Armurerie Armand" })
    const wrapper = await mounted

    await wrapper.find('input[name="siret"]').setValue("73282932000074")
    await wrapper.find('input[name="siret"]').trigger("blur")
    await flushPromises()

    expect(form.legalName).toBe("Armurerie Armand")
  })

  it("says SCS will check by hand when the registry cannot confirm", async () => {
    lookup.mockResolvedValue({ status: "unavailable" })
    const { mounted } = mountWithForm()
    const wrapper = await mounted

    await wrapper.find('input[name="siret"]').setValue("73282932000074")
    await wrapper.find('input[name="siret"]').trigger("blur")
    await flushPromises()

    expect(wrapper.text()).toContain("vérifiera")
  })

  it("does not bother the registry with a malformed number", async () => {
    const { mounted } = mountWithForm()
    const wrapper = await mounted

    await wrapper.find('input[name="siret"]').setValue("12345678901234")
    await wrapper.find('input[name="siret"]').trigger("blur")
    await flushPromises()

    expect(lookup).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain("SIRET invalide")
  })
})
