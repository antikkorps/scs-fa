// @vitest-environment nuxt

import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ProInscription from "./inscription.vue"

const { signup, lookup, navigateToMock, isAuthenticated } = vi.hoisted(() => ({
  signup: vi.fn(),
  lookup: vi.fn(),
  navigateToMock: vi.fn(),
  isAuthenticated: { value: false },
}))

mockNuxtImport("useOrganisation", () => () => ({ signup, lookup }))
mockNuxtImport("useAuth", () => () => ({ isAuthenticated }))
mockNuxtImport("navigateTo", () => navigateToMock)

beforeEach(() => {
  useState("launch").value = { launchStage: "open", indexingEnabled: true, adminPreview: false }
  signup.mockReset()
  lookup.mockReset().mockResolvedValue({ status: "unavailable" })
  navigateToMock.mockReset()
  isAuthenticated.value = false
})

async function fillValidForm(wrapper: Awaited<ReturnType<typeof mountSuspended>>) {
  await wrapper.find('input[name="siret"]').setValue("732 829 320 00074")
  await wrapper.find('input[name="legalName"]').setValue("Armurerie Armand")
  await wrapper.find('select[name="organisationType"]').setValue("armurier")
  await wrapper.find('input[autocomplete="given-name"]').setValue("Jeanne")
  await wrapper.find('input[autocomplete="family-name"]').setValue("Armand")
  await wrapper.find('input[type="email"]').setValue("jeanne@armurerie.fr")
  await wrapper.find('input[type="password"]').setValue("MotDePasseTresLong123!")
  await wrapper.find('input[type="checkbox"]').setValue(true)
}

describe("pro/inscription.vue (story 12.8b)", () => {
  it("files the request and says what happens next, without logging in", async () => {
    signup.mockResolvedValue({ data: { id: "u1" } })
    const wrapper = await mountSuspended(ProInscription)
    await fillValidForm(wrapper)

    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(signup).toHaveBeenCalledWith(
      expect.objectContaining({ siret: "73282932000074", organisationType: "armurier", email: "jeanne@armurerie.fr" }),
    )
    expect(wrapper.text()).toContain("Demande envoyée")
    expect(wrapper.find('a[href="/connexion"]').exists()).toBe(true)
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it("checks the form before sending it", async () => {
    const wrapper = await mountSuspended(ProInscription)
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(signup).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain("La raison sociale est requise.")
    expect(wrapper.text()).toContain("Choisissez le type d'organisation.")
  })

  it("explains a SIRET already held by another pro account", async () => {
    signup.mockRejectedValue({ response: { status: 409 }, data: { error: "SiretAlreadyRegistered" } })
    const wrapper = await mountSuspended(ProInscription)
    await fillValidForm(wrapper)

    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(wrapper.text()).toContain("Ce SIRET appartient déjà à un compte professionnel validé")
  })

  it("explains a taken e-mail and points to the request from an account", async () => {
    signup.mockRejectedValue({ response: { status: 409 }, data: { error: "EmailAlreadyRegistered" } })
    const wrapper = await mountSuspended(ProInscription)
    await fillValidForm(wrapper)

    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(wrapper.text()).toContain("Un compte existe déjà avec cette adresse")
  })

  it("sends a signed-in visitor to their account, where the request lives", async () => {
    isAuthenticated.value = true
    await mountSuspended(ProInscription)
    expect(navigateToMock).toHaveBeenCalledWith("/compte#compte-pro")
  })
})

describe("pro/inscription.test.ts before the opening (story 12.10)", () => {
  it("replaces the form with the opening notice in the showcase stage", async () => {
    useState("launch").value = { launchStage: "showcase", indexingEnabled: false, adminPreview: false }
    const wrapper = await mountSuspended(ProInscription)
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
    expect(wrapper.text()).toContain("La demande de compte professionnel ouvre avec la boutique")
  })
})
