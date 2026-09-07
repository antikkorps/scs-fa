// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Desabonnement from "./desabonnement.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const TOKEN = "b".repeat(32)
const withToken = { route: `/newsletter/desabonnement?token=${TOKEN}` }

function subscribedTo(...segments: string[]) {
  return { data: { segments: segments.map((segment) => ({ segment, status: "confirmed" })) } }
}

beforeEach(() => {
  apiMock.mockReset()
})

async function mounted(initial: unknown) {
  apiMock.mockResolvedValueOnce(initial)
  const wrapper = await mountSuspended(Desabonnement, withToken)
  await flushPromises()
  return wrapper
}

describe("newsletter/desabonnement.vue", () => {
  it("rejects a link with no token without calling the API", async () => {
    const wrapper = await mountSuspended(Desabonnement, { route: "/newsletter/desabonnement" })
    await flushPromises()
    expect(apiMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain("Ce lien n'est plus valable")
  })

  it("lists the segments the visitor is actually subscribed to", async () => {
    const wrapper = await mounted(subscribedTo("armurerie", "gun_art"))
    expect(wrapper.findAll(".nlu__item")).toHaveLength(2)
    expect(wrapper.text()).toContain("Armurerie")
    expect(wrapper.text()).toContain("Gun Art")
  })

  it("sends only the unticked segments, leaving the others subscribed", async () => {
    const wrapper = await mounted(subscribedTo("armurerie", "collection"))
    await wrapper.findAll(".nlu__item input")[1]?.setValue(false)

    apiMock.mockResolvedValueOnce({ data: { segments: ["armurerie"], purged: false } })
    await wrapper.find(".nlu__save").trigger("click")
    await flushPromises()

    const [url, options] = (apiMock.mock.calls[1] ?? []) as [string, { body: { segments?: string[] } }]
    expect(url).toBe("/newsletter/unsubscribe")
    expect(options.body.segments).toEqual(["collection"])
    expect(wrapper.text()).toContain("Vos choix sont enregistrés")
  })

  it("omits the segment list on a full unsubscribe, and confirms the erasure", async () => {
    const wrapper = await mounted(subscribedTo("armurerie"))

    apiMock.mockResolvedValueOnce({ data: { segments: [], purged: true } })
    await wrapper.find(".nlu__all").trigger("click")
    await flushPromises()

    const [, options] = (apiMock.mock.calls[1] ?? []) as [string, { body: { segments?: string[] } }]
    expect(options.body.segments).toBeUndefined()
    expect(wrapper.text()).toContain("votre adresse a été effacée")
  })

  it("asks the visitor to untick something before saving a no-op", async () => {
    const wrapper = await mounted(subscribedTo("armurerie"))
    await wrapper.find(".nlu__save").trigger("click")
    await flushPromises()

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain("Décochez au moins une newsletter")
  })

  it("treats an expired or already-used link as an invalid one", async () => {
    apiMock.mockRejectedValueOnce(new Error("400"))
    const wrapper = await mountSuspended(Desabonnement, withToken)
    await flushPromises()
    expect(wrapper.text()).toContain("Ce lien n'est plus valable")
  })
})
