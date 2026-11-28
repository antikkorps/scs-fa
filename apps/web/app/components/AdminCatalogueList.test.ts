// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import AdminCatalogueList from "./AdminCatalogueList.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const ROWS = [
  { id: "p1", name: "Lunette en vente", archivedAt: null },
  { id: "p2", name: "Lunette archivée", archivedAt: "2026-10-07T10:00:00.000Z" },
]

const mounted = (archivable = true) =>
  mountSuspended(AdminCatalogueList, {
    props: {
      rows: ROWS,
      columns: [{ key: "name", label: "Nom" }],
      editBase: "/admin/produits",
      endpoint: "/admin/products",
      labelKey: "name",
      noun: "produit",
      archivable,
    },
    route: "/admin/produits",
  })

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockResolvedValue({})
  vi.stubGlobal("confirm", () => true)
})

describe("AdminCatalogueList (story 12.4)", () => {
  it("offers archive or restore depending on the row, and marks archived rows", async () => {
    const wrapper = await mounted()
    const [live, archived] = wrapper.findAll("tbody tr")
    expect(live?.find("[aria-label='Archiver']").exists()).toBe(true)
    expect(archived?.find("[aria-label='Réactiver']").exists()).toBe(true)
    expect(archived?.text()).toContain("Archivé")
  })

  it("archives through the API and tells the screen to reload", async () => {
    const wrapper = await mounted()
    const button = wrapper.find("button[aria-label='Archiver']")
    await button?.trigger("click")
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith("/admin/products/p1/archive", { method: "POST" })
    expect(wrapper.emitted("changed")).toHaveLength(1)
  })

  it("explains, in French, why an ordered product cannot be deleted", async () => {
    apiMock.mockRejectedValueOnce(Object.assign(new Error("409"), { statusCode: 409, data: { message: "Conflict" } }))
    const wrapper = await mounted()
    const button = wrapper.find("button[aria-label='Supprimer']")
    await button?.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("figure sur une commande : archivez-le plutôt que de le supprimer")
  })

  it("stays a plain list where archiving does not apply", async () => {
    const wrapper = await mounted(false)
    expect(wrapper.find("[aria-label='Archiver']").exists()).toBe(false)
    expect(wrapper.find("[aria-label='Réactiver']").exists()).toBe(false)
  })

  it("shows each row action as an icon with its name as a tooltip (Franck, 2026-11-01)", async () => {
    const wrapper = await mounted()
    const actions = wrapper.findAll("tbody tr")[0]?.findAll(".row-action") ?? []
    expect(actions.map((action) => action.attributes("aria-label"))).toEqual(["Modifier", "Archiver", "Supprimer"])
    for (const action of actions) {
      expect(action.find("svg").exists()).toBe(true)
      expect(action.find("[role='tooltip']").text()).toBe(action.attributes("aria-label"))
    }
    expect(actions[0]?.attributes("href")).toBe("/admin/produits/p1")
  })
})

// Story 12.16b: a supplier's catalogue is archived in one go, not row by row.
describe("AdminCatalogueList, archiving a selection (story 12.16b)", () => {
  const LIVE = [
    { id: "p1", name: "Lunette A", archivedAt: null },
    { id: "p3", name: "Lunette B", archivedAt: null },
    { id: "p2", name: "Lunette archivée", archivedAt: "2026-10-07T10:00:00.000Z" },
  ]
  const selectable = (rows = LIVE) =>
    mountSuspended(AdminCatalogueList, {
      props: {
        rows,
        columns: [{ key: "name", label: "Nom" }],
        editBase: "/admin/produits",
        endpoint: "/admin/products",
        labelKey: "name",
        noun: "produit",
        archivable: true,
        selectable: true,
      },
      route: "/admin/produits",
    })

  it("offers a box on each row still on sale, none on an archived one", async () => {
    const wrapper = await selectable()
    const boxes = wrapper.findAll("tbody tr").map((row) => row.find("input[type='checkbox']").exists())
    expect(boxes).toEqual([true, true, false])
  })

  it("selects every row shown from the header box, and archives them in one call", async () => {
    apiMock.mockResolvedValueOnce({ data: { archived: 2 } })
    const wrapper = await selectable()
    await wrapper.find("thead input[type='checkbox']").setValue(true)
    const archive = wrapper.find(".bulk button")
    expect(archive.text()).toBe("Archiver la sélection (2)")

    await archive.trigger("click")
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith("/admin/products/archive", { method: "POST", body: { ids: ["p1", "p3"] } })
    expect(wrapper.emitted("changed")).toHaveLength(1)
    expect(wrapper.text()).toContain("2 produits archivés")
  })

  it("forgets a selected row once the list no longer shows it", async () => {
    const wrapper = await selectable()
    await wrapper.find("tbody input[type='checkbox']").setValue(true)
    await wrapper.setProps({ rows: LIVE.slice(1) })
    expect(wrapper.find(".bulk").exists()).toBe(false)
  })

  it("archives nothing when the confirmation is declined", async () => {
    vi.stubGlobal("confirm", () => false)
    const wrapper = await selectable()
    await wrapper.find("tbody input[type='checkbox']").setValue(true)
    await wrapper.find(".bulk button").trigger("click")
    expect(apiMock).not.toHaveBeenCalled()
  })

  it("sends one call however often the button is clicked while it runs", async () => {
    let finish: (value: unknown) => void = () => {}
    apiMock.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    const wrapper = await selectable()
    await wrapper.find("tbody input[type='checkbox']").setValue(true)
    const archive = wrapper.find(".bulk button")
    await archive.trigger("click")
    await archive.trigger("click")
    expect(archive.attributes("disabled")).toBeDefined()
    finish({ data: { archived: 1 } })
    await flushPromises()
    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain("1 produit archivé.")
  })

  it("asks in the singular for one product", async () => {
    const asked = vi.fn(() => false)
    vi.stubGlobal("confirm", asked)
    const wrapper = await selectable()
    await wrapper.find("tbody input[type='checkbox']").setValue(true)
    await wrapper.find(".bulk button").trigger("click")
    expect(asked).toHaveBeenCalledWith("Archiver 1 produit ? Il sera retiré de la vente, sans être effacé.")
  })

  it("marks the header box as partly ticked, and drops it when no row can be ticked", async () => {
    const wrapper = await selectable()
    await wrapper.find("tbody input[type='checkbox']").setValue(true)
    expect((wrapper.find("thead input[type='checkbox']").element as HTMLInputElement).indeterminate).toBe(true)
    await wrapper.setProps({ rows: LIVE.slice(2) })
    expect(wrapper.find("thead input[type='checkbox']").exists()).toBe(false)
  })

  it("says the filter is empty rather than that there is nothing yet", async () => {
    const wrapper = await mountSuspended(AdminCatalogueList, {
      props: {
        rows: [],
        columns: [{ key: "name", label: "Nom" }],
        editBase: "/admin/produits",
        endpoint: "/admin/products",
        labelKey: "name",
        noun: "produit",
        emptyMessage: "Aucun produit pour ce fournisseur.",
      },
      route: "/admin/produits",
    })
    expect(wrapper.text()).toContain("Aucun produit pour ce fournisseur.")
    expect(wrapper.text()).not.toContain("pour l'instant")
  })

  it("offers no box on a list that is not selectable", async () => {
    const wrapper = await mounted()
    expect(wrapper.find("input[type='checkbox']").exists()).toBe(false)
  })
})
