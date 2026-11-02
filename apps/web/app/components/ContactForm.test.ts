// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ContactForm from "./ContactForm.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const apiError = (status: number, error: string) =>
  Object.assign(new Error(error), { response: { status, _data: { error } }, data: { error } })

async function fill(wrapper: Awaited<ReturnType<typeof mountSuspended>>) {
  await wrapper.find("input[name='name']").setValue("Jeanne Armand")
  await wrapper.find("input[name='email']").setValue("jeanne@example.fr")
  await wrapper.find("select[name='subject']").setValue("order")
  await wrapper.find("input[name='orderReference']").setValue("7C338E18")
  await wrapper.find("textarea[name='message']").setValue("Où en est ma commande ?")
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-01T10:00:00Z"), toFake: ["Date"] })
  apiMock.mockReset().mockResolvedValue({ data: { received: true } })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("ContactForm (audit 2026-11-01, I8b)", () => {
  it("labels every field and offers the five subjects", async () => {
    const wrapper = await mountSuspended(ContactForm)
    for (const field of wrapper.findAll("input:not([name='website']), select, textarea")) {
      expect(field.element.closest("label")?.textContent?.trim()).not.toBe("")
    }
    expect(wrapper.findAll("select[name='subject'] option[value]:not([value=''])")).toHaveLength(5)
  })

  it("sends the message with how long it took to fill, then thanks the sender", async () => {
    const wrapper = await mountSuspended(ContactForm)
    await fill(wrapper)
    vi.setSystemTime(new Date("2026-11-01T10:00:30Z"))
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    const [url, options] = apiMock.mock.calls[0] ?? []
    expect(url).toBe("/contact")
    expect(options.method).toBe("POST")
    expect(options.body).toMatchObject({
      name: "Jeanne Armand",
      email: "jeanne@example.fr",
      subject: "order",
      orderReference: "7C338E18",
      message: "Où en est ma commande ?",
      website: "",
    })
    expect(options.body.filledInMs).toBeGreaterThanOrEqual(30_000)
    expect(wrapper.find("[role='status']").text()).toMatch(/Message envoyé/)
    expect(wrapper.find("form").exists()).toBe(false)
  })

  it("hides the robot trap from people and from screen readers", async () => {
    const wrapper = await mountSuspended(ContactForm)
    const trap = wrapper.find("input[name='website']")
    expect(trap.attributes("tabindex")).toBe("-1")
    expect(trap.attributes("autocomplete")).toBe("off")
    expect(trap.element.closest("[aria-hidden='true']")).not.toBeNull()
  })

  it("says when too many messages left from the same address", async () => {
    apiMock.mockRejectedValue(apiError(429, "TooManyMessages"))
    const wrapper = await mountSuspended(ContactForm)
    await fill(wrapper)
    await wrapper.find("form").trigger("submit")
    await flushPromises()
    expect(wrapper.find("[role='alert']").text()).toMatch(/plusieurs messages/)
  })

  it("tells what the personal data is used for", async () => {
    const wrapper = await mountSuspended(ContactForm)
    expect(wrapper.find(".privacy a").attributes("href")).toBe("/confidentialite")
  })
})
