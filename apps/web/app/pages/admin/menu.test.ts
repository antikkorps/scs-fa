// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import MenuPage from "./menu.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const entry = (fields: Record<string, unknown>) => ({
  parentId: null,
  kind: "filter",
  linkUrl: null,
  categorySlug: null,
  subcategorySlug: null,
  legalCategory: null,
  tagSlugs: [],
  description: null,
  intro: null,
  hiddenFilters: [],
  ...fields,
})

// Deliberately out of order: the screen orders siblings by position.
const ENTRIES = [
  entry({ id: "mun", slug: "munitions", label: "Munitions", position: 2, categorySlug: "munition" }),
  entry({ id: "cha", slug: "chasse", label: "Chasse", position: 1, tagSlugs: ["chasse"], hiddenFilters: ["epoque"] }),
  entry({
    id: "al",
    parentId: "cha",
    slug: "armes-longues",
    label: "Armes longues",
    position: 1,
    categorySlug: "arme-longue",
    tagSlugs: ["chasse"],
  }),
  entry({
    id: "car",
    parentId: "al",
    slug: "carabines",
    label: "Carabines",
    position: 1,
    categorySlug: "arme-longue",
    subcategorySlug: "carabines",
    legalCategory: "C",
    tagSlugs: ["chasse"],
  }),
  entry({ id: "lnk", slug: "journal", label: "Journal", position: 3, kind: "link", linkUrl: "/journal" }),
]

function routeApi(url: string, options?: { method?: string }) {
  if (options?.method) return Promise.resolve({ data: ENTRIES[0] })
  if (url.includes("/product-categories")) {
    return Promise.resolve({
      data: [
        {
          slug: "arme-longue",
          name: "Armes longues",
          subcategories: [
            { slug: "fusils", name: "Fusils" },
            { slug: "carabines", name: "Carabines" },
          ],
        },
        { slug: "munition", name: "Munitions", subcategories: [] },
      ],
    })
  }
  if (url.includes("/admin/tags")) {
    return Promise.resolve({
      data: [
        { slug: "chasse", name: "Chasse", facet: "usage" },
        { slug: "tir-sportif", name: "Tir sportif", facet: "usage" },
      ],
    })
  }
  return Promise.resolve({ data: ENTRIES })
}

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockImplementation(routeApi)
})

const callsWith = (method: string) =>
  apiMock.mock.calls.filter(([, o]) => (o as { method?: string })?.method === method)
type Wrapper = Awaited<ReturnType<typeof mountSuspended<typeof MenuPage>>>
const rowOf = (wrapper: Wrapper, label: string) => {
  const row = wrapper.findAll(".entry").find((candidate) => candidate.find(".entry__label").text() === label)
  if (!row) throw new Error(`No row ${label}`)
  return row
}

describe("admin menu screen (story 12.15b)", () => {
  it("draws the tree depth first, siblings in their order, with each entry's filter", async () => {
    const wrapper = await mountSuspended(MenuPage)
    expect(wrapper.findAll(".entry__label").map((l) => l.text())).toEqual([
      "Chasse",
      "Armes longues",
      "Carabines",
      "Munitions",
      "Journal",
    ])
    expect(rowOf(wrapper, "Carabines").attributes("data-level")).toBe("3")
    expect(rowOf(wrapper, "Carabines").text()).toContain("Armes longues › Carabines · Chasse · Catégorie C")
    expect(rowOf(wrapper, "Carabines").text()).toContain("/chasse/armes-longues/carabines")
    expect(rowOf(wrapper, "Journal").text()).toContain("/journal")
  })

  it("offers no sub-entry under the third level nor under a link", async () => {
    const wrapper = await mountSuspended(MenuPage)
    expect(rowOf(wrapper, "Armes longues").find('[aria-label="Ajouter une sous-entrée"]').exists()).toBe(true)
    expect(rowOf(wrapper, "Carabines").find('[aria-label="Ajouter une sous-entrée"]').exists()).toBe(false)
    expect(rowOf(wrapper, "Journal").find('[aria-label="Ajouter une sous-entrée"]').exists()).toBe(false)
  })

  it("starts a sub-entry from its parent's filter and creates it under the parent", async () => {
    const wrapper = await mountSuspended(MenuPage)
    await rowOf(wrapper, "Armes longues").find('[aria-label="Ajouter une sous-entrée"]').trigger("click")
    expect((wrapper.find('select[name="categorySlug"]').element as HTMLSelectElement).value).toBe("arme-longue")
    await wrapper.find('input[name="label"]').setValue("Fusils")
    await wrapper.find('input[name="slug"]').setValue("fusils")
    await wrapper.find('select[name="subcategorySlug"]').setValue("fusils")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(callsWith("POST")[0]?.[1]).toMatchObject({
      body: {
        parentId: "al",
        label: "Fusils",
        slug: "fusils",
        kind: "filter",
        categorySlug: "arme-longue",
        subcategorySlug: "fusils",
        tagSlugs: ["chasse"],
      },
    })
  })

  it("proposes the slug from the label of a new entry", async () => {
    const wrapper = await mountSuspended(MenuPage)
    await wrapper.find(".btn-add").trigger("click")
    await wrapper.find('input[name="label"]').setValue("Armes de défense")
    expect((wrapper.find('input[name="slug"]').element as HTMLInputElement).value).toBe("armes-de-defense")
  })

  it("saves an edited entry's label and tags", async () => {
    const wrapper = await mountSuspended(MenuPage)
    await rowOf(wrapper, "Chasse").find('[aria-label="Modifier"]').trigger("click")
    await wrapper.find('input[name="label"]').setValue("Chasse & battue")
    await wrapper.find('[data-tag="tir-sportif"]').trigger("click")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    const [url, options] = callsWith("PATCH")[0] ?? []
    expect(url).toBe("/admin/menu/cha")
    expect((options as { body: Record<string, unknown> }).body).toMatchObject({
      label: "Chasse & battue",
      tagSlugs: ["chasse", "tir-sportif"],
    })
  })

  // Story 12.15c — the entry's page texts.
  it("saves the texts of the entry's page", async () => {
    const wrapper = await mountSuspended(MenuPage)
    await rowOf(wrapper, "Chasse").find('[aria-label="Modifier"]').trigger("click")
    await wrapper.find('input[name="description"]').setValue("Tout pour la chasse.")
    await wrapper.find('textarea[name="intro"]').setValue("Un.\n\nDeux.")
    await wrapper.find("form").trigger("submit")
    await flushPromises()
    const [, options] = callsWith("PATCH")[0] ?? []
    expect((options as { body: Record<string, unknown> }).body).toMatchObject({
      description: "Tout pour la chasse.",
      intro: "Un.\n\nDeux.",
    })
  })

  // Story 12.15e (Fred): the filters the entry's page offers.
  describe("the filters offered", () => {
    const offer = (wrapper: Wrapper, key: string) => wrapper.find(`input[name="offer"][value="${key}"]`)

    it("offers every filter, and saves the ones unticked as hidden", async () => {
      const wrapper = await mountSuspended(MenuPage)
      await rowOf(wrapper, "Munitions").find('[aria-label="Modifier"]').trigger("click")
      expect((offer(wrapper, "calibre").element as HTMLInputElement).checked).toBe(true)
      await offer(wrapper, "legalCategory").setValue(false)
      await offer(wrapper, "etat").setValue(false)
      await wrapper.find("form").trigger("submit")
      await flushPromises()
      const [, options] = callsWith("PATCH")[0] ?? []
      expect((options as { body: Record<string, unknown> }).body).toMatchObject({
        hiddenFilters: ["legalCategory", "etat"],
      })
    })

    it("shows a filter hidden higher in the branch as unticked, and locked", async () => {
      const wrapper = await mountSuspended(MenuPage)
      await rowOf(wrapper, "Carabines").find('[aria-label="Modifier"]').trigger("click")
      const epoque = offer(wrapper, "epoque").element as HTMLInputElement
      expect(epoque.checked).toBe(false)
      expect(epoque.disabled).toBe(true)
      expect(wrapper.text()).toContain("Masqué plus haut dans la branche")
    })
  })

  it("asks no page texts of a link", async () => {
    const wrapper = await mountSuspended(MenuPage)
    await wrapper.find(".btn-add").trigger("click")
    await wrapper.find('select[name="kind"]').setValue("link")
    expect(wrapper.find('textarea[name="intro"]').exists()).toBe(false)
  })

  // Chasse spans three levels: under any tab it would reach a fourth.
  it("offers only the places the entry's branch fits in", async () => {
    const wrapper = await mountSuspended(MenuPage)
    await rowOf(wrapper, "Chasse").find('[aria-label="Modifier"]').trigger("click")
    const places = wrapper
      .find('select[name="parentId"]')
      .findAll("option")
      .map((option) => option.text())
    expect(places).toEqual(["— onglet principal —"])
  })

  it("sends a link without criteria", async () => {
    const wrapper = await mountSuspended(MenuPage)
    await wrapper.find(".btn-add").trigger("click")
    await wrapper.find('input[name="label"]').setValue("Atelier")
    await wrapper.find('select[name="kind"]').setValue("link")
    await wrapper.find('input[name="linkUrl"]').setValue("/atelier")
    expect(wrapper.find('select[name="categorySlug"]').exists()).toBe(false)
    await wrapper.find("form").trigger("submit")
    await flushPromises()
    expect(callsWith("POST")[0]?.[1]).toMatchObject({
      body: { kind: "link", linkUrl: "/atelier", categorySlug: null, tagSlugs: [] },
    })
  })

  it("moves an entry up among its siblings", async () => {
    const wrapper = await mountSuspended(MenuPage)
    await rowOf(wrapper, "Munitions").find('[aria-label="Monter"]').trigger("click")
    await flushPromises()
    expect(callsWith("PUT")[0]).toEqual([
      "/admin/menu/order",
      { method: "PUT", body: { parentId: null, ids: ["mun", "cha", "lnk"] } },
    ])
    expect(rowOf(wrapper, "Chasse").find('[aria-label="Monter"]').exists()).toBe(false)
  })

  it("deletes an entry with its branch once confirmed", async () => {
    const confirmSpy = vi.fn((_message?: string) => true)
    vi.stubGlobal("confirm", confirmSpy)
    const wrapper = await mountSuspended(MenuPage)
    await rowOf(wrapper, "Chasse").find('[aria-label="Supprimer"]').trigger("click")
    await flushPromises()
    expect(String(confirmSpy.mock.calls[0]?.[0])).toContain("2 sous-entrées")
    expect(callsWith("DELETE")[0]?.[0]).toBe("/admin/menu/cha")
    vi.unstubAllGlobals()
  })

  it("relays the server's refusal", async () => {
    const wrapper = await mountSuspended(MenuPage)
    await rowOf(wrapper, "Chasse").find('[aria-label="Modifier"]').trigger("click")
    apiMock.mockRejectedValueOnce({ data: { message: "A sibling entry already has this slug" } })
    await wrapper.find("form").trigger("submit")
    await flushPromises()
    expect(wrapper.find(".alert").text()).toContain("A sibling entry already has this slug")
  })
})
