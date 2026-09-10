// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ProductForm from "./[id].vue"

const { apiMock, routeId } = vi.hoisted(() => ({ apiMock: vi.fn(), routeId: { value: "nouveau" } }))
mockNuxtImport("useApi", () => () => apiMock)
mockNuxtImport("useRoute", () => () => ({ params: { id: routeId.value } }))

const DETAIL = {
  id: "p1",
  sku: "ARM-1",
  slug: "carabine",
  name: "Carabine",
  description: null,
  longDescription: null,
  categorySlug: "arme-longue",
  categoryName: "Armes longues",
  legalCategory: "C",
  priceHt: 800,
  vatPct: 20,
  stockQty: 3,
  trackStock: true,
  featured: false,
  featuredImageUrl: null,
  published: true,
  metaTitle: null,
  metaDescription: null,
  variants: [
    {
      id: "v1",
      skuVariant: "ARM-1-A",
      finition: "Bronzé",
      munition: null,
      couleur: null,
      priceDeltaHt: 0,
      stockQty: 2,
    },
  ],
  tagSlugs: ["occasion"],
}

function routeApi(url: string) {
  // The forms now embed the media gallery (story 7.5b); it asks for its own list.
  if (String(url).includes("/admin/media")) return Promise.resolve({ data: [] })
  // …and the beneficiary picker of story 11.10.
  if (String(url).includes("/beneficiary-options")) {
    return Promise.resolve({ data: [{ id: "ben1", name: "Florian", kind: "advisor", defaultSharePct: 10 }] })
  }
  if (String(url).includes("/product-categories")) {
    return Promise.resolve({
      data: [
        { slug: "arme-longue", name: "Armes longues" },
        { slug: "gun-art", name: "Gun Art" },
      ],
    })
  }
  if (String(url).includes("/admin/tags")) {
    return Promise.resolve({
      data: [
        { slug: "occasion", name: "Occasion", facet: "etat" },
        { slug: "arme-ancienne", name: "Arme ancienne", facet: "epoque" },
      ],
    })
  }
  return Promise.resolve({ data: DETAIL })
}

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockImplementation(routeApi)
})

function mountEdit() {
  routeId.value = "p1"
  return mountSuspended(ProductForm)
}
function mountNew() {
  routeId.value = "nouveau"
  return mountSuspended(ProductForm)
}

describe("admin product form (story 7.5a)", () => {
  it("never offers Gun Art as a category: those pieces have their own screen", async () => {
    const wrapper = await mountNew()
    const options = wrapper
      .findAll("select")[0]
      ?.findAll("option")
      .map((o) => o.text())
    expect(options).toContain("Armes longues")
    expect(options).not.toContain("Gun Art")
  })

  /** Mirrors the server: the flag is derived from the legal category, never typed in. */
  it("states that a regulated category will demand documents", async () => {
    const wrapper = await mountEdit()
    expect(wrapper.text()).toContain("Vérification des documents exigée")
  })

  it("loads the variants and the tags already set", async () => {
    const wrapper = await mountEdit()
    expect(wrapper.findAll(".variant")).toHaveLength(1)
    expect(wrapper.findAll(".tag--on").map((t) => t.text())).toEqual(["Occasion"])
  })

  it("toggles a tag on and off", async () => {
    const wrapper = await mountEdit()
    const tags = wrapper.findAll(".tag")
    await tags[1]?.trigger("click")
    expect(wrapper.findAll(".tag--on")).toHaveLength(2)
    await tags[0]?.trigger("click")
    expect(wrapper.findAll(".tag--on").map((t) => t.text())).toEqual(["Arme ancienne"])
  })

  /**
   * A variant id travels through carts and order lines, so an existing variant
   * is sent back with its id — the server updates it in place instead of
   * dropping and re-creating it.
   */
  it("keeps the id of an existing variant in the payload", async () => {
    const wrapper = await mountEdit()
    apiMock.mockResolvedValueOnce({ data: DETAIL })
    await wrapper.find(".btn-primary").trigger("click")
    await flushPromises()

    const call = apiMock.mock.calls.find(([, o]) => (o as { method?: string })?.method === "PATCH")
    const body = (call?.[1] as { body: { variants: Array<Record<string, unknown>> } }).body
    expect(body.variants[0]).toMatchObject({ id: "v1", skuVariant: "ARM-1-A", finition: "Bronzé" })
    // Empty attributes are omitted, not sent as empty strings.
    expect(body.variants[0]).not.toHaveProperty("munition")
  })

  it("adds a variant without an id, so the server inserts it", async () => {
    const wrapper = await mountEdit()
    await wrapper.find(".add").trigger("click")
    expect(wrapper.findAll(".variant")).toHaveLength(2)

    apiMock.mockResolvedValueOnce({ data: DETAIL })
    await wrapper.find(".btn-primary").trigger("click")
    await flushPromises()

    const call = apiMock.mock.calls.find(([, o]) => (o as { method?: string })?.method === "PATCH")
    const body = (call?.[1] as { body: { variants: Array<Record<string, unknown>> } }).body
    expect(body.variants).toHaveLength(2)
    expect(body.variants[1]).not.toHaveProperty("id")
  })

  it("relays the server's refusal to remove a variant that is on an order", async () => {
    const wrapper = await mountEdit()
    apiMock.mockRejectedValueOnce({
      data: { message: "Variant ARM-1-A appears on an order and cannot be removed — set its stock to 0 instead" },
    })
    await wrapper.find(".btn-primary").trigger("click")
    await flushPromises()
    expect(wrapper.find(".alert").text()).toContain("set its stock to 0")
  })
})
