// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import AdminEntityManager from "./AdminEntityManager.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const ROWS = [
  { id: "a1", slug: "camille", name: "Camille", published: true, seriesCount: 2 },
  { id: "a2", slug: "jonas", name: "Jonas", published: false, seriesCount: 0 },
]

const props = {
  title: "Artistes",
  noun: "artiste",
  newLabel: "Nouvel artiste",
  emptyLabel: "Aucun artiste pour l'instant.",
  endpoint: "/admin/gun-art/artists",
  fields: [
    { key: "slug", label: "Slug", type: "text" as const, createOnly: true },
    { key: "name", label: "Nom", type: "text" as const },
    { key: "bio", label: "Bio", type: "textarea" as const },
    { key: "published", label: "Publié", type: "checkbox" as const },
  ],
  columns: [
    { key: "name", label: "Nom" },
    { key: "slug", label: "Slug" },
    { key: "seriesCount", label: "Séries", numeric: true },
  ],
}

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockResolvedValue({ data: ROWS })
})

const mounted = () => mountSuspended(AdminEntityManager, { props, route: "/admin/gun-art/artistes" })

describe("AdminEntityManager", () => {
  it("lists the rows with their counts", async () => {
    const wrapper = await mounted()
    expect(wrapper.findAll("tbody tr")).toHaveLength(2)
    expect(wrapper.text()).toContain("Camille")
    expect(wrapper.text()).toContain("Jonas")
  })

  it("uses the labels it is given rather than assembling French by hand", async () => {
    const wrapper = await mounted()
    // "Nouveau artiste" and "Aucun série" is what building them would produce.
    expect(wrapper.find(".btn-add").text()).toContain("Nouvel artiste")
  })

  /**
   * A blank box means "not filled in", not "set it to empty": the API rejects ""
   * for an optional URL, and sending it would also wipe a value on a PATCH.
   */
  it("drops empty fields from the payload instead of sending empty strings", async () => {
    const wrapper = await mounted()
    await wrapper.find(".btn-add").trigger("click")

    const inputs = wrapper.findAll(".form input[type='text']")
    await inputs[0]?.setValue("nouveau-slug")
    await inputs[1]?.setValue("Nouveau nom")

    apiMock.mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({ data: ROWS })
    await wrapper.find(".btn-primary").trigger("click")
    await flushPromises()

    const [url, options] = apiMock.mock.calls[1] as [string, { method: string; body: Record<string, unknown> }]
    expect(url).toBe("/admin/gun-art/artists")
    expect(options.method).toBe("POST")
    expect(options.body).toEqual({ slug: "nouveau-slug", name: "Nouveau nom", published: false })
    expect(options.body).not.toHaveProperty("bio")
  })

  it("hides the identifying fields when editing, and PATCHes the row", async () => {
    const wrapper = await mounted()
    await wrapper.findAll("tbody tr")[0]?.findAll("button")[0]?.trigger("click")

    // `slug` is createOnly: it is indexed, so it never reappears on an edit.
    const labels = wrapper.findAll(".form .field__label").map((l) => l.text())
    expect(labels).not.toContain("Slug")
    expect(labels).toContain("Nom")

    apiMock.mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({ data: ROWS })
    await wrapper.find(".btn-primary").trigger("click")
    await flushPromises()

    const [url, options] = apiMock.mock.calls[1] as [string, { method: string }]
    expect(url).toBe("/admin/gun-art/artists/a1")
    expect(options.method).toBe("PATCH")
  })

  it("shows the server's own refusal rather than a generic failure", async () => {
    const wrapper = await mounted()
    await wrapper.find(".btn-add").trigger("click")

    apiMock.mockRejectedValueOnce({ data: { error: "Conflict", message: "Slug already used" } })
    await wrapper.find(".btn-primary").trigger("click")
    await flushPromises()

    expect(wrapper.find(".alert").text()).toContain("Slug already used")
  })

  it("spells out a field-level refusal, path included", async () => {
    const wrapper = await mounted()
    await wrapper.find(".btn-add").trigger("click")

    apiMock.mockRejectedValueOnce({
      data: { error: "ValidationError", issues: [{ path: "slug", message: "Invalid slug" }] },
    })
    await wrapper.find(".btn-primary").trigger("click")
    await flushPromises()

    expect(wrapper.find(".alert").text()).toContain("slug : Invalid slug")
  })

  it("says plainly when there is nothing yet", async () => {
    apiMock.mockResolvedValue({ data: [] })
    const wrapper = await mounted()
    expect(wrapper.text()).toContain("Aucun artiste pour l'instant.")
  })
})
