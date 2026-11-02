// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { computed, ref } from "vue"
import ProductPage from "./[slug].vue"

const { product, addVariantMock, navigateToMock, auth } = vi.hoisted(() => ({
  product: {
    id: "p1",
    sku: "RIFLE-1",
    slug: "carabine-22",
    name: "Carabine .22 LR",
    description: "Carabine de tir sportif.",
    longDescription: null,
    priceHt: 500,
    vatPct: 20,
    priceTtc: 600,
    stockQty: 4,
    featuredImageUrl: null,
    category: { slug: "carabines", name: "Carabines" },
    tags: [],
    legalCategory: null,
    ageMinRequired: null,
    hasAccessoryRestrictions: false,
    accessoryRestrictionNotes: null,
    ancientWeapon: null,
    seo: { metaTitle: null, metaDescription: null },
    variants: [
      { id: "v-blue", skuVariant: "R-B", finition: "Bronzée", munition: null, couleur: null, stockQty: 2 },
      { id: "v-inox", skuVariant: "R-I", finition: "Inox", munition: null, couleur: null, stockQty: 2 },
      { id: "v-gone", skuVariant: "R-G", finition: "Camo", munition: null, couleur: null, stockQty: 0 },
    ].map((variant) => ({ ...variant, priceDeltaHt: 0, priceHt: 500, priceTtc: 600 })),
  },
  addVariantMock: vi.fn(),
  navigateToMock: vi.fn(),
  auth: { authenticated: true },
}))

mockNuxtImport("useApiFetch", () => () => ({ data: ref(product), error: ref(null) }))
mockNuxtImport("useCart", () => () => ({ addVariant: addVariantMock }))
mockNuxtImport("useAuth", () => () => ({ isAuthenticated: ref(auth.authenticated), isAdmin: ref(false) }))
mockNuxtImport("useLaunch", () => () => ({ salesOpen: ref(true), recheckAdmin: vi.fn() }))
mockNuxtImport("useProAccess", () => () => ({ isApprovedPro: computed(() => false), load: vi.fn() }))
mockNuxtImport("navigateTo", () => navigateToMock)

const mounted = async (route = "/boutique/carabine-22") => {
  const wrapper = await mountSuspended(ProductPage, { route })
  await flushPromises()
  return wrapper
}

const variantButton = (wrapper: Awaited<ReturnType<typeof mounted>>, label: string) =>
  wrapper.findAll("button.variants__opt").find((button) => button.text() === label)

beforeEach(() => {
  addVariantMock.mockReset().mockResolvedValue({ summary: { itemCount: 1 } })
  navigateToMock.mockReset()
  auth.authenticated = true
})

describe("boutique/[slug].vue — add to cart", () => {
  it("adds the selected variant", async () => {
    const wrapper = await mounted()
    await variantButton(wrapper, "Inox")?.trigger("click")
    await wrapper.find("button.buy").trigger("click")
    await flushPromises()
    expect(addVariantMock).toHaveBeenCalledWith("v-inox", 1)
  })

  // UX audit 2026-11-01 (I3): the item used to be lost on the way through the login.
  it("sends a visitor without an account to the login, with the variant to add in the way back", async () => {
    auth.authenticated = false
    const wrapper = await mounted()
    await variantButton(wrapper, "Inox")?.trigger("click")
    await wrapper.find("button.buy").trigger("click")
    await flushPromises()
    expect(addVariantMock).not.toHaveBeenCalled()
    expect(navigateToMock).toHaveBeenCalledWith(
      "/connexion?redirect=%2Fboutique%2Fcarabine-22%3Fajouter%3Dv-inox&motif=panier",
    )
  })
})

describe("boutique/[slug].vue — back from the login", () => {
  it("adds the variant chosen before signing in, once, and clears it from the address", async () => {
    const wrapper = await mounted("/boutique/carabine-22?ajouter=v-inox")
    expect(addVariantMock).toHaveBeenCalledOnce()
    expect(addVariantMock).toHaveBeenCalledWith("v-inox", 1)
    expect(navigateToMock).toHaveBeenCalledWith({ path: "/boutique/carabine-22", query: {} }, { replace: true })
    expect(variantButton(wrapper, "Inox")?.attributes("aria-pressed")).toBe("true")
  })

  it("says so when that variant ran out meanwhile, and adds nothing", async () => {
    const wrapper = await mounted("/boutique/carabine-22?ajouter=v-gone")
    expect(addVariantMock).not.toHaveBeenCalled()
    expect(wrapper.find("[role='alert']").text()).toMatch(/n'est plus disponible/)
  })

  it("ignores an id that is not one of this product's variants", async () => {
    const wrapper = await mounted("/boutique/carabine-22?ajouter=someone-else")
    expect(addVariantMock).not.toHaveBeenCalled()
    expect(wrapper.find("[role='alert']").text()).toMatch(/n'est plus disponible/)
  })
})
