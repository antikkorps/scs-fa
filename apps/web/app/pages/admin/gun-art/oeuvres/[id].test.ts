// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ArtworkForm from "./[id].vue"

const { apiMock, routeId } = vi.hoisted(() => ({ apiMock: vi.fn(), routeId: { value: "nouvelle" } }))
mockNuxtImport("useApi", () => () => apiMock)
// `mountSuspended({ route })` does not populate `params` for this page, so the
// route id — which decides create vs edit — is provided directly.
mockNuxtImport("useRoute", () => () => ({ params: { id: routeId.value } }))

const DETAIL = {
  id: "aw1",
  productId: "p1",
  slug: "eclat",
  sku: "ART-1",
  title: "Éclat",
  description: null,
  longDescription: null,
  artistId: "ar1",
  artistName: "Camille",
  seriesId: "s1",
  seriesTitle: "Âge d'or",
  seriesOrder: 1,
  editionLimit: 25,
  editionYear: 2025,
  availableFormats: [
    { id: "s", name: "Petit", widthCm: 40, heightCm: 50, priceFactor: 1 },
    { id: "m", name: "Moyen", widthCm: 60, heightCm: 80, priceFactor: 2 },
  ],
  basePriceHt: 50,
  priceIncrementHt: 2,
  vatPct: 20,
  orientation: "portrait",
  includeCertificate: true,
  featuredImageUrl: null,
  published: true,
  featured: false,
  metaTitle: null,
  metaDescription: null,
  prints: [
    { id: "pr1", printNumber: 1, printDesignation: "1/25", formatId: "s", status: "available", priceHt: 98 },
    { id: "pr2", printNumber: 2, printDesignation: "2/25", formatId: "s", status: "sold", priceHt: 96 },
  ],
}

function routeApi(url: string) {
  // The forms now embed the media gallery (story 7.5b); it asks for its own list.
  if (String(url).includes("/admin/media")) return Promise.resolve({ data: [] })
  if (url.includes("/admin/gun-art/artists")) return Promise.resolve({ data: [{ id: "ar1", name: "Camille" }] })
  if (url.includes("/admin/gun-art/series")) return Promise.resolve({ data: [{ id: "s1", title: "Âge d'or" }] })
  return Promise.resolve({ data: DETAIL })
}

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockImplementation(routeApi)
})

function mountNew() {
  routeId.value = "nouvelle"
  return mountSuspended(ArtworkForm)
}
function mountEdit() {
  routeId.value = "aw1"
  return mountSuspended(ArtworkForm)
}

describe("admin artwork form (story 7.5a)", () => {
  it("does not fetch an artwork on the creation route", async () => {
    const wrapper = await mountNew()
    expect(wrapper.find("h1").text()).toBe("Nouvelle œuvre")
    expect(apiMock.mock.calls.every(([url]) => String(url).includes("/admin/gun-art/"))).toBe(true)
  })

  /**
   * The same guard rail as story 11.7, run locally as the admin types. The
   * server enforces it again on save — this is the difference between finding
   * out now and finding out after a refused submit.
   */
  it("warns live when a small format would out-price a bigger one", async () => {
    const wrapper = await mountNew()
    expect(wrapper.find(".verdict--ok").exists()).toBe(true)

    // Bring the medium format down onto the small one's range.
    const factor = wrapper.findAll(".format")[1]?.findAll('input[type="number"]')[2]
    await factor?.setValue(1.5)
    await flushPromises()

    expect(wrapper.find(".verdict--bad").exists()).toBe(true)
    expect(wrapper.text()).toContain("l'enregistrement sera refusé")
    expect(wrapper.text()).toContain("Incrément ≤")
  })

  it("loads an existing artwork with its editorial links and its prints", async () => {
    const wrapper = await mountEdit()
    expect(wrapper.find("h1").text()).toBe("Éclat")
    expect(wrapper.findAll("tbody tr")).toHaveLength(2)
    expect(wrapper.text()).toContain("1/25")
  })

  /**
   * The edition is numbered and partly sold: changing its size would rewrite
   * what buyers were promised, so the field is locked and never sent.
   */
  it("locks sku, slug and edition size once the artwork exists", async () => {
    const wrapper = await mountEdit()
    const disabled = wrapper.findAll("input:disabled").length
    expect(disabled).toBeGreaterThanOrEqual(3)

    apiMock.mockResolvedValueOnce({ data: DETAIL })
    await wrapper.find(".btn-primary").trigger("click")
    await flushPromises()

    const patchCall = apiMock.mock.calls.find(([, o]) => (o as { method?: string })?.method === "PATCH")
    const body = (patchCall?.[1] as { body: Record<string, unknown> }).body
    expect(body).not.toHaveProperty("sku")
    expect(body).not.toHaveProperty("slug")
    expect(body).not.toHaveProperty("editionLimit")
    expect(body.title).toBe("Éclat")
  })

  it("sends the edition size only when creating", async () => {
    const wrapper = await mountNew()
    await wrapper.findAll('input[type="text"]')[0]?.setValue("SKU-1")

    apiMock.mockResolvedValueOnce({ data: DETAIL })
    await wrapper.find(".btn-primary").trigger("click")
    await flushPromises()

    const postCall = apiMock.mock.calls.find(([, o]) => (o as { method?: string })?.method === "POST")
    const body = (postCall?.[1] as { body: Record<string, unknown> }).body
    expect(body.editionLimit).toBe(25)
    expect(body).toHaveProperty("sku")
  })

  it("offers a format change only on a print nobody has claimed", async () => {
    const wrapper = await mountEdit()
    const rows = wrapper.findAll("tbody tr")
    // 1/25 is available, 2/25 is sold.
    expect(rows[0]?.find("select").exists()).toBe(true)
    expect(rows[1]?.find("select").exists()).toBe(false)
  })

  it("surfaces the server's refusal message", async () => {
    const wrapper = await mountEdit()
    apiMock.mockRejectedValueOnce({
      data: { message: "A smaller format would out-price a bigger one", issues: [{ path: "x", message: "détail" }] },
    })
    await wrapper.find(".btn-primary").trigger("click")
    await flushPromises()
    expect(wrapper.find(".alert").text()).toContain("détail")
  })
})
