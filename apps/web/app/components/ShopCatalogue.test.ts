// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"
import ShopCatalogue from "./ShopCatalogue.vue"

mockNuxtImport("useFetch", () => (url: string) => {
  if (typeof url === "string" && url.includes("/product-categories")) {
    return {
      data: ref({
        data: [
          { slug: "arme-poing", name: "Armes de poing", category: "arme_poing", displayOrder: 1, description: null },
          { slug: "munition", name: "Munitions", category: "munition", displayOrder: 2, description: null },
        ],
      }),
    }
  }
  if (typeof url === "string" && url.includes("/tags")) {
    return { data: ref({ data: [] }) }
  }
  return {
    data: ref({ data: [], pagination: { page: 1, limit: 24, total: 0, totalPages: 0, hasMore: false } }),
    error: ref(null),
    pending: ref(false),
  }
})

describe("ShopCatalogue (story 9.6)", () => {
  // Spy on the real router — replacing useRouter wholesale breaks Nuxt's own
  // plugins — and only once mounted, since mounting navigates to `route`.
  const spyPush = () => vi.spyOn(useRouter(), "push").mockResolvedValue(undefined)

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("shows the page's own category as the selected one", async () => {
    const wrapper = await mountSuspended(ShopCatalogue, {
      props: { category: "arme-poing", basePath: "/boutique/categorie/arme-poing", listName: "x" },
      route: "/boutique/categorie/arme-poing",
    })
    const selected = wrapper.findAll("#shop-category option").filter((o) => (o.element as HTMLOptionElement).selected)
    expect(selected.map((o) => o.text())).toEqual(["Armes de poing"])
  })

  it("moves to the category's own page on change, keeping the other filters", async () => {
    const wrapper = await mountSuspended(ShopCatalogue, {
      props: { category: "", basePath: "/boutique", listName: "x" },
      route: "/boutique?legalCategory=B&page=3",
    })
    const push = spyPush()
    await wrapper.find("#shop-category").setValue("munition")
    expect(push).toHaveBeenCalledWith({ path: "/boutique/categorie/munition", query: { legalCategory: "B" } })
  })

  it("goes back to the whole catalogue when 'all categories' is chosen", async () => {
    const wrapper = await mountSuspended(ShopCatalogue, {
      props: { category: "munition", basePath: "/boutique/categorie/munition", listName: "x" },
      route: "/boutique/categorie/munition",
    })
    const push = spyPush()
    await wrapper.find("#shop-category").setValue("")
    expect(push).toHaveBeenCalledWith({ path: "/boutique", query: {} })
  })
})
