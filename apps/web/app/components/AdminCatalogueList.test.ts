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
