// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AdminCrossSellItem, AdminCrossSellOption, AdminCrossSellState } from "~/types/admin-catalogue"
import AdminCrossSellPanel from "./AdminCrossSellPanel.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const PRODUCT = "11111111-1111-4111-8111-111111111111"
const GLOVES = "22222222-2222-4222-8222-222222222222"
const SCOPE = "33333333-3333-4333-8333-333333333333"

const option = (id: string, name: string): AdminCrossSellOption => ({
  id,
  sku: `SKU-${name}`,
  name,
  priceHt: 120,
  featuredImageUrl: null,
  category: { slug: "aide-visee", name: "Aides à la visée" },
  legalCategory: "none",
  stockQty: 4,
  trackStock: true,
})

const attached = (id: string, name: string, position: number): AdminCrossSellItem => ({
  ...option(id, name),
  slug: name.toLowerCase(),
  published: true,
  position,
})

function state(over: Partial<AdminCrossSellState> = {}): AdminCrossSellState {
  return {
    enabled: true,
    eligible: true,
    reason: null,
    legalCategory: "B",
    hasAccessoryRestrictions: false,
    accessoryRestrictionNotes: null,
    items: [],
    ...over,
  }
}

function respondWith(current: AdminCrossSellState, options: AdminCrossSellOption[]) {
  apiMock.mockImplementation((url: string, init?: { method?: string }) => {
    if (init?.method === "PUT") return Promise.resolve({ data: current.items })
    if (url.endsWith("/cross-sell-options")) return Promise.resolve({ data: options })
    return Promise.resolve({ data: current })
  })
}

async function mount() {
  const wrapper = await mountSuspended(AdminCrossSellPanel, { props: { productId: PRODUCT } })
  await flushPromises()
  return wrapper
}

describe("AdminCrossSellPanel (story 11.8)", () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it("lists what is already suggested, in order", async () => {
    respondWith(state({ items: [attached(GLOVES, "Gants", 0), attached(SCOPE, "Lunette", 1)] }), [])
    const wrapper = await mount()
    expect(wrapper.findAll(".xs__name").map((n) => n.text())).toEqual(["Gants", "Lunette"])
  })

  /**
   * ⚠️ Le point sensible de la story : la restriction est du texte libre, donc
   * l'écran la met sous les yeux de l'admin — c'est la seule protection réelle.
   */
  it("met la note de restriction bien en vue", async () => {
    respondWith(state({ hasAccessoryRestrictions: true, accessoryRestrictionNotes: "Pas de chargeur > 10 coups." }), [
      option(SCOPE, "Lunette"),
    ])
    const wrapper = await mount()
    expect(wrapper.text()).toContain("Pas de chargeur > 10 coups.")
    expect(wrapper.text()).toContain("Aucune règle ne peut les vérifier à votre place")
  })

  it("dit que le bloc est éteint sans empêcher de préparer les suggestions", async () => {
    respondWith(state({ enabled: false }), [option(SCOPE, "Lunette")])
    const wrapper = await mount()
    expect(wrapper.text()).toContain("désactivé")
    expect(wrapper.find("select").exists()).toBe(true)
  })

  it("explique pourquoi une fiche qui n'est pas une arme n'a pas de bloc", async () => {
    respondWith(state({ eligible: false, reason: "Seule la fiche d'une arme porte un bloc de suggestions" }), [])
    const wrapper = await mount()
    expect(wrapper.text()).toContain("Seule la fiche d'une arme")
    expect(wrapper.find("select").exists()).toBe(false)
  })

  it("ajoute, réordonne et enregistre la liste entière", async () => {
    respondWith(state(), [option(GLOVES, "Gants"), option(SCOPE, "Lunette")])
    const wrapper = await mount()

    const select = wrapper.find("select")
    await select.setValue(GLOVES)
    await select.setValue(SCOPE)
    expect(wrapper.findAll(".xs__name").map((n) => n.text())).toEqual(["Gants", "Lunette"])

    // Descendre les gants : l'ordre saisi est celui que la fiche montrera.
    await wrapper.findAll(".xs__actions button")[1]?.trigger("click")
    expect(wrapper.findAll(".xs__name").map((n) => n.text())).toEqual(["Lunette", "Gants"])

    await wrapper.find("button.btn-primary").trigger("click")
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith(
      `/admin/products/${PRODUCT}/cross-sells`,
      expect.objectContaining({ method: "PUT", body: { accessoryIds: [SCOPE, GLOVES] } }),
    )
  })

  it("invite à enregistrer le produit avant d'y associer des accessoires", async () => {
    const wrapper = await mountSuspended(AdminCrossSellPanel, { props: { productId: null } })
    expect(wrapper.text()).toContain("Enregistrez le produit")
  })
})
