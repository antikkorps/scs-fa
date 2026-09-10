// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import AdminMediaGallery from "./AdminMediaGallery.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const image = (id: string, position: number, alt: string, watermarked = false) => ({
  id,
  ownerType: "product",
  ownerId: "p1",
  position,
  alt,
  widths: [400, 800, 1400],
  width: 1400,
  height: 933,
  sizeBytes: 51200,
  watermarked,
  url: `/api/media/${id}/1400.webp`,
  srcset: `/api/media/${id}/400.webp 400w, /api/media/${id}/1400.webp 1400w`,
})

const GALLERY = [image("m1", 0, "Première"), image("m2", 1, "Seconde")]

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockResolvedValue({ data: GALLERY })
})

const mounted = (props: Record<string, unknown> = {}) =>
  mountSuspended(AdminMediaGallery, { props: { ownerType: "product", ownerId: "p1", ...props } })

describe("AdminMediaGallery (story 7.5b)", () => {
  it("waits for the owner to exist before offering an upload", async () => {
    const wrapper = await mounted({ ownerId: null })
    expect(wrapper.text()).toContain("Enregistrez d'abord la fiche")
    expect(wrapper.find('input[type="file"]').exists()).toBe(false)
    expect(apiMock).not.toHaveBeenCalled()
  })

  it("lists the gallery in order and names the main image", async () => {
    const wrapper = await mounted()
    const items = wrapper.findAll(".item")
    expect(items).toHaveLength(2)
    // Position 0 drives the owner's own visual, so it is labelled rather than
    // left to be inferred.
    expect(items[0]?.find(".badge--main").exists()).toBe(true)
    expect(items[1]?.find(".badge--main").exists()).toBe(false)
  })

  it("says out loud that Gun Art visuals are watermarked", async () => {
    const wrapper = await mounted({ ownerType: "artwork" })
    expect(wrapper.text()).toContain("filigranés et plafonnés")
  })

  it("says nothing of the sort for an ordinary product photo", async () => {
    const wrapper = await mounted()
    expect(wrapper.text()).not.toContain("filigranés")
  })

  it("reports the widths a file actually has", async () => {
    const wrapper = await mounted()
    expect(wrapper.text()).toContain("3 tailles")
    expect(wrapper.text()).toContain("1400 px")
  })

  /** One call, not one per image: a half-sorted gallery flickers the main visual. */
  it("reorders the whole gallery in a single call", async () => {
    const wrapper = await mounted()
    const reordered = [image("m2", 0, "Seconde"), image("m1", 1, "Première")]
    apiMock.mockResolvedValueOnce({ data: reordered })

    await wrapper.findAll(".item")[1]?.findAll(".icon")[0]?.trigger("click")
    await flushPromises()

    const call = apiMock.mock.calls.find(([url]) => String(url).includes("/reorder"))
    expect(call).toBeDefined()
    const body = (call?.[1] as { body: { ids: string[] } }).body
    expect(body.ids).toEqual(["m2", "m1"])
    expect(wrapper.findAll(".item")[0]?.find(".badge--main").exists()).toBe(true)
  })

  it("cannot move the first image up nor the last one down", async () => {
    const wrapper = await mounted()
    const first = wrapper.findAll(".item")[0]?.findAll(".icon")
    const last = wrapper.findAll(".item")[1]?.findAll(".icon")
    expect(first?.[0]?.attributes("disabled")).toBeDefined()
    expect(last?.[1]?.attributes("disabled")).toBeDefined()
  })

  it("saves an edited alternative text, and ignores an emptied one", async () => {
    const wrapper = await mounted()
    const input = wrapper.findAll(".item .ctl")[0]
    await input?.setValue("Nouveau texte")
    await input?.trigger("change")
    await flushPromises()

    const patch = apiMock.mock.calls.find(([, o]) => (o as { method?: string })?.method === "PATCH")
    expect((patch?.[1] as { body: { alt: string } }).body.alt).toBe("Nouveau texte")

    // Emptying it would make the gallery unusable; the API refuses it, so the
    // component does not even ask.
    apiMock.mockClear()
    await input?.setValue("   ")
    await input?.trigger("change")
    await flushPromises()
    expect(apiMock.mock.calls.some(([, o]) => (o as { method?: string })?.method === "PATCH")).toBe(false)
  })

  it("relays the server's refusal instead of failing silently", async () => {
    const wrapper = await mounted()
    apiMock.mockRejectedValueOnce({ data: { message: "Image exceeds the maximum allowed size" } })

    await wrapper.findAll(".item")[1]?.findAll(".icon")[0]?.trigger("click")
    await flushPromises()

    expect(wrapper.find(".alert").text()).toContain("maximum allowed size")
  })
})
