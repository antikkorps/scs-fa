// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import NewsletterSignup from "./NewsletterSignup.vue"
import newsletterSignupSource from "./NewsletterSignup.vue?raw"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockResolvedValue({ message: "ok" })
})

async function fill(wrapper: Awaited<ReturnType<typeof mountSuspended>>, email: string, consent = true) {
  await wrapper.find('input[type="email"]').setValue(email)
  if (consent) await wrapper.find(".nl__consent input").setValue(true)
}

function body(): { email: string; segments: string[]; consent: boolean; source?: string } {
  const [, options] = (apiMock.mock.calls[0] ?? []) as [string, { body: never }]
  return options.body
}

describe("NewsletterSignup", () => {
  it("pre-ticks only the universe it was placed in, never every segment", async () => {
    const wrapper = await mountSuspended(NewsletterSignup, { props: { defaultSegments: ["gun_art"] } })
    const boxes = wrapper.findAll(".nl__seg input")
    expect(boxes).toHaveLength(3)
    expect(boxes.filter((b) => (b.element as HTMLInputElement).checked)).toHaveLength(1)
    expect((boxes[2]?.element as HTMLInputElement | undefined)?.checked).toBe(true)
  })

  it("submits the ticked segments with the capture path as consent proof", async () => {
    const wrapper = await mountSuspended(NewsletterSignup, {
      props: { defaultSegments: ["collection"], source: "/armes-de-collection" },
    })
    await wrapper.findAll(".nl__seg input")[0]?.setValue(true) // adds "armurerie"
    await fill(wrapper, "client@example.test")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(body().segments.sort()).toEqual(["armurerie", "collection"])
    expect(body().source).toBe("/armes-de-collection")
    expect(body().consent).toBe(true)
  })

  it("refuses to submit without an explicit consent tick", async () => {
    const wrapper = await mountSuspended(NewsletterSignup)
    await fill(wrapper, "client@example.test", false)
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(apiMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain("Votre accord explicite est nécessaire.")
  })

  it("refuses to submit with no segment selected rather than subscribing to all", async () => {
    const wrapper = await mountSuspended(NewsletterSignup, { props: { defaultSegments: ["armurerie"] } })
    await wrapper.findAll(".nl__seg input")[0]?.setValue(false)
    await fill(wrapper, "client@example.test")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(apiMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain("Choisissez au moins une newsletter.")
  })

  it("rejects a malformed address client-side", async () => {
    const wrapper = await mountSuspended(NewsletterSignup)
    await fill(wrapper, "pas-un-email")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(apiMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain("Adresse email invalide.")
  })

  it("announces that nothing is active until the link is confirmed", async () => {
    const wrapper = await mountSuspended(NewsletterSignup)
    await fill(wrapper, "client@example.test")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(wrapper.text()).toContain("lien de confirmation")
    expect(wrapper.find("form").exists()).toBe(false)
  })

  it("keeps the form usable and says so when the API fails", async () => {
    apiMock.mockRejectedValue(new Error("boom"))
    const wrapper = await mountSuspended(NewsletterSignup)
    await fill(wrapper, "client@example.test")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(wrapper.text()).toContain("Inscription impossible")
    expect(wrapper.find("form").exists()).toBe(true)
  })

  it("shows the API's refusal of an address on the address field", async () => {
    // The browser check is deliberately loose; the API has the last word.
    apiMock.mockRejectedValue(Object.assign(new Error("Bad Request"), { statusCode: 400 }))
    const wrapper = await mountSuspended(NewsletterSignup)
    await fill(wrapper, "client@example.c")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(wrapper.text()).toContain("Adresse email invalide.")
    expect(wrapper.text()).not.toContain("Inscription impossible")
  })

  it("sends the address trimmed", async () => {
    const wrapper = await mountSuspended(NewsletterSignup, { props: { defaultSegments: ["armurerie"] } })
    await fill(wrapper, "  visiteur@example.fr  ")
    await wrapper.find("form").trigger("submit")
    await flushPromises()
    expect(body().email).toBe("visiteur@example.fr")
  })

  it("validates without zod: it sits in the footer of every page, and the API re-validates", () => {
    // A zod schema here put the whole of zod (~70 KB) in the entry bundle.
    expect(newsletterSignupSource).not.toMatch(/Schema\b/)
  })
})
